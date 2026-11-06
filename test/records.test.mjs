import test from 'node:test'
import assert from 'node:assert/strict'

import {
  briefFor,
  emptyRecord,
  isInstallable,
  normalizeAudit,
  normalizeRecord,
  primaryActionOf,
  summarizeRecord,
  verificationGate,
} from '../lib/records.js'
import { deriveBlood } from '../lib/blood.js'

test('emptyRecord fills every documented field', () => {
  const record = emptyRecord({ text: '  需要一个能把会话导出成 PDF 的插件  ', depth: 'deep' })
  assert.equal(record.status, 'intake')
  assert.equal(record.intent.depth, 'deep')
  assert.equal(record.intent.title.length > 0, true)
  assert.deepEqual(record.candidates, [])
  assert.equal(record.audit, null)
  assert.equal(record.blood, null)
  assert.equal(record.approval, null)
  assert.ok(Array.isArray(record.history))
  assert.equal(record.history.length, 1)
})

test('normalizeRecord survives garbage and keeps the required shape', () => {
  const record = normalizeRecord({ id: 'sc-x', intent: { text: 'hi' }, status: 'wat', candidates: 'nope' })
  assert.equal(record.status, 'intake')
  assert.deepEqual(record.candidates, [])
  assert.equal(typeof record.intent.title, 'string')
  assert.equal(record.links.sessionIds.length, 0)
})

test('summary projection exposes the frozen panel keys', () => {
  const record = emptyRecord({ text: '导出 PDF' })
  record.id = 'sc-1'
  record.audit = normalizeAudit({ score: 91, verdict: 'safe', evidenceLevel: 'static' })
  record.blood = deriveBlood({ gaps: [] })
  const summary = summarizeRecord(record)
  for (const key of [
    'id',
    'title',
    'intent',
    'status',
    'bloodLabel',
    'bloodScore',
    'auditScore',
    'auditVerdict',
    'evidenceLevel',
    'candidateName',
    'candidateCount',
    'createdAt',
    'updatedAt',
    'sessionId',
    'installable',
    'primaryAction',
  ]) {
    assert.ok(key in summary, `summary missing ${key}`)
  }
  assert.equal(summary.bloodLabel, 'full')
  assert.equal(summary.auditScore, 91)
})

test('primaryAction follows the decision, not the status alone', () => {
  const record = emptyRecord({ text: 'x' })
  assert.equal(primaryActionOf(record), 'work')
  record.decision = { kind: 'install', rationale: 'x', at: 1, plan: null }
  assert.equal(primaryActionOf(record), 'install')
  record.decision = { kind: 'complete-then-install', rationale: 'x', at: 1, plan: null }
  assert.equal(primaryActionOf(record), 'complete')
  record.decision = { kind: 'build', rationale: 'x', at: 1, plan: null }
  assert.equal(primaryActionOf(record), 'build')
  record.status = 'installed'
  assert.equal(primaryActionOf(record), 'none')
})

test('isInstallable demands a spec, a decision and no unsafe verdict', () => {
  const record = emptyRecord({ text: 'x' })
  record.candidate = { name: 'pkg', spec: 'pkg', source: 'npm' }
  record.decision = { kind: 'install', rationale: 'x', at: 1, plan: null }
  assert.equal(isInstallable(record), true)
  record.audit = normalizeAudit({ score: 10, verdict: 'unsafe' })
  assert.equal(isInstallable(record), false)
  record.audit = normalizeAudit({ score: 90, verdict: 'safe' })
  record.candidate = null
  assert.equal(isInstallable(record), false)
})

test('isInstallable refuses a thin/cut candidate even when decided complete-then-install', () => {
  const record = emptyRecord({ text: 'x' })
  record.candidate = { name: 'pkg', spec: 'pkg', source: 'npm' }
  record.audit = normalizeAudit({ score: 90, verdict: 'safe' })
  record.decision = { kind: 'complete-then-install', rationale: 'x', at: 1, plan: null }
  record.blood = deriveBlood({ score: 100, gaps: [] })
  assert.equal(isInstallable(record), true)
  record.blood = deriveBlood({ gaps: [{ id: 'g', capability: 'c', state: 'missing', kind: 'cut', effort: 'M' }] })
  assert.equal(isInstallable(record), false)
})

test('verificationGate stops at the first missing or failing level', () => {
  const check = (level, status) => ({ level, name: `${level}-check`, status, detail: '', at: 0 })
  assert.equal(verificationGate([check('L0', 'pass')]), 'L0')
  assert.equal(verificationGate([check('L0', 'pass'), check('L1', 'pass')]), 'L1')
  assert.equal(verificationGate([check('L0', 'pass'), check('L1', 'fail')]), 'L0')
  assert.equal(verificationGate([check('L0', 'pass'), check('L2', 'pass')]), 'L0')
  assert.equal(verificationGate([]), 'none')
})

test('brief teaches the pipeline and the hard rules', () => {
  const record = emptyRecord({ text: '导出会话为 PDF 的插件' })
  record.id = 'sc-20261105-120000-abcd'
  const brief = briefFor(record, 'work')
  assert.match(brief, /plugin_scout/)
  assert.match(brief, /sc-20261105-120000-abcd/)
  assert.match(brief, /残血不装/)
  assert.match(brief, /audit/)
})
