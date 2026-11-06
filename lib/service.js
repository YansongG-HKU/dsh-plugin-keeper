/**
 * The Plugin Keeper service: one operation layer for both callers.
 *
 * The panel route and the `plugin_scout` agent tool call these exact methods —
 * there is no second implementation anywhere. Every method takes a record id,
 * re-reads the normalized record, enforces the same rules, and writes the result
 * back to the ledger before returning.
 */

import { isAbsolute, resolve } from 'node:path'
import { deriveBlood } from './blood.js'
import { createInstaller } from './install.js'
import { collectRegistryEvidence, scoreFindings, toAudit } from './npm.js'
import { applyDecision, installGate, recommendationOf, transitionRecord } from './pipeline.js'
import {
  addHistory,
  briefFor,
  emptyRecord,
  normalizeAudit,
  normalizeBlood,
  normalizeCandidate,
  normalizeDecision,
  normalizeExecution,
  normalizeRecord,
  normalizeVerification,
  summarizeRecord,
  verificationGate,
} from './records.js'
import { KeeperStore } from './store.js'
import { makeVerification } from './verify.js'
import { asArray, clampInt, errorMessage, isPlainObject, newRecordId, nowMs, titleFrom, truncate } from './util.js'

const MAX_TEXT = 4000

export function createKeeperService({ ctx, store, log }) {
  const installer = createInstaller({ ctx, store, log })
  let initDone = false

  async function ready() {
    if (initDone) return
    await store.init()
    initDone = true
  }

  function warn(message) {
    try {
      log?.warn?.(message)
    } catch {
      /* logging never fails a demand */
    }
  }

  // -------------------------------------------------------------------------
  // reads

  async function state() {
    await ready()
    const records = store.listRecords().map((record) => summarizeRecord(normalizeRecord(record)))
    records.sort((left, right) => right.updatedAt - left.updatedAt)
    return {
      ok: true,
      generatedAt: nowMs(),
      dataDir: store.dir,
      stats: statsOf(records),
      records,
      history: store.listHistory().map(historyRow).slice(0, 50),
    }
  }

  async function detail(id, options = {}) {
    await ready()
    const record = await requireRecord(id)
    const kind = options.brief === 'none' ? null : briefKindOf(record, options.brief)
    return { ok: true, record, brief: kind ? briefFor(record, kind) : null }
  }

  async function history() {
    await ready()
    return { ok: true, entries: store.listHistory().map(historyRow) }
  }

  // -------------------------------------------------------------------------
  // demand lifecycle

  async function intake(text, options = {}) {
    await ready()
    const raw = typeof text === 'string' ? text.trim() : ''
    if (raw.length < 4) throw new Error('需求至少要有 4 个字，说清你想要的功能')
    const depth = ['quick', 'standard', 'deep'].includes(options.depth) ? options.depth : 'standard'
    const record = emptyRecord({ text: raw.slice(0, MAX_TEXT), depth })
    record.id = newRecordId()
    record.updatedAt = nowMs()
    // `emptyRecord` already seeds the intake history row; add the depth detail
    // there instead of appending a second entry for the same act.
    if (Array.isArray(record.history) && record.history.length > 0) {
      record.history[record.history.length - 1].detail = `立案（${depth}）：${truncate(raw, 200)}`
    }
    if (options.sessionId) record.links.sessionIds = uniqueList([...record.links.sessionIds, options.sessionId])
    await store.saveRecord(record)
    return { ok: true, record }
  }

  async function update(id, patch, options = {}) {
    await ready()
    const record = await requireRecord(id)
    const actor = options.actor ?? 'agent'
    if (isPlainObject(patch)) {
      if (isPlainObject(patch.intent)) {
        record.intent = normalizeRecord({ ...record, intent: { ...record.intent, ...patch.intent } }).intent
      }
      if (typeof patch.status === 'string') {
        transitionRecord(record, patch.status, {
          reason: typeof patch.statusReason === 'string' ? patch.statusReason : '',
          actor,
          force: patch.force === true,
        })
      }
      if (typeof patch.statusReason === 'string' && typeof patch.status !== 'string') {
        record.statusReason = truncate(patch.statusReason, 400)
      }
      if (isPlainObject(patch.execution)) {
        record.execution = normalizeExecution({ ...(record.execution ?? {}), ...patch.execution })
      }
      if (typeof patch.bundlePath === 'string') {
        record.execution = normalizeExecution({
          ...(record.execution ?? {}),
          kind: record.decision?.kind === 'build' ? 'build' : record.decision?.kind === 'complete-then-install' ? 'complete' : 'install',
          bundlePath: patch.bundlePath,
        })
      }
      if (Array.isArray(patch.sessionIds)) {
        record.links.sessionIds = uniqueList([...record.links.sessionIds, ...patch.sessionIds.filter((entry) => typeof entry === 'string')])
      }
      if (Array.isArray(patch.notes)) {
        for (const note of patch.notes.slice(0, 10)) {
          if (typeof note === 'string' && note.trim().length > 0) {
            record.notes.push({ at: nowMs(), text: truncate(note.trim(), MAX_TEXT), actor })
          }
        }
        record.notes = record.notes.slice(-100)
      }
      addHistory(record, 'update', `更新字段：${Object.keys(patch).join(', ')}`, nowMs())
    }
    record.updatedAt = nowMs()
    await store.saveRecord(normalizeRecord(record))
    return { ok: true, record: normalizeRecord(record), recommendation: recommendationOf(record) }
  }

  async function upsertCandidates(id, candidates, options = {}) {
    await ready()
    const record = await requireRecord(id)
    const incoming = asArray(candidates).slice(0, 20).map(normalizeCandidate)
    if (incoming.length === 0) throw new Error('没有提供候选')
    for (const candidate of incoming) {
      const index = record.candidates.findIndex((entry) => entry.name === candidate.name)
      if (index >= 0) record.candidates[index] = { ...record.candidates[index], ...candidate }
      else record.candidates.push(candidate)
    }
    record.candidates = record.candidates.slice(-20)
    const selectName = typeof options.select === 'string' ? options.select : incoming[0].name
    const selected = record.candidates.find((entry) => entry.name === selectName) ?? incoming[0]
    record.candidate = selected
    if (record.status === 'intake') {
      transitionRecord(record, 'scouting', { reason: '开始侦察', actor: options.actor ?? 'agent', force: true })
    }
    addHistory(
      record,
      'candidates',
      `候选 ${incoming.length} 个（选中 ${selected.name}）`,
      nowMs(),
    )
    record.updatedAt = nowMs()
    await store.saveRecord(normalizeRecord(record))
    return { ok: true, record: normalizeRecord(record), candidate: selected, recommendation: recommendationOf(record) }
  }

  async function audit(id, options = {}) {
    await ready()
    const record = await requireRecord(id)
    const actor = options.actor ?? 'agent'
    const target = typeof options.path === 'string' && options.path.trim().length > 0 ? options.path.trim() : null
    const packageName =
      typeof options.packageName === 'string' && options.packageName.trim().length > 0
        ? options.packageName.trim()
        : record.candidate?.name ?? null

    let auditResult = null
    let evidence = null
    if (target) {
      const dir = resolveAgainstCwd(ctx, target)
      let engine
      try {
        engine = await import('./audit.js')
      } catch (error) {
        throw new Error(`静态审计引擎不可用：${errorMessage(error)}`)
      }
      if (typeof engine.auditDirectory !== 'function') throw new Error('静态审计引擎缺少 auditDirectory()')
      auditResult = await engine.auditDirectory(dir, {
        maxFiles: clampInt(options.maxFiles, 10, 2000, 600),
      })
      auditResult.target = dir
      // A local directory audit always reads source by definition.
      auditResult.scope = 'source'
      try {
        const { digestDirectory } = await import('./digest.js')
        const digest = await digestDirectory(dir, { maxFiles: clampInt(options.maxFiles, 10, 2000, 600) })
        auditResult.digest = digest.hash
        auditResult.digestFiles = digest.files
        auditResult.digestTruncated = digest.truncated
      } catch {
        /* a directory that cannot be digested simply has no integrity evidence */
      }
    } else if (packageName) {
      evidence = await collectRegistryEvidence(packageName, {
        registry: options.registry,
        community: options.community,
      })
      if (!evidence.ok) {
        auditResult = normalizeAudit({
          score: 0,
          verdict: 'unsafe',
          evidenceLevel: 'static',
          scope: 'metadata',
          target: `npm:${packageName}`,
          findings: evidence.findings,
          permissions: { sparseSource: true },
          stats: { files: 0, bytes: 0, dependencies: 0, scannedAt: nowMs() },
        })
      } else {
        auditResult = toAudit(evidence)
        auditResult.scope = 'metadata'
        // Source-level pass: download the published tarball, scan it, delete it.
        // Nothing is installed and no package script runs.
        if (options.source !== false) {
          try {
            const npm = await import('./npm.js')
            const source = await npm.auditRegistrySource(evidence.package, {
              timeoutMs: options.sourceTimeoutMs,
              maxFiles: clampInt(options.maxFiles, 50, 2000, 800),
            })
            if (source.ok && source.audit) {
              auditResult = mergeAudits(auditResult, source.audit)
            } else {
              auditResult.findings.push({
                id: 'source-unavailable',
                severity: 'info',
                kind: 'provenance',
                title: '源码级审计不可得',
                detail: truncate(source.error ?? '未知原因', 400),
              })
            }
          } catch (error) {
            auditResult.findings.push({
              id: 'source-unavailable',
              severity: 'info',
              kind: 'provenance',
              title: '源码级审计不可得',
              detail: truncate(errorMessage(error), 400),
            })
          }
        }
        // Sandbox pass: materialize the candidate in a throwaway directory with
        // lifecycle scripts disabled, prove the resulting package matches the
        // audited digest, then delete the directory. This never touches the
        // user's profile and never executes package code.
        const wantSandbox =
          options.sandbox === true || (options.sandbox !== false && record.intent?.depth === 'deep')
        if (wantSandbox && evidence.ok) {
          try {
            const { sandboxEvidence } = await import('./sandbox.js')
            // The sandbox must materialise the package that was just audited, not
            // whatever candidate happens to be selected on the record. Prefer the
            // selected candidate's spec only when that candidate IS the audited
            // package (e.g. a local registry fixture served from a tarball URL);
            // otherwise use the audited package's own name@version.
            const auditedName = evidence.package?.name ?? packageName
            const candidateSpec = record.candidate?.spec
            const candidateMatches =
              typeof candidateSpec === 'string' &&
              (record.candidate?.name === auditedName ||
                candidateSpec === auditedName ||
                candidateSpec.startsWith(`${auditedName}@`))
            const spec = candidateMatches
              ? candidateSpec
              : `${auditedName}${evidence.package?.version ? `@${evidence.package.version}` : ''}`
            const sandbox = await sandboxEvidence({
              spec,
              expectedDigest: auditResult.digest ?? null,
              ctx,
              timeoutMs: options.sandboxTimeoutMs,
            })
            auditResult.sandbox = {
              ok: sandbox.ok,
              scriptsDisabled: sandbox.scriptsDisabled === true,
              digestMatch: sandbox.digestMatch ?? null,
              packageName: sandbox.packageName ?? null,
              version: sandbox.version ?? null,
              ms: sandbox.ms ?? null,
              files: sandbox.files ?? null,
              ...(sandbox.error ? { error: truncate(sandbox.error, 400) } : {}),
            }
            if (sandbox.ok && sandbox.digestMatch === true && auditResult.scope === 'source') {
              auditResult.evidenceLevel = 'sandbox'
            } else if (!sandbox.ok) {
              auditResult.findings.push({
                id: 'sandbox-unavailable',
                severity: 'info',
                kind: 'provenance',
                title: '隔离试装未完成',
                detail: truncate(sandbox.error ?? '未知原因', 400),
              })
            }
          } catch (error) {
            auditResult.findings.push({
              id: 'sandbox-unavailable',
              severity: 'info',
              kind: 'provenance',
              title: '隔离试装未完成',
              detail: truncate(errorMessage(error), 400),
            })
          }
        }
      }
    } else {
      throw new Error('审计需要 path（本地包目录）或 package_name')
    }

    record.audit = normalizeAudit(auditResult)
    if (record.candidate) {
      const selected = record.candidates.find((entry) => entry.name === record.candidate.name) ?? record.candidate
      selected.riskScore = Math.max(0, 100 - (record.audit.score ?? 0))
      if (evidence?.package?.version) selected.version = evidence.package.version
      if (evidence?.package?.repository) selected.repository = evidence.package.repository
      if (evidence?.package?.license) selected.license = evidence.package.license
      record.candidate = selected
      const index = record.candidates.findIndex((entry) => entry.name === selected.name)
      if (index >= 0) record.candidates[index] = selected
    }
    if (['intake', 'scouting'].includes(record.status)) {
      transitionRecord(record, 'auditing', { reason: '开始验毒', actor, force: true })
    }
    addHistory(
      record,
      'audit',
      `${record.audit.evidenceLevel}/${record.audit.scope === 'source' ? '源码级' : '元数据级'} 审计 ${record.audit.target}：${record.audit.score}/100 ${record.audit.verdict}，发现 ${record.audit.findings.length} 项`,
      nowMs(),
    )
    record.updatedAt = nowMs()
    await store.saveRecord(normalizeRecord(record))
    return {
      ok: true,
      record: normalizeRecord(record),
      audit: record.audit,
      auditScope: record.audit.scope,
      evidencePackage: evidence?.package ?? null,
      community: evidence?.community ?? null,
      recommendation: recommendationOf(record),
    }
  }

  async function blood(id, options = {}) {
    await ready()
    const record = await requireRecord(id)
    if (!record.candidate) throw new Error('还没有选定候选，无法做血量分析')
    const normalized = normalizeBlood({
      gaps: asArray(options.gaps),
      score: options.score,
      label: options.label,
      summary: options.summary,
    })
    const derived = deriveBlood({
      gaps: normalized.gaps,
      score: normalized.score ?? undefined,
      label: normalized.label === 'unknown' ? undefined : normalized.label,
      summary: normalized.summary || undefined,
    })
    const previous = record.blood
    const nextRound = options.nextRound === true
    const round = nextRound ? (previous?.round ?? 0) + 1 : previous?.round ?? 1
    record.blood = normalizeBlood({ ...derived, round, stale: false })
    if (nextRound) {
      record.bloodRounds = [
        ...asArray(record.bloodRounds).slice(-11),
        { round, at: nowMs(), score: record.blood.score, label: record.blood.label, gapCount: record.blood.gaps.length },
      ]
    }
    if (['intake', 'scouting', 'auditing'].includes(record.status)) {
      transitionRecord(record, 'decision', { reason: '血量分析完成', actor: options.actor ?? 'agent', force: true })
    }
    addHistory(
      record,
      'blood',
      `第 ${round} 轮血量 ${record.blood.score}/100 ${record.blood.label}，缺口 ${record.blood.gaps.length} 项${nextRound ? '（复查）' : ''}`,
      nowMs(),
    )
    record.updatedAt = nowMs()
    await store.saveRecord(normalizeRecord(record))
    return { ok: true, record: normalizeRecord(record), recommendation: recommendationOf(record) }
  }

  /**
   * Add a requirement revision to an existing record.
   *
   * A growing requirement is a first-class event, not a note: it bumps the
   * revision, snapshots the capability/constraint set, invalidates the previous
   * decision, and marks the gap analysis stale so the panel and the gates both
   * ask for a new round before any further install can happen.
   */
  async function amend(id, text, options = {}) {
    await ready()
    const record = await requireRecord(id)
    const addition = typeof text === 'string' ? text.trim() : ''
    if (addition.length < 2) throw new Error('补充需求至少要有 2 个字')
    const at = nowMs()
    const actor = options.actor === 'user' ? 'user' : 'agent'
    const rev = (record.intent.rev ?? 1) + 1
    const capabilities = uniqueList([...record.intent.capabilities, ...stringList(options.capabilities)])
    const constraints = uniqueList([...record.intent.constraints, ...stringList(options.constraints)])
    record.intent = {
      ...record.intent,
      text: `${record.intent.text}\n\n[rev ${rev}] ${addition}`,
      capabilities,
      constraints,
      rev,
      revisions: [
        ...asArray(record.intent.revisions).slice(-39),
        { rev, at, text: addition, source: actor, capabilities: capabilities.slice(), constraints: constraints.slice(), note: truncate(options.note ?? '', 400) || null },
      ],
    }
    if (record.decision) {
      addHistory(record, 'decision-invalidated', `需求增补到 rev ${rev}，旧决策失效`, at)
      record.decision = null
    }
    if (record.blood) {
      record.blood = normalizeBlood({ ...record.blood, stale: true })
    }
    if (record.status !== 'installed') record.approval = null
    if (!['intake', 'scouting', 'auditing'].includes(record.status)) {
      transitionRecord(record, 'decision', {
        reason: `需求增补（rev ${rev}）：需要复查缺口并重新决策`,
        actor,
        force: true,
      })
    }
    addHistory(record, 'amend', `需求增补 rev ${rev}：${truncate(addition, 200)}`, at)
    record.updatedAt = at
    await store.saveRecord(normalizeRecord(record))
    return {
      ok: true,
      record: normalizeRecord(record),
      revision: rev,
      needsRegap: Boolean(record.blood?.stale),
    }
  }

  async function decide(id, options = {}) {
    await ready()
    const record = await requireRecord(id)
    const kind = options.kind
    const rationale = typeof options.rationale === 'string' ? options.rationale.trim() : ''
    if (!rationale) throw new Error('决策必须写理由，记录要能复核')
    const plan = isPlainObject(options.plan) ? options.plan : null
    const { warnings } = applyDecision(record, {
      kind,
      rationale,
      plan,
      actor: options.actor ?? 'agent',
      force: options.force === true,
    })
    record.updatedAt = nowMs()
    await store.saveRecord(normalizeRecord(record))
    return {
      ok: true,
      record: normalizeRecord(record),
      warnings,
      recommendation: recommendationOf(record),
      next: nextStepOf(record),
    }
  }

  async function verify(id, options = {}) {
    await ready()
    const record = await requireRecord(id)
    const checks = []
    const target = typeof options.path === 'string' && options.path.trim().length > 0 ? options.path.trim() : null
    if (target) {
      const dir = resolveAgainstCwd(ctx, target)
      record.execution = normalizeExecution({
        ...(record.execution ?? {}),
        bundlePath: dir,
        kind: record.decision?.kind === 'build' ? 'build' : record.decision?.kind === 'complete-then-install' ? 'complete' : 'install',
      })
      const { verifyBundle } = await import('./verify.js')
      const result = await verifyBundle(dir, { runTests: options.runTests === true, log })
      checks.push(...result.verification.checks)
    }
    for (const check of asArray(options.checks).slice(0, 30)) {
      if (!isPlainObject(check)) continue
      checks.push({
        level: ['L0', 'L1', 'L2', 'L3', 'L4', 'L5'].includes(check.level) ? check.level : 'L3',
        name: truncate(check.name ?? '人工检查', 200),
        status: ['pass', 'fail', 'skip'].includes(check.status) ? check.status : 'skip',
        detail: truncate(check.detail ?? '', 1200),
        at: nowMs(),
      })
    }
    if (checks.length === 0) throw new Error('验收需要 path 或至少一条 checks')

    const existing = asArray(record.verification?.checks)
    const merged = [
      ...existing.filter((entry) => !checks.some((next) => next.level === entry.level && next.name === entry.name)),
      ...checks,
    ]
    merged.sort((left, right) => String(left.level).localeCompare(String(right.level)))
    record.verification = makeVerification(merged)
    const passed = record.verification.passed
    if (passed) {
      transitionRecord(record, 'ready', { reason: '验收通过，等待用户确认安装', actor: options.actor ?? 'agent', force: true })
    } else {
      transitionRecord(record, 'blocked', { reason: '验收未通过', actor: options.actor ?? 'agent', force: true })
    }
    addHistory(
      record,
      'verify',
      passed ? `验收通过（gate ${record.verification.gate}，${record.verification.checks.length} 项）` : '验收未通过',
      nowMs(),
    )
    record.updatedAt = nowMs()
    await store.saveRecord(normalizeRecord(record))
    return { ok: true, record: normalizeRecord(record), verification: record.verification }
  }

  async function install(id, options = {}) {
    await ready()
    const record = await requireRecord(id)
    const gate = installGate(record)
    if (!gate.ok) return { ok: false, record: normalizeRecord(record), error: gate.error }
    const result = await installer.install(record, { via: options.via ?? 'tool' })
    if (result.record) {
      await store.saveRecord(normalizeRecord(result.record))
    }
    return { ...result, record: result.record ? normalizeRecord(result.record) : null }
  }

  async function rollback(id, options = {}) {
    await ready()
    const record = await requireRecord(id)
    const result = await installer.rollback(record, { actor: options.actor })
    if (result.record) await store.saveRecord(normalizeRecord(result.record))
    return { ...result, record: result.record ? normalizeRecord(result.record) : null }
  }

  async function claimSession(id, kind, sessionId, options = {}) {
    await ready()
    const record = await requireRecord(id)
    const executionKind = ['complete', 'build', 'gap'].includes(kind) ? kind : 'install'
    record.execution = normalizeExecution({
      ...(record.execution ?? {}),
      kind: executionKind,
      startedAt: nowMs(),
      sessionId: typeof sessionId === 'string' && sessionId.length > 0 ? sessionId : record.execution?.sessionId ?? null,
    })
    record.links.sessionIds = uniqueList([
      ...record.links.sessionIds,
      ...(typeof sessionId === 'string' && sessionId.length > 0 ? [sessionId] : []),
    ])
    if (!['installed', 'archived', 'rejected'].includes(record.status)) {
      transitionRecord(record, 'executing', { reason: `开始${executionKind}`, actor: options.actor ?? 'user', force: true })
    }
    addHistory(record, 'session', `开工（${executionKind}）${sessionId ? `：${sessionId}` : ''}`, nowMs())
    record.updatedAt = nowMs()
    await store.saveRecord(normalizeRecord(record))
    return { ok: true, record: normalizeRecord(record), brief: briefFor(record, executionKind) }
  }

  async function note(id, text, options = {}) {
    await ready()
    const record = await requireRecord(id)
    const value = typeof text === 'string' ? text.trim() : ''
    if (value.length === 0) throw new Error('备注不能为空')
    record.notes.push({ at: nowMs(), text: truncate(value, MAX_TEXT), actor: options.actor ?? 'user' })
    record.notes = record.notes.slice(-100)
    addHistory(record, 'note', truncate(value, 200), nowMs())
    record.updatedAt = nowMs()
    await store.saveRecord(normalizeRecord(record))
    return { ok: true, record: normalizeRecord(record) }
  }

  async function archive(id, options = {}) {
    await ready()
    const record = await requireRecord(id)
    transitionRecord(record, 'archived', { reason: '归档', actor: options.actor ?? 'user', force: true })
    record.updatedAt = nowMs()
    await store.saveRecord(normalizeRecord(record))
    return { ok: true, record: normalizeRecord(record) }
  }

  async function reopen(id, options = {}) {
    await ready()
    const record = await requireRecord(id)
    const next = record.audit && record.candidate ? 'decision' : 'intake'
    transitionRecord(record, next, { reason: '重新打开', actor: options.actor ?? 'user', force: true })
    record.updatedAt = nowMs()
    await store.saveRecord(normalizeRecord(record))
    return { ok: true, record: normalizeRecord(record) }
  }

  async function reject(id, reason, options = {}) {
    await ready()
    const record = await requireRecord(id)
    const rationale = typeof reason === 'string' && reason.trim().length > 0 ? reason.trim() : '用户否决'
    record.decision = normalizeDecision({ kind: 'reject', rationale, at: nowMs(), plan: null, intentRev: record.intent.rev })
    transitionRecord(record, 'rejected', { reason: rationale, actor: options.actor ?? 'user', force: true })
    record.updatedAt = nowMs()
    await store.saveRecord(normalizeRecord(record))
    return { ok: true, record: normalizeRecord(record) }
  }

  async function setDepth(id, depth) {
    await ready()
    const record = await requireRecord(id)
    if (!['quick', 'standard', 'deep'].includes(depth)) throw new Error('深度只能是 quick / standard / deep')
    record.intent.depth = depth
    addHistory(record, 'update', `深度改为 ${depth}`, nowMs())
    record.updatedAt = nowMs()
    await store.saveRecord(normalizeRecord(record))
    return { ok: true, record: normalizeRecord(record) }
  }

  // -------------------------------------------------------------------------
  // helpers

  async function requireRecord(id) {
    if (typeof id !== 'string' || id.trim().length === 0) throw new Error('缺少记录 ID')
    const record = store.getRecord(id.trim())
    if (!record) throw new Error(`没有这条记录：${id}`)
    return normalizeRecord(record)
  }

  return {
    store,
    state,
    detail,
    history,
    intake,
    update,
    upsertCandidates,
    audit,
    blood,
    amend,
    decide,
    verify,
    install,
    rollback,
    claimSession,
    note,
    archive,
    reopen,
    reject,
    setDepth,
    // exposed for the tool/panel result hints
    recommendationOf,
    version: '0.2.0',
    dataDir: store.dir,
  }
}

/** Create the store bound to this plugin instance's data directory. */
export function createStore({ dir, log }) {
  return new KeeperStore({ dir, log })
}

// ---------------------------------------------------------------------------
// projections and small helpers

function statsOf(records) {
  const stats = { total: records.length, working: 0, waiting: 0, installed: 0, blocked: 0, archived: 0, rejected: 0 }
  for (const record of records) {
    if (['intake', 'scouting', 'auditing', 'decision', 'executing', 'verifying'].includes(record.status)) stats.working += 1
    else if (['awaiting-approval', 'ready'].includes(record.status)) stats.waiting += 1
    else if (record.status === 'installed') stats.installed += 1
    else if (record.status === 'blocked') stats.blocked += 1
    else if (record.status === 'archived') stats.archived += 1
    else if (record.status === 'rejected') stats.rejected += 1
  }
  return stats
}

function historyRow(entry) {
  return {
    recordId: entry?.recordId ?? null,
    title: entry?.title ?? '',
    at: entry?.at ?? null,
    spec: entry?.spec ?? '',
    application: entry?.application ?? 'failed',
    version: entry?.version ?? null,
    bundle: entry?.bundle ?? null,
    rollbackName: entry?.rollbackName ?? null,
  }
}

/** Which brief a record should hand out when the caller does not say. */
export function briefKindOf(record, requested) {
  if (requested === 'work' || requested === 'complete' || requested === 'build' || requested === 'gap') return requested
  if (record?.blood?.stale === true) return 'gap'
  const action = record?.decision?.kind
  if (action === 'complete-then-install') return 'complete'
  if (action === 'build') return 'build'
  return 'work'
}

export function nextStepOf(record) {
  if (!record) return 'intake'
  if (record.blood?.stale === true) return 'gap'
  if (record.status === 'installed') return record.decision?.intentRev !== record.intent?.rev ? 'gap' : 'done'
  const kind = record.decision?.kind
  if (kind === 'reject') return 'done'
  if (kind === 'install') return record.verification?.passed ? 'install' : 'verify'
  if (kind === 'complete-then-install') return 'complete'
  if (kind === 'build') return 'build'
  if (!record.candidate) return 'candidates'
  if (!record.audit) return 'audit'
  if (!record.blood) return 'blood'
  return 'decide'
}

/** Resolve a user/agent supplied path against the initiating session's cwd. */
export function resolveAgainstCwd(ctx, input) {
  const text = String(input ?? '').trim()
  if (isAbsolute(text)) return resolve(text)
  return resolve(currentCwd(ctx), text)
}

function currentCwd(ctx) {
  try {
    const agent = ctx?.agents?.currentInitiator?.()
    const headerCwd = agent?.session?.header?.cwd
    if (typeof headerCwd === 'string' && headerCwd.length > 0) return headerCwd
    if (agent?.session && ctx?.workingDirectory?.get) {
      const cwd = ctx.workingDirectory.get(agent.session)
      if (typeof cwd === 'string' && cwd.length > 0) return cwd
    }
  } catch {
    /* fall through to the process directory */
  }
  return process.cwd()
}

function uniqueList(values) {
  return [...new Set(values.filter((value) => typeof value === 'string' && value.length > 0))].slice(-20)
}

/** Trim and bound a list of user/agent supplied strings. */
function stringList(value, limit = 24, max = 160) {
  return asArray(value)
    .filter((entry) => typeof entry === 'string' && entry.trim().length > 0)
    .slice(0, limit)
    .map((entry) => truncate(entry.trim(), max))
}

/**
 * Merge a source-level audit over the metadata audit: source findings come
 * first because they carry file/line evidence, metadata findings add
 * provenance/registry facts the source cannot show. Score is recomputed over
 * the merged set so one candidate compares against another on one scale.
 */
export function mergeAudits(metadataAudit, sourceAudit) {
  const seen = new Set()
  const findings = []
  for (const finding of [...asArray(sourceAudit?.findings), ...asArray(metadataAudit?.findings)]) {
    const key = `${finding?.id ?? ''}|${finding?.file ?? ''}|${finding?.line ?? ''}`
    if (seen.has(key)) continue
    seen.add(key)
    findings.push(finding)
  }
  const { score, verdict } = scoreFindings(findings)
  return {
    score,
    verdict,
    evidenceLevel: 'static',
    scope: 'source',
    target: sourceAudit?.target ?? metadataAudit?.target ?? '',
    findings: findings.slice(0, 200),
    permissions: sourceAudit?.permissions ?? metadataAudit?.permissions ?? {},
    stats: sourceAudit?.stats ?? metadataAudit?.stats ?? {},
    ...(sourceAudit?.digest ? { digest: sourceAudit.digest } : {}),
    ...(Number.isFinite(Number(sourceAudit?.digestFiles)) ? { digestFiles: sourceAudit.digestFiles } : {}),
    ...(sourceAudit?.digestTruncated === true ? { digestTruncated: true } : {}),
    ...(metadataAudit?.community ? { community: metadataAudit.community } : {}),
  }
}

export { titleFrom, verificationGate, normalizeVerification }
