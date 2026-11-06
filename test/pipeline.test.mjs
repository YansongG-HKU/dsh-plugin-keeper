import test from 'node:test'
import assert from 'node:assert/strict'

import { applyDecision, installGate, recommendationOf, transitionRecord, validateDecision } from '../lib/pipeline.js'
import { emptyRecord, normalizeAudit } from '../lib/records.js'
import { deriveBlood } from '../lib/blood.js'

function withCandidate(overrides = {}) {
  const record = emptyRecord({ text: '需要导出 PDF 的插件' })
  record.id = 'sc-test'
  record.candidate = { name: 'pdf-exporter', spec: 'pdf-exporter', source: 'npm', version: '1.0.0' }
  record.candidates = [record.candidate]
  return { ...record, ...overrides }
}

const safeAudit = (score = 88) => normalizeAudit({ score, verdict: score >= 80 ? 'safe' : 'caution', evidenceLevel: 'static' })

test('install is refused before there is any audit', () => {
  const record = withCandidate()
  const result = validateDecision(record, 'install', { rationale: '看起来不错' })
  assert.equal(result.ok, false)
  assert.match(result.error, /审计/)
})

test('an unsafe audit blocks every install kind', () => {
  const record = withCandidate({ audit: normalizeAudit({ score: 12, verdict: 'unsafe' }), blood: deriveBlood({ gaps: [] }) })
  assert.equal(validateDecision(record, 'install', { rationale: 'x'.repeat(20) }).ok, false)
  assert.equal(validateDecision(record, 'complete-then-install', { rationale: 'x'.repeat(20) }).ok, false)
  assert.equal(recommendationOf(record), 'build')
})

test('a thin candidate cannot be installed directly, only completed', () => {
  const record = withCandidate({ audit: safeAudit(), blood: deriveBlood({ gaps: [{ id: '1', capability: '批量', state: 'missing', kind: 'cut', effort: 'M' }] }) })
  const install = validateDecision(record, 'install', { rationale: 'x'.repeat(20) })
  assert.equal(install.ok, false)
  assert.match(install.error, /残血|阉割/)
  const complete = validateDecision(record, 'complete-then-install', { rationale: 'x'.repeat(20) })
  assert.equal(complete.ok, true)
  assert.equal(recommendationOf(record), 'complete-then-install')
})

test('a full-blood safe candidate installs', () => {
  const record = withCandidate({ audit: safeAudit(), blood: deriveBlood({ gaps: [] }) })
  assert.equal(recommendationOf(record), 'install')
  assert.equal(validateDecision(record, 'install', { rationale: '满血且安全' }).ok, true)
})

test('building from scratch against a full-blood candidate needs force', () => {
  const record = withCandidate({ audit: safeAudit(), blood: deriveBlood({ gaps: [] }) })
  assert.equal(validateDecision(record, 'build', { rationale: 'x'.repeat(20) }).ok, false)
  assert.equal(validateDecision(record, 'build', { rationale: 'x'.repeat(20), force: true }).ok, true)
})

test('reject requires a written reason', () => {
  const record = withCandidate()
  assert.equal(validateDecision(record, 'reject', { rationale: '算了' }).ok, false)
  assert.equal(validateDecision(record, 'reject', { rationale: '没有候选满足要求，且自建成本过高' }).ok, true)
})

test('applyDecision moves to review; reject is terminal', () => {
  const record = withCandidate({ audit: safeAudit(), blood: deriveBlood({ gaps: [] }) })
  applyDecision(record, { kind: 'install', rationale: '满血且安全，覆盖全部能力', plan: null })
  assert.equal(record.status, 'awaiting-approval')
  assert.equal(record.decision.kind, 'install')

  const rejected = withCandidate()
  applyDecision(rejected, { kind: 'reject', rationale: '没有候选可用且自建不划算', plan: null })
  assert.equal(rejected.status, 'rejected')
})

test('transitions are enforced unless forced', () => {
  const record = emptyRecord({ text: 'x' })
  assert.throws(() => transitionRecord(record, 'installed'))
  transitionRecord(record, 'installed', { force: true, reason: 'test' })
  assert.equal(record.status, 'installed')
})

test('installGate blocks thin blood, failed verification and missing spec', () => {
  const base = withCandidate({
    audit: safeAudit(),
    blood: deriveBlood({ gaps: [] }),
    decision: { kind: 'install', rationale: 'x', at: 1, plan: null },
  })
  assert.equal(installGate(base).ok, true)

  const thin = withCandidate({ ...base, blood: deriveBlood({ gaps: [{ id: '1', capability: 'c', state: 'partial', kind: 'ux', effort: 'S' }] }) })
  assert.equal(installGate(thin).ok, false)

  // The completion path must not become a side door: a thin candidate stays
  // uninstallable even when the decision is complete-then-install.
  const thinComplete = withCandidate({
    ...base,
    blood: deriveBlood({ gaps: [{ id: '1', capability: 'c', state: 'missing', kind: 'cut', effort: 'M' }] }),
    decision: { kind: 'complete-then-install', rationale: 'x', at: 1, plan: null },
  })
  assert.equal(installGate(thinComplete).ok, false)

  const failedVerify = { ...base, verification: { passed: false, gate: 'L0', at: 1, checks: [] } }
  assert.equal(installGate(failedVerify).ok, false)

  const noSpec = { ...base, candidate: { name: 'pkg', source: 'npm' } }
  assert.equal(installGate(noSpec).ok, false)
})
