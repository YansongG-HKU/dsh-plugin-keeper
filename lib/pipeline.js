/**
 * The demand state machine and the decision gate.
 *
 * The ledger can hold any record at any status, but a *transition* and a
 * *decision* are policy, not data. Keeping them here means the panel, the agent
 * tool, and the installer all reach the same verdict for the same evidence:
 *
 *   install               → full-blood candidate, safe audit, verified
 *   complete-then-install → safe candidate, but gaps must be closed first
 *   build                 → nothing safe/complete enough exists
 *   reject                → evidence says stop
 *
 * A model may disagree, but only explicitly (`force: true` plus a written
 * rationale), and the override is recorded in the history.
 */

import { BLOOD_LABELS, addHistory, normalizeBlood, normalizeDecision } from './records.js'
import { nowMs } from './util.js'

/** Allowed status moves. Terminal states only come back through `reopen`. */
export const TRANSITIONS = {
  intake: ['scouting', 'auditing', 'decision', 'blocked', 'rejected', 'archived'],
  scouting: ['auditing', 'decision', 'blocked', 'rejected', 'archived'],
  auditing: ['decision', 'scouting', 'blocked', 'rejected', 'archived'],
  decision: ['awaiting-approval', 'scouting', 'auditing', 'blocked', 'rejected', 'archived'],
  'awaiting-approval': ['executing', 'decision', 'verifying', 'ready', 'rejected', 'archived'],
  executing: ['verifying', 'ready', 'blocked', 'decision', 'rejected', 'archived'],
  verifying: ['ready', 'installed', 'blocked', 'executing', 'decision', 'archived'],
  ready: ['installed', 'executing', 'verifying', 'decision', 'archived'],
  installed: ['archived'],
  blocked: ['scouting', 'auditing', 'decision', 'executing', 'verifying', 'rejected', 'archived'],
  rejected: ['archived', 'decision'],
  archived: [],
}

/** Statuses that end the flow unless the user reopens the record. */
export const TERMINAL_STATUSES = new Set(['installed', 'rejected', 'archived'])

/** Whether `from → to` is a normal move. */
export function canTransition(from, to) {
  if (!TRANSITIONS[from]) return false
  return TRANSITIONS[from].includes(to)
}

/**
 * Move a record. Throws only when the move is impossible without an override;
 * callers pass `force: true` for an intentional jump and it is logged.
 */
export function transitionRecord(record, to, { reason = '', actor = 'agent', force = false, at = nowMs() } = {}) {
  if (!TRANSITIONS[to]) throw new Error(`Unknown status: ${to}`)
  const from = record.status
  if (from === to) {
    record.statusReason = reason || record.statusReason
    record.updatedAt = at
    return record
  }
  const allowed = canTransition(from, to)
  if (!allowed && !force) {
    throw new Error(`不允许从 ${from} 转到 ${to}；如确有必要，请带 force 并说明理由`)
  }
  record.status = to
  record.statusReason = reason ? String(reason).slice(0, 400) : record.statusReason
  addHistory(record, allowed ? 'transition' : 'transition-forced', `${from} → ${to}${reason ? `：${reason}` : ''}`, at)
  return record
}

/**
 * What the evidence currently supports. `null` means more work is required
 * before a decision can be justified.
 */
export function recommendationOf(record) {
  const candidates = Array.isArray(record?.candidates) ? record.candidates : []
  const audit = record?.audit
  const blood = record?.blood
  const selected = record?.candidate

  if (candidates.length === 0 && !selected) return 'build'
  if (!audit) return null
  if (audit.verdict === 'unsafe') {
    const otherSafe = candidates.some((candidate) => candidate.name !== selected?.name)
    return otherSafe ? null : 'build'
  }
  if (typeof audit.score === 'number' && audit.score < 60) {
    const otherSafe = candidates.some((candidate) => candidate.name !== selected?.name)
    return otherSafe ? null : 'build'
  }
  if (!blood) return null
  // A requirement amendment invalidates the old gap analysis: more work is
  // required before any recommendation is honest.
  if (blood.stale === true) return null
  if (blood.label === 'full') return 'install'
  return 'complete-then-install'
}

/**
 * Validate a decision against the evidence.
 *
 * @returns {{ok: true, warnings: string[]} | {ok: false, error: string, recommended: string|null}}
 */
export function validateDecision(record, kind, { force = false, rationale = '' } = {}) {
  const recommended = recommendationOf(record)
  const audit = record?.audit
  const blood = record?.blood
  const candidate = record?.candidate

  if (kind === 'reject') {
    if (!rationale || rationale.trim().length < 10) {
      return { ok: false, error: '否决必须写清理由（至少 10 个字），否则记录无法复核', recommended }
    }
    return { ok: true, warnings: [] }
  }

  if (kind !== 'install' && kind !== 'complete-then-install' && kind !== 'build') {
    return { ok: false, error: `未知的决策类型：${kind}`, recommended }
  }

  if (kind === 'build') {
    if (candidate && blood?.label === 'full' && audit && audit.verdict !== 'unsafe') {
      if (!force) {
        return {
          ok: false,
          error: '已有满血且安全的候选，自建需要 force 并说明为什么不直接用现成的（避免重复造轮子）',
          recommended,
        }
      }
      return { ok: true, warnings: ['已有可用候选仍选择自建（已记录理由）'] }
    }
    return { ok: true, warnings: [] }
  }

  // install / complete-then-install
  if (!candidate) return { ok: false, error: '还没有选定候选，不能进入安装类决策', recommended }
  if (!audit) return { ok: false, error: '候选还没有审计报告；先跑 plugin_scout action=audit', recommended }
  if (audit.verdict === 'unsafe') {
    return { ok: false, error: '审计结论为 unsafe，禁止安装该候选；换候选或自建', recommended }
  }
  if (typeof audit.score === 'number' && audit.score < 60) {
    if (!force) {
      return { ok: false, error: `审计分 ${audit.score} 低于 60，安装需要 force 与书面理由`, recommended }
    }
  }
  if (!blood) return { ok: false, error: '还没有血量分析；先跑 plugin_scout action=blood', recommended }
  if (blood.stale === true) {
    return { ok: false, error: '需求已增补，缺口分析已过期；先用 blood({next_round:true}) 复查缺口再决策', recommended }
  }

  if (kind === 'install') {
    if (blood.label !== 'full') {
      return {
        ok: false,
        error: `血量为${BLOOD_LABELS[blood.label] ?? blood.label}，残血/阉割不得直接安装；改为 complete-then-install 补齐，或 build 自建`,
        recommended: recommendationOf({ ...record, blood: normalizeBlood(blood) }),
      }
    }
    if (blood.gaps.length > 0 && !force) {
      return { ok: false, error: '血量标为满血但仍列了缺口，证据自相矛盾；先修正 blood 或带 force', recommended }
    }
    if (record.verification && record.verification.passed === false && !force) {
      return { ok: false, error: '上次验收未通过，不能直接判定安装；先修复并重新 verify', recommended }
    }
    return { ok: true, warnings: force ? ['带 force 通过决策门禁（已记录）'] : [] }
  }

  // complete-then-install
  if (blood.label === 'full' && blood.gaps.length === 0) {
    if (!force) {
      return {
        ok: false,
        error: '血量已是满血且无缺口，不需要补齐；直接 install 即可',
        recommended: 'install',
      }
    }
  }
  return { ok: true, warnings: force ? ['带 force 通过决策门禁（已记录）'] : [] }
}

/** Apply a validated decision and move the record to the review gate. */
export function applyDecision(record, { kind, rationale, plan = null, actor = 'agent', force = false, at = nowMs() }) {
  const validation = validateDecision(record, kind, { force, rationale })
  if (!validation.ok) {
    const error = new Error(validation.error)
    error.recommended = validation.recommended
    throw error
  }
  record.decision = normalizeDecision({ kind, rationale, plan, at, intentRev: record?.intent?.rev ?? 1 })
  addHistory(record, 'decision', `决策 ${kind}：${String(rationale).slice(0, 200)}`, at)
  if (kind === 'reject') transitionRecord(record, 'rejected', { reason: rationale, actor, at })
  else transitionRecord(record, 'awaiting-approval', { reason: '等待用户确认', actor, at, force: true })
  return { record, warnings: validation.warnings }
}

/**
 * Whether the pre-install gate may run. Separate from `isInstallable` because
 * the host re-checks this immediately before touching the profile.
 */
export function installGate(record) {
  if (!record) return { ok: false, error: '记录不存在' }
  if (!record.candidate?.spec) return { ok: false, error: '候选没有可安装的 spec' }
  if (record.status === 'installed') return { ok: false, error: '该记录已经安装过了' }
  if (record.status === 'archived' || record.status === 'rejected') {
    return { ok: false, error: '记录已归档或被否决，先 reopen' }
  }
  if (!record.decision || !['install', 'complete-then-install'].includes(record.decision.kind)) {
    return { ok: false, error: '还没有同意安装的决策；先 decide' }
  }
  if (record.audit && record.audit.verdict === 'unsafe') {
    return { ok: false, error: '审计结论 unsafe，Host 拒绝安装' }
  }
  // A requirement amendment makes the old decision and gap analysis obsolete.
  const decisionRev = Number(record.decision.intentRev ?? 1)
  if (decisionRev !== record.intent.rev) {
    return {
      ok: false,
      error: `需求已增补到 rev ${record.intent.rev}，旧决策（rev ${decisionRev}）失效；先复查缺口并重新决策`,
    }
  }
  if (record.blood?.stale === true) {
    return { ok: false, error: '需求已增补，缺口分析已过期；Host 拒绝安装，先复查缺口' }
  }
  // 残血不装: applies to every decision kind. A bundle produced by the completion
  // or forge path must be re-audited, re-scored as full, and re-decided first.
  if (record.blood && record.blood.label !== 'full') {
    return { ok: false, error: `血量为${BLOOD_LABELS[record.blood.label] ?? record.blood.label}，Host 拒绝安装；先补齐并重新做血量分析与决策` }
  }
  if (record.verification && record.verification.passed === false) {
    return { ok: false, error: '验收未通过，Host 拒绝安装' }
  }
  return { ok: true }
}
