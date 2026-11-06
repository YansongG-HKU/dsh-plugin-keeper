/**
 * Record schema, defensive normalization, list projections, and the working
 * brief handed to a new session.
 *
 * One record is the single source of truth for one demand. Every reader — the
 * panel, the `plugin_scout` tool, a resumed session — reads the same normalized
 * shape, so a missing or hand-edited field can never crash a view or bypass a
 * gate: normalization is the only entry point into the ledger.
 */

import { asArray, asString, formatTime, isPlainObject, nowMs, titleFrom, truncate } from './util.js'

/** Every status a demand can hold. */
export const STATUSES = [
  'intake',
  'scouting',
  'auditing',
  'decision',
  'awaiting-approval',
  'executing',
  'verifying',
  'ready',
  'installed',
  'blocked',
  'rejected',
  'archived',
]

/** Human labels for briefs and host-rendered text (the panel localizes itself). */
export const STATUS_LABELS = {
  intake: '已立案',
  scouting: '侦察中',
  auditing: '验毒中',
  decision: '分析中',
  'awaiting-approval': '待你拍板',
  executing: '执行中',
  verifying: '验收中',
  ready: '已就绪',
  installed: '已安装',
  blocked: '被拦截',
  rejected: '已否决',
  archived: '已归档',
}

export const BLOOD_LABELS = { full: '满血', thin: '残血', cut: '阉割', unknown: '未知' }
export const DEPTHS = ['quick', 'standard', 'deep']
export const DEPTH_LABELS = { quick: '快筛', standard: '标准', deep: '深挖' }
export const DECISION_KINDS = ['install', 'complete-then-install', 'build', 'reject']
export const EVIDENCE_LEVELS = ['none', 'static', 'sandbox', 'behavioral']

const SEVERITIES = new Set(['critical', 'high', 'medium', 'low', 'info'])
const GAP_STATES = new Set(['partial', 'missing'])
const GAP_KINDS = new Set(['cut', 'incomplete', 'stale', 'integration', 'ux', 'unknown'])

/** A brand-new record at `intake`; the agent fills capabilities next. */
export function emptyRecord({ text, depth = 'standard', at = nowMs() } = {}) {
  const intentText = asString(text).trim()
  return normalizeRecord({
    id: undefined,
    createdAt: at,
    updatedAt: at,
    intent: {
      text: intentText,
      title: titleFrom(intentText),
      capabilities: [],
      constraints: [],
      depth,
      rev: 1,
      revisions: [
        { rev: 1, at, text: intentText, source: 'user', capabilities: [], constraints: [], note: null },
      ],
    },
    status: 'intake',
    statusReason: '需求已立案，等待侦察。',
    candidate: null,
    candidates: [],
    audit: null,
    blood: null,
    bloodRounds: [],
    decision: null,
    execution: null,
    verification: null,
    install: null,
    approval: null,
    links: { sessionIds: [] },
    notes: [],
    history: [{ at, kind: 'intake', detail: '立案：' + titleFrom(intentText) }],
  })
}

/**
 * Fill every documented field with a safe default and drop unknown keys.
 * This is the only constructor the rest of the Host may rely on.
 */
export function normalizeRecord(raw) {
  const source = isPlainObject(raw) ? raw : {}
  const intent = isPlainObject(source.intent) ? source.intent : {}
  const text = asString(intent.text ?? source.text).trim()
  const createdAt = finiteOr(source.createdAt, nowMs())
  const depth = DEPTHS.includes(intent.depth) ? intent.depth : 'standard'
  const status = STATUSES.includes(source.status) ? source.status : 'intake'
  const record = {
    id: asString(source.id),
    createdAt,
    updatedAt: finiteOr(source.updatedAt, createdAt),
    intent: {
      text,
      title: asString(intent.title) || titleFrom(text),
      capabilities: stringList(intent.capabilities, 24, 120),
      constraints: stringList(intent.constraints, 24, 160),
      depth,
      rev: Math.max(1, Math.trunc(Number(intent.rev) || 1)),
      revisions: normalizeRevisions(intent.revisions, { text, at: createdAt, rev: Math.max(1, Math.trunc(Number(intent.rev) || 1)) }),
    },
    status,
    statusReason: nullableString(source.statusReason, 400),
    candidate: source.candidate ? normalizeCandidate(source.candidate) : null,
    candidates: asArray(source.candidates).map(normalizeCandidate),
    audit: source.audit ? normalizeAudit(source.audit) : null,
    blood: source.blood ? normalizeBlood(source.blood) : null,
    bloodRounds: asArray(source.bloodRounds)
      .filter(isPlainObject)
      .slice(-12)
      .map((round) => ({
        round: Math.max(1, Math.trunc(Number(round.round) || 1)),
        at: finiteOr(round.at, createdAt),
        score: scoreOrNull(round.score),
        label: ['full', 'thin', 'cut', 'unknown'].includes(round.label) ? round.label : 'unknown',
        gapCount: Math.max(0, Math.trunc(Number(round.gapCount) || 0)),
      })),
    decision: source.decision ? normalizeDecision(source.decision) : null,
    execution: source.execution ? normalizeExecution(source.execution) : null,
    verification: source.verification ? normalizeVerification(source.verification) : null,
    install: source.install ? normalizeInstall(source.install) : null,
    approval: isPlainObject(source.approval)
      ? {
          via: source.approval.via === 'panel' ? 'panel' : 'tool',
          at: finiteOr(source.approval.at, nowMs()),
        }
      : null,
    links: { sessionIds: stringList(source.links?.sessionIds, 20, 120) },
    notes: asArray(source.notes)
      .filter(isPlainObject)
      .slice(-100)
      .map((note) => ({
        at: finiteOr(note.at, createdAt),
        text: truncate(note.text, 4000),
        actor: ['user', 'agent', 'host'].includes(note.actor) ? note.actor : 'agent',
      })),
    history: asArray(source.history)
      .filter(isPlainObject)
      .slice(-400)
      .map((entry) => ({
        at: finiteOr(entry.at, createdAt),
        kind: truncate(entry.kind, 60),
        detail: truncate(entry.detail, 600),
      })),
  }

  // Keep the selected candidate present in the pool exactly once.
  if (record.candidate) {
    const index = record.candidates.findIndex((candidate) => candidate.name === record.candidate.name)
    if (index >= 0) record.candidates[index] = record.candidate
    else record.candidates.unshift(record.candidate)
  }
  return record
}

export function normalizeCandidate(raw) {
  const source = isPlainObject(raw) ? raw : {}
  const name = asString(source.name).trim() || 'unknown'
  return {
    name,
    version: nullableString(source.version, 80),
    spec: nullableString(source.spec, 400),
    source: ['market', 'npm', 'github', 'local', 'manual'].includes(source.source) ? source.source : 'manual',
    repository: nullableString(source.repository, 400),
    homepage: nullableString(source.homepage, 400),
    license: nullableString(source.license, 120),
    description: nullableString(source.description, 600),
    capabilities: asArray(source.capabilities)
      .filter(isPlainObject)
      .slice(0, 60)
      .map((capability) => ({
        id: truncate(capability.id, 120),
        state: ['present', 'partial', 'missing', 'unknown'].includes(capability.state)
          ? capability.state
          : 'unknown',
        evidence: nullableString(capability.evidence, 400),
      })),
    fitScore: scoreOrNull(source.fitScore),
    qualityScore: scoreOrNull(source.qualityScore),
    maintenanceScore: scoreOrNull(source.maintenanceScore),
    riskScore: scoreOrNull(source.riskScore),
    notes: nullableString(source.notes, 2000),
    addedAt: finiteOr(source.addedAt, nowMs()),
  }
}

export function normalizeFinding(raw) {
  const source = isPlainObject(raw) ? raw : {}
  return {
    id: truncate(source.id, 80) || 'finding',
    severity: SEVERITIES.has(source.severity) ? source.severity : 'info',
    kind: truncate(source.kind, 60) || 'other',
    title: truncate(source.title, 200) || '问题',
    detail: truncate(source.detail, 2000),
    ...(source.file ? { file: truncate(source.file, 400) } : {}),
    ...(Number.isFinite(Number(source.line)) ? { line: Math.trunc(Number(source.line)) } : {}),
    ...(source.evidence ? { evidence: truncate(source.evidence, 400) } : {}),
  }
}

/**
 * Requirement revisions are append-only evidence: every amendment keeps the
 * text, who wrote it, and the capability/constraint set at that moment. A record
 * created before revisions existed still gets one synthetic `rev: 1` entry so a
 * later amendment has a truthful baseline.
 */
function normalizeRevisions(raw, fallback) {
  const list = asArray(raw).filter(isPlainObject)
  const normalized = list
    .slice(-40)
    .map((entry, index) => ({
      rev: Math.max(1, Math.trunc(Number(entry.rev) || index + 1)),
      at: finiteOr(entry.at, fallback.at),
      text: truncate(entry.text, 4000),
      source: entry.source === 'agent' ? 'agent' : 'user',
      capabilities: stringList(entry.capabilities, 24, 120),
      constraints: stringList(entry.constraints, 24, 160),
      note: nullableString(entry.note, 400),
    }))
  if (normalized.length > 0) return normalized
  return [
    {
      rev: fallback.rev,
      at: fallback.at,
      text: fallback.text,
      source: 'user',
      capabilities: [],
      constraints: [],
      note: null,
    },
  ]
}

export function normalizeAudit(raw) {
  const source = isPlainObject(raw) ? raw : {}
  const permissions = isPlainObject(source.permissions) ? source.permissions : {}
  const score = scoreOrNull(source.score)
  const verdict = ['safe', 'caution', 'unsafe', 'unknown'].includes(source.verdict)
    ? source.verdict
    : verdictOf(score)
  return {
    score,
    verdict,
    evidenceLevel: EVIDENCE_LEVELS.includes(source.evidenceLevel) ? source.evidenceLevel : 'none',
    scope: ['source', 'metadata', 'none'].includes(source.scope) ? source.scope : null,
    target: truncate(source.target, 400),
    findings: asArray(source.findings).filter(isPlainObject).slice(0, 200).map(normalizeFinding),
    permissions: {
      installScripts: Boolean(permissions.installScripts),
      network: stringList(permissions.network, 40, 200),
      childProcess: Boolean(permissions.childProcess),
      eval: Boolean(permissions.eval),
      filesystemWrite: Boolean(permissions.filesystemWrite),
      credentials: Boolean(permissions.credentials),
      obfuscated: Boolean(permissions.obfuscated),
      nativeAddons: Boolean(permissions.nativeAddons),
      patchesShippedRows: Boolean(permissions.patchesShippedRows),
      sparseSource: Boolean(permissions.sparseSource),
    },
    stats: {
      files: finiteOr(source.stats?.files, 0),
      bytes: finiteOr(source.stats?.bytes, 0),
      dependencies: finiteOr(source.stats?.dependencies, 0),
      scannedAt: finiteOr(source.stats?.scannedAt, nowMs()),
    },
    ...(typeof source.digest === 'string' && /^[0-9a-f]{64}$/i.test(source.digest) ? { digest: source.digest } : {}),
    ...(Number.isFinite(Number(source.digestFiles)) ? { digestFiles: Math.trunc(Number(source.digestFiles)) } : {}),
    ...(source.digestTruncated === true ? { digestTruncated: true } : {}),
    ...(isPlainObject(source.sandbox) ? { sandbox: normalizeSandbox(source.sandbox) } : {}),
    ...(isPlainObject(source.community) ? { community: source.community } : {}),
  }
}

/** Isolated trial-install evidence (see lib/sandbox.js). */
function normalizeSandbox(raw) {
  const source = isPlainObject(raw) ? raw : {}
  return {
    ok: Boolean(source.ok),
    scriptsDisabled: Boolean(source.scriptsDisabled),
    digestMatch: source.digestMatch === true ? true : source.digestMatch === false ? false : null,
    packageName: nullableString(source.packageName, 200),
    version: nullableString(source.version, 80),
    files: Number.isFinite(Number(source.files)) ? Math.trunc(Number(source.files)) : null,
    ms: Number.isFinite(Number(source.ms)) ? Math.trunc(Number(source.ms)) : null,
    ...(source.error ? { error: truncate(source.error, 400) } : {}),
  }
}

export function normalizeBlood(raw) {
  const source = isPlainObject(raw) ? raw : {}
  const gaps = asArray(source.gaps)
    .filter(isPlainObject)
    // A gap list is only for partial/missing capabilities. "present" is not a
    // gap; dropping it prevents a caller from inflating the gap count by
    // listing fulfilled capabilities, and unknown states are treated as missing
    // (unknown evidence must not look better than missing evidence).
    .filter((gap) => gap.state !== 'present')
    .slice(0, 40)
    .map((gap, index) => ({
      id: truncate(gap.id, 80) || `gap-${index + 1}`,
      capability: truncate(gap.capability, 200) || '未命名能力',
      state: gap.state === 'partial' ? 'partial' : 'missing',
      kind: GAP_KINDS.has(gap.kind) ? gap.kind : 'unknown',
      evidence: truncate(gap.evidence, 1000),
      remedy: truncate(gap.remedy, 1000),
      effort: ['S', 'M', 'L'].includes(gap.effort) ? gap.effort : 'M',
      risk: ['low', 'medium', 'high'].includes(gap.risk) ? gap.risk : 'medium',
    }))
  const score = scoreOrNull(source.score)
  const label = ['full', 'thin', 'cut', 'unknown'].includes(source.label) ? source.label : 'unknown'
  return {
    score,
    label,
    summary: truncate(source.summary, 1200),
    round: Math.max(1, Math.trunc(Number(source.round) || 1)),
    stale: source.stale === true,
    gaps,
  }
}

export function normalizeDecision(raw) {
  const source = isPlainObject(raw) ? raw : {}
  const plan = isPlainObject(source.plan)
    ? {
        steps: stringList(source.plan.steps, 40, 400),
        effort: ['S', 'M', 'L'].includes(source.plan.effort) ? source.plan.effort : 'M',
        risks: stringList(source.plan.risks, 30, 400),
        // Only emit `upstream` when the plan actually has one: tool results are
        // validated as lossless JSON, and an own property holding `undefined`
        // makes the whole result invalid.
        ...(isPlainObject(source.plan.upstream)
          ? {
              upstream: {
                repo: nullableString(source.plan.upstream.repo, 400),
                fork: Boolean(source.plan.upstream.fork),
                attribution: truncate(source.plan.upstream.attribution, 600),
                licenseNote: truncate(source.plan.upstream.licenseNote, 600),
              },
            }
          : {}),
        acceptCriteria: stringList(source.plan.acceptCriteria, 30, 400),
      }
    : null
  return {
    kind: DECISION_KINDS.includes(source.kind) ? source.kind : 'reject',
    rationale: truncate(source.rationale, 3000),
    at: finiteOr(source.at, nowMs()),
    intentRev: Math.max(1, Math.trunc(Number(source.intentRev) || 1)),
    plan,
  }
}

export function normalizeExecution(raw) {
  const source = isPlainObject(raw) ? raw : {}
  return {
    kind: ['install', 'complete', 'build', 'gap'].includes(source.kind) ? source.kind : 'complete',
    startedAt: finiteOr(source.startedAt, nowMs()),
    bundlePath: nullableString(source.bundlePath, 800),
    sessionId: nullableString(source.sessionId, 120),
    steps: asArray(source.steps)
      .filter(isPlainObject)
      .slice(0, 60)
      .map((step) => ({
        at: finiteOr(step.at, nowMs()),
        text: truncate(step.text, 400),
        done: Boolean(step.done),
      })),
  }
}

export function normalizeVerification(raw) {
  const source = isPlainObject(raw) ? raw : {}
  const checks = asArray(source.checks)
    .filter(isPlainObject)
    .slice(0, 80)
    .map((check) => ({
      level: ['L0', 'L1', 'L2', 'L3', 'L4', 'L5'].includes(check.level) ? check.level : 'L0',
      name: truncate(check.name, 200) || '检查项',
      status: ['pass', 'fail', 'skip'].includes(check.status) ? check.status : 'skip',
      detail: truncate(check.detail, 1200),
      at: finiteOr(check.at, nowMs()),
    }))
  return {
    passed: Boolean(source.passed),
    gate: ['L0', 'L1', 'L2', 'L3', 'L4', 'L5', 'none'].includes(source.gate) ? source.gate : 'none',
    at: finiteOr(source.at, nowMs()),
    checks,
  }
}

export function normalizeInstall(raw) {
  const source = isPlainObject(raw) ? raw : {}
  return {
    spec: truncate(source.spec, 600),
    at: finiteOr(source.at, nowMs()),
    application: ['applied', 'restart-required', 'overridden', 'failed', 'cancelled'].includes(source.application)
      ? source.application
      : 'failed',
    version: nullableString(source.version, 80),
    bundle: nullableString(source.bundle, 200),
    warnings: stringList(source.warnings, 30, 400),
    evidenceHash: nullableString(source.evidenceHash, 120),
    rollback: isPlainObject(source.rollback)
      ? { kind: 'remove-bundle', name: truncate(source.rollback.name, 200) }
      : null,
    ...(source.error ? { error: truncate(source.error, 1200) } : {}),
  }
}

/** Append one history entry in place and bump the record clock. */
export function addHistory(record, kind, detail, at = nowMs()) {
  record.history = asArray(record.history).slice(-399)
  record.history.push({ at, kind: truncate(kind, 60), detail: truncate(detail, 600) })
  record.updatedAt = at
  return record
}

/** Display title; falls back to the first intent line. */
export function recordTitle(record) {
  const title = asString(record?.intent?.title).trim()
  if (title.length > 0) return title
  return titleFrom(record?.intent?.text)
}

/** The one action the panel should emphasize right now. */
export function primaryActionOf(record) {
  const status = record?.status
  if (['installed', 'archived', 'rejected'].includes(status)) return 'none'
  const kind = record?.decision?.kind
  if (kind === 'install') return 'install'
  if (kind === 'complete-then-install') return 'complete'
  if (kind === 'build') return 'build'
  if (kind === 'reject') return 'none'
  if (status === 'awaiting-approval') return 'review'
  return 'work'
}

/**
 * Install may be pressed only for a decided, audited, not-unsafe candidate.
 * The panel hides the button with the same predicate; the Host re-checks it
 * before touching the profile.
 */
export function isInstallable(record) {
  if (!record || record.status === 'archived' || record.status === 'rejected') return false
  if (record.status === 'installed') return false
  const kind = record?.decision?.kind
  if (kind !== 'install' && kind !== 'complete-then-install') return false
  if (!record?.candidate?.spec) return false
  if (record?.audit && record.audit.verdict === 'unsafe') return false
  // 残血不装: the install gate only opens for a full-blood candidate, whichever
  // decision produced it. A completed/forged bundle must be re-audited and
  // re-decided (and therefore re-scored as full) before it can be installed.
  if (record?.blood && record.blood.label !== 'full') return false
  // A requirement amendment invalidates the old decision and gap analysis.
  if (record?.blood?.stale === true) return false
  if (record?.decision && Number(record.decision.intentRev ?? 1) !== record.intent.rev) return false
  return true
}

/** List projection consumed by the panel; shape frozen in docs/PANEL-API.md. */
export function summarizeRecord(record) {
  const audit = record.audit
  const blood = record.blood
  const decision = record.decision
  const revisions = asArray(record.intent.revisions)
  return {
    id: record.id,
    title: recordTitle(record),
    intent: record.intent.text,
    status: record.status,
    statusReason: record.statusReason,
    bloodLabel: blood?.label ?? null,
    bloodScore: blood?.score ?? null,
    auditScore: audit?.score ?? null,
    auditVerdict: audit?.verdict ?? null,
    evidenceLevel: audit?.evidenceLevel ?? null,
    candidateName: record.candidate?.name ?? null,
    candidateCount: asArray(record.candidates).length,
    createdAt: record.createdAt,
    updatedAt: record.updatedAt,
    sessionId: record.execution?.sessionId ?? null,
    installable: isInstallable(record),
    primaryAction: primaryActionOf(record),
    installed: record.status === 'installed',
    gaps: blood?.gaps?.length ?? 0,
    intentRev: record.intent.rev,
    revisionCount: revisions.length,
    gapRound: blood?.round ?? 0,
    bloodStale: blood?.stale === true,
    decisionStale: Boolean(decision && (Number(decision.intentRev ?? 1) !== record.intent.rev || blood?.stale === true)),
  }
}

/** Highest verification level with every check passing up to it. */
export function verificationGate(checks) {
  let gate = 'none'
  for (const level of ['L0', 'L1', 'L2', 'L3', 'L4', 'L5']) {
    const ofLevel = checks.filter((check) => check.level === level)
    if (ofLevel.length === 0) break
    if (ofLevel.some((check) => check.status === 'fail')) break
    if (ofLevel.some((check) => check.status === 'pass')) gate = level
  }
  return gate
}

/**
 * The markdown brief a session receives. It is the operational contract for
 * the agent: what to do, in which order, which tool writes the evidence back,
 * and which rules may not be bent.
 */
export function briefFor(record, kind = 'work') {
  const lines = []
  const depth = DEPTH_LABELS[record.intent.depth] ?? '标准'
  const revisions = asArray(record.intent.revisions)
  lines.push(`# 插件锻造任务 · ${recordTitle(record)}`)
  lines.push('')
  lines.push(`- 记录 ID：\`${record.id}\``)
  lines.push(`- 深度：${depth}`)
  lines.push(`- 需求版本：rev ${record.intent.rev}${revisions.length > 1 ? `（已增补 ${revisions.length - 1} 次）` : ''}`)
  lines.push(`- 当前状态：${STATUS_LABELS[record.status] ?? record.status}`)
  if (record.blood) lines.push(`- 缺口轮次：第 ${record.blood.round} 轮${record.blood.stale ? '（已过期，需复查）' : ''}`)
  lines.push('')
  lines.push('## 用户原话')
  lines.push('')
  lines.push(record.intent.text || '（空）')
  lines.push('')
  if (revisions.length > 1) {
    lines.push('## 需求增补历史')
    for (const revision of revisions.slice(1)) {
      lines.push(`- rev ${revision.rev}（${revision.source === 'user' ? '用户' : '模型'}）：${revision.text}`)
    }
    lines.push('')
  }
  if (record.intent.capabilities.length > 0) {
    lines.push('## 已拆解的能力')
    for (const item of record.intent.capabilities) lines.push(`- ${item}`)
    lines.push('')
  }
  if (record.intent.constraints.length > 0) {
    lines.push('## 约束')
    for (const item of record.intent.constraints) lines.push(`- ${item}`)
    lines.push('')
  }

  if (kind === 'gap') {
    lines.push('## 这次要做的：需求增补后的缺口复查')
    lines.push('')
    lines.push(`需求已到 rev ${record.intent.rev}。请按**最新需求**逐条对照候选/已安装能力，重新判 present/partial/missing：`)
    lines.push('1. 先读 `plugin_scout({action:"get", id})` 里的 intent.revisions，确认这次增补到底加了什么。')
    lines.push('2. 逐条复核能力：已有能力是否仍然覆盖新要求？新增要求有没有对应能力？')
    lines.push(`3. 调用 \`plugin_scout({action:"blood", id, next_round:true, gaps:[...]})\` 写第 ${(record.blood?.round ?? 0) + 1} 轮缺口分析（缺口为 0 也要明确写成空）。`)
    lines.push('4. 重新 `decide`：满血 → install；仍有缺口 → complete-then-install；候选已不适用 → build/reject。')
    lines.push('5. 若需要补齐，按缺口逐条实现并验证，再回到安装流程。')
    lines.push('')
  } else if (kind === 'complete') {
    lines.push('## 这次要做的：把残血补成满血')
    lines.push('')
    lines.push('已选中的候选功能不完整，**不允许直接安装残血版**。请按缺口清单补齐，产出可安装的满血版本。')
    lines.push('')
    const gaps = record.blood?.gaps ?? []
    if (gaps.length > 0) {
      for (const gap of gaps) {
        lines.push(`- [${gap.kind}/${gap.effort}] ${gap.capability}：${gap.remedy || '待设计补齐方案'}`)
        if (gap.evidence) lines.push(`  - 证据：${gap.evidence}`)
      }
    } else {
      lines.push('- 缺口分析为空：先补做血量分析（plugin_scout action=blood），再动手。')
    }
    lines.push('')
  } else if (kind === 'build') {
    lines.push('## 这次要做的：从零锻造')
    lines.push('')
    lines.push('没有可用的现成候选，请按需求自己造一个 DSH bundle，做完必须能装上并跑通。')
    lines.push('')
  } else {
    lines.push('## 这次要做的：把这条需求推进到底')
    lines.push('')
    lines.push('按下面的流水线推进；每完成一段，就把结构化结果写回记录。')
    lines.push('')
  }

  lines.push('## 流水线（用 plugin_scout 工具写回）')
  lines.push('')
  lines.push('1. **侦察** `plugin_scout({action:"candidates", ...})`：市场索引、npm、GitHub、社区反馈，至少 3 个候选，给出 fit/quality/maintenance/risk 分。')
  lines.push('2. **验毒** `plugin_scout({action:"audit", ...})`：本地包传 path 做静态审计；registry 包传 package_name 拉元数据审计。安全分 < 60 或 verdict=unsafe 的候选直接淘汰。')
  lines.push('3. **血量** `plugin_scout({action:"blood", ...})`：逐条能力判断 present/partial/missing，写 gaps（阉割=cut、残缺=incomplete、过时=stale、缺集成=integration、体验=ux），给出 remedy/effort/risk。需求增补后的复查用 `next_round:true`，写新一轮缺口。')
  lines.push('4. **决策** `plugin_scout({action:"decide", kind, rationale, plan})`：kind = install（满血直装）/ complete-then-install（补齐后装）/ build（自建）/ reject（全否）。')
  lines.push('5. **执行**：把 bundle 放到工作区，用 `plugin_scout({action:"get"})` 和 update 记录进度与 bundlePath。')
  lines.push('6. **验收** `plugin_scout({action:"verify", ...})`：先跑自动门禁 L0（manifest/patch/语法），本地 bundle 再跑 L1（自带测试）。L3/L4 的界面与行为检查以人工或工具证据补写。')
  lines.push('7. **安装**：只有在验收通过、且用户在面板点击安装后，才调用 `plugin_scout({action:"install"})`。安装结果会自动写回。')
  lines.push('8. **需求增补**：用户补充需求时调用 `plugin_scout({action:"amend", id, text})`；它会作废旧决策、标记缺口过期，然后按 gap 流程复查。不要在旧决策上继续。')
  lines.push('')
  if (kind === 'complete' || kind === 'build') {
    lines.push('补齐/自建完成后：把产出放到工作区的 bundle 目录，用 `verify` 跑门禁；**通过后再调用一次 `decide`（kind=install）**，让记录进入安装确认，然后请用户在面板点安装。不要在旧决策上直接装。')
    lines.push('')
  }

  const state = []
  if (record.candidate) state.push(`- 已选候选：${record.candidate.name}${record.candidate.version ? `@${record.candidate.version}` : ''}`)
  if (record.audit) state.push(`- 审计：${record.audit.score ?? '—'}/100 ${record.audit.verdict}（${record.audit.evidenceLevel}）`)
  if (record.blood) state.push(`- 血量：${BLOOD_LABELS[record.blood.label]} ${record.blood.score ?? '—'}/100，缺口 ${record.blood.gaps.length} 项`)
  if (record.decision) state.push(`- 决策：${record.decision.kind}`)
  if (record.verification) state.push(`- 验收：${record.verification.passed ? '通过' : '未通过'}（gate ${record.verification.gate}）`)
  if (state.length > 0) {
    lines.push('## 记录现状')
    lines.push('')
    for (const line of state) lines.push(line)
    lines.push('')
  }

  lines.push('## 硬性规则')
  lines.push('')
  lines.push('- 不审计不装：没有 audit 记录的候选不得进入决策。')
  lines.push('- 残血不装：blood.label 不是 full 时，只能走 complete-then-install 或 build；直接装会被门禁拒绝。')
  lines.push('- 需求变更即失效：rev 变了以后旧决策（decision.intentRev 落后）和旧缺口分析（blood.stale）都不再可用，必须复查缺口再决策。')
  lines.push('- 安装只走 `plugin_scout({action:"install"})`：它跑门禁、写安装记录、留回滚点。不要直接调用 plugin_manager 安装。')
  lines.push('- 不碰真实 profile 之外的东西；任何派生/改写都必须保留上游来源、license 与署名。')
  lines.push('- 用户没有点“安装”之前，不要改变已安装插件的状态。')
  lines.push('')
  lines.push('## 收尾')
  lines.push('')
  lines.push('最后调用 `plugin_scout({action:"get", id:"' + record.id + '"})` 确认记录完整，再用一句话向用户汇报：找到什么、验了什么、补了什么、测了什么、装没装。')
  lines.push('')
  lines.push(`> 生成于 ${formatTime(nowMs())}，记录更新于 ${formatTime(record.updatedAt)}。`)
  return lines.join('\n')
}

// ---------------------------------------------------------------------------
// small internal helpers

function finiteOr(value, fallback) {
  const number = Number(value)
  return Number.isFinite(number) ? number : fallback
}

function scoreOrNull(value) {
  const number = Number(value)
  if (!Number.isFinite(number)) return null
  return Math.max(0, Math.min(100, Math.round(number)))
}

function nullableString(value, max) {
  if (typeof value !== 'string') return null
  const text = value.trim()
  return text.length === 0 ? null : truncate(text, max)
}

function stringList(value, limit, max) {
  return asArray(value)
    .filter((entry) => typeof entry === 'string' && entry.trim().length > 0)
    .slice(0, limit)
    .map((entry) => truncate(entry.trim(), max))
}

function verdictOf(score) {
  if (typeof score !== 'number') return 'unknown'
  if (score >= 80) return 'safe'
  if (score >= 60) return 'caution'
  return 'unsafe'
}
