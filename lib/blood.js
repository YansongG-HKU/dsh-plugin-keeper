/**
 * Blood analysis: is the candidate 满血 (full), 残血 (thin) or 阉割 (cut)?
 *
 * Finding a plugin is not the same as finding the capability. A package can ship
 * 60% of a feature, gate the rest behind a paid tier, drift out of compatibility,
 * or stop at a demo. This module turns a capability gap list into a comparable
 * 0–100 score and a label the panel and the decision gate both trust.
 *
 * The scoring is deterministic so a record can be re-checked months later and a
 * different model run cannot inflate the number.
 */

import { BLOOD_LABELS } from './records.js'

/** Base severity of each gap kind, before state/effort modifiers. */
export const GAP_WEIGHT = {
  cut: 24,
  incomplete: 17,
  stale: 12,
  integration: 10,
  ux: 6,
  unknown: 10,
}

/** A missing capability costs more than a partially present one. */
const STATE_MULTIPLIER = { missing: 1, partial: 0.6 }
/** A large remedy does not make a worse feature, only a longer road. */
const EFFORT_MULTIPLIER = { S: 0.8, M: 1, L: 1.15 }

/** Score → label thresholds. Any `cut` gap caps the score below the thin band. */
export const FULL_THRESHOLD = 90
export const THIN_THRESHOLD = 60
export const CUT_CAP = 45
/**
 * Derive a complete Blood object from gap evidence.
 *
 * @param {object} input
 * @param {Array<object>} [input.gaps] normalized gaps
 * @param {number} [input.score] explicit score (agent override; label still derived)
 * @param {string} [input.label] explicit label, honored only when consistent with evidence
 * @param {string} [input.summary] explicit summary
 * @returns {{score: number, label: string, summary: string, gaps: Array<object>}}
 */
export function deriveBlood({ gaps = [], score, label, summary } = {}) {
  const normalized = Array.isArray(gaps) ? gaps : []
  const computed = clampScore(100 - normalized.reduce((total, gap) => total + gapCost(gap), 0))
  // A single cut gap caps the score; any reported gap at all keeps it out of 满血.
  let capped = computed
  if (normalized.some((gap) => gap?.kind === 'cut')) capped = Math.min(capped, CUT_CAP)
  if (normalized.length > 0) capped = Math.min(capped, FULL_THRESHOLD - 1)
  const finalScore = typeof score === 'number' && Number.isFinite(score) ? clampScore(score) : capped
  const derivedLabel = labelOf(finalScore)
  // An explicit label may only downgrade the evidence: never claim 满血 over a gap.
  const finalLabel = label && labelRank(label) >= labelRank(derivedLabel) ? label : derivedLabel
  const consistentScore = finalLabel === 'cut' ? Math.min(finalScore, CUT_CAP) : finalScore
  return {
    score: consistentScore,
    label: finalLabel,
    summary: typeof summary === 'string' && summary.trim().length > 0 ? summary : summarizeGaps(normalized, finalLabel),
    gaps: normalized,
  }
}

/** One gap's score cost. */
export function gapCost(gap) {
  const base = GAP_WEIGHT[gap?.kind] ?? GAP_WEIGHT.unknown
  const state = STATE_MULTIPLIER[gap?.state] ?? 1
  const effort = EFFORT_MULTIPLIER[gap?.effort] ?? 1
  return base * state * effort
}

/** Score band. */
export function labelOf(score) {
  if (typeof score !== 'number' || !Number.isFinite(score)) return 'unknown'
  if (score >= FULL_THRESHOLD) return 'full'
  if (score >= THIN_THRESHOLD) return 'thin'
  return 'cut'
}

/** Lower rank = better; used so an explicit label can only downgrade. */
function labelRank(label) {
  if (label === 'full') return 0
  if (label === 'thin') return 1
  if (label === 'cut') return 2
  return 3
}

/** Human summary for the brief and the panel detail. */
export function summarizeGaps(gaps, label) {
  if (gaps.length === 0) {
    return label === 'full' ? '能力覆盖完整，未发现阉割或残缺。' : '未提供缺口证据，无法判定是否满血。'
  }
  const cut = gaps.filter((gap) => gap.kind === 'cut').length
  const incomplete = gaps.filter((gap) => gap.kind === 'incomplete').length
  const parts = [`共 ${gaps.length} 处缺口`]
  if (cut > 0) parts.push(`${cut} 处阉割`)
  if (incomplete > 0) parts.push(`${incomplete} 处残缺`)
  const labelText = BLOOD_LABELS[label] ?? label
  return `${labelText}：${parts.join('，')}。`
}

function clampScore(value) {
  if (!Number.isFinite(value)) return 0
  return Math.max(0, Math.min(100, Math.round(value)))
}
