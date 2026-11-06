import test from 'node:test'
import assert from 'node:assert/strict'

import { CUT_CAP, deriveBlood, gapCost, labelOf } from '../lib/blood.js'

const gap = (overrides = {}) => ({
  id: 'g1',
  capability: '批量导出',
  state: 'missing',
  kind: 'cut',
  evidence: 'README 写明 Pro 版才有',
  remedy: '移除付费门控，在本地实现批量导出',
  effort: 'M',
  risk: 'low',
  ...overrides,
})

test('no gaps means full blood at 100', () => {
  const blood = deriveBlood({ gaps: [] })
  assert.equal(blood.score, 100)
  assert.equal(blood.label, 'full')
})

test('a cut gap caps the score below the thin band and forces the cut label', () => {
  const blood = deriveBlood({ gaps: [gap()] })
  assert.equal(blood.label, 'cut')
  assert.ok(blood.score <= CUT_CAP, `expected <= ${CUT_CAP}, got ${blood.score}`)
})

test('a partial small gap can still be thin but not full', () => {
  const blood = deriveBlood({ gaps: [gap({ kind: 'ux', state: 'partial', effort: 'S' })] })
  assert.equal(blood.label, 'thin')
  assert.ok(blood.score < 100 && blood.score >= 60)
})

test('an explicit full label cannot overrule gap evidence', () => {
  const blood = deriveBlood({ gaps: [gap({ kind: 'incomplete' })], label: 'full' })
  assert.notEqual(blood.label, 'full')
})

test('an explicit worse label is honored and score stays consistent', () => {
  const blood = deriveBlood({ gaps: [], label: 'cut', score: 100 })
  assert.equal(blood.label, 'cut')
  assert.ok(blood.score <= CUT_CAP)
})

test('gapCost grows with severity and shrinks for partial presence', () => {
  assert.ok(gapCost(gap({ kind: 'cut' })) > gapCost(gap({ kind: 'ux' })))
  assert.ok(gapCost(gap({ state: 'missing' })) > gapCost(gap({ state: 'partial' })))
})

test('labelOf banding', () => {
  assert.equal(labelOf(95), 'full')
  assert.equal(labelOf(90), 'full')
  assert.equal(labelOf(89), 'thin')
  assert.equal(labelOf(60), 'thin')
  assert.equal(labelOf(59), 'cut')
  assert.equal(labelOf(null), 'unknown')
})
