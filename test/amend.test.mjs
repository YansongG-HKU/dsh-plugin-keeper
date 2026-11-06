import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

import { createKeeperService, createStore } from '../lib/service.js'
import { installGate } from '../lib/pipeline.js'
import { normalizeDecision, normalizeRecord, summarizeRecord } from '../lib/records.js'

const here = dirname(fileURLToPath(import.meta.url))
const bundleDir = join(here, 'fixtures', 'bundle-good')

async function makeService() {
  const dataDir = await mkdtemp(join(tmpdir(), 'keeper-amend-'))
  const ctx = { agents: { currentInitiator: () => undefined }, workingDirectory: { get: () => dataDir } }
  return { service: createKeeperService({ ctx, store: createStore({ dir: dataDir }) }), dataDir }
}

/** Build a record with a safe candidate, one gap, and a complete-then-install decision. */
async function decidedRecord(service) {
  const { record } = await service.intake('验收：补齐第一轮缺口', { depth: 'quick' })
  const id = record.id
  await service.upsertCandidates(id, [{ name: 'fixture-good', version: '1.0.0', spec: bundleDir, source: 'local' }])
  await service.audit(id, { path: bundleDir })
  await service.blood(id, {
    gaps: [
      {
        capability: '批量导出',
        state: 'missing',
        kind: 'incomplete',
        evidence: '首轮验收缺口',
        remedy: '加一个批量入口',
        effort: 'S',
        risk: 'low',
      },
    ],
  })
  await service.decide(id, { kind: 'complete-then-install', rationale: '首轮：候选安全但缺一个能力，先补齐再装。' })
  return id
}

test('a legacy record without revisions normalizes to revision 1', () => {
  const record = normalizeRecord({ id: 'sc-legacy', intent: { text: '老记录' } })
  assert.equal(record.intent.rev, 1)
  assert.equal(record.intent.revisions.length, 1)
  assert.equal(record.intent.revisions[0].text, '老记录')
  const decision = normalizeDecision({ kind: 'install', rationale: 'x' })
  assert.equal(decision.intentRev, 1)
})

test('amend appends a revision, invalidates the decision and marks gaps stale', async () => {
  const { service } = await makeService()
  const id = await decidedRecord(service)

  const amended = await service.amend(id, '还要能导出 Excel，并且支持选择字段。', { note: '用户追加', actor: 'user' })
  const record = amended.record
  assert.equal(amended.revision, 2)
  assert.equal(amended.needsRegap, true)
  assert.equal(record.intent.rev, 2)
  assert.equal(record.intent.revisions.length, 2)
  assert.match(record.intent.text, /\[rev 2\] 还要能导出 Excel/)
  assert.equal(record.intent.revisions[1].source, 'user')
  assert.equal(record.intent.revisions[1].note, '用户追加')

  assert.equal(record.decision, null)
  assert.equal(record.blood.stale, true)
  assert.equal(record.blood.round, 1)
  assert.equal(record.status, 'decision')
  assert.match(record.statusReason, /rev 2/)
  assert.ok(record.history.some((entry) => entry.kind === 'amend'))
  assert.ok(record.history.some((entry) => entry.kind === 'decision-invalidated'))

  const summary = summarizeRecord(record)
  assert.equal(summary.intentRev, 2)
  assert.equal(summary.revisionCount, 2)
  assert.equal(summary.bloodStale, true)
  assert.equal(summary.decisionStale, false)
  assert.equal(summary.installable, false)
})

test('a stale gap analysis blocks the decision until a new round is recorded', async () => {
  const { service } = await makeService()
  const id = await decidedRecord(service)
  await service.amend(id, '追加：导出要支持时间范围。')

  await assert.rejects(
    () => service.decide(id, { kind: 'install', rationale: '需求已增补，但仍按旧结论安装，这是错的。' }),
    /复查|过期/,
  )

  const regapped = await service.blood(id, { gaps: [], nextRound: true, summary: '第二轮：复查后无缺口。' })
  const record = regapped.record
  assert.equal(record.blood.round, 2)
  assert.equal(record.blood.stale, false)
  assert.equal(record.blood.label, 'full')
  assert.equal(record.bloodRounds.length, 1)
  assert.equal(record.bloodRounds[0].round, 2)

  const decided = await service.decide(id, { kind: 'install', rationale: '第二轮复查无缺口，满血且安全，可装。' })
  assert.equal(decided.record.decision.intentRev, 2)
  assert.equal(installGate(decided.record).ok, true)
  assert.equal(summarizeRecord(decided.record).installable, true)
})

test('a second amendment invalidates the previous decision again', async () => {
  const { service } = await makeService()
  const id = await decidedRecord(service)
  await service.amend(id, '第一处追加：支持 Excel。')
  await service.blood(id, { gaps: [], nextRound: true })
  await service.decide(id, { kind: 'install', rationale: '第二轮无缺口，可以安装。' })

  const again = await service.amend(id, '第二处追加：还要支持字段选择。')
  assert.equal(again.revision, 3)
  assert.equal(again.record.decision, null)
  assert.equal(again.record.blood.round, 2)
  assert.equal(again.record.blood.stale, true)
  assert.equal(summarizeRecord(again.record).installable, false)
  // Only a fresh round can clear staleness.
  const third = await service.blood(id, { gaps: [], nextRound: true })
  assert.equal(third.record.blood.round, 3)
  assert.equal(third.record.blood.stale, false)
  assert.deepEqual(
    third.record.bloodRounds.map((round) => round.round),
    [2, 3],
  )
})

test('claiming a gap-check session returns a gap-specific brief', async () => {
  const { service } = await makeService()
  const id = await decidedRecord(service)
  await service.amend(id, '追加：导出需要包含代码块高亮。')

  const claimed = await service.claimSession(id, 'gap', 'sess-gap-1')
  assert.equal(claimed.record.execution.kind, 'gap')
  assert.equal(claimed.record.execution.sessionId, 'sess-gap-1')
  assert.match(claimed.brief, /缺口复查/)
  assert.match(claimed.brief, /next_round:true/)
  assert.match(claimed.brief, /需求增补历史/)
  assert.match(claimed.brief, /rev 2/)
})

test('a decision plan without upstream has no undefined own property (lossless JSON)', () => {
  const decision = normalizeDecision({
    kind: 'complete-then-install',
    rationale: 'x'.repeat(20),
    plan: { steps: ['a'], effort: 'M', risks: [], acceptCriteria: ['ok'] },
  })
  assert.equal(Object.prototype.hasOwnProperty.call(decision.plan, 'upstream'), false)
  assert.doesNotThrow(() => JSON.parse(JSON.stringify(decision)))
  const withUpstream = normalizeDecision({
    kind: 'install',
    rationale: 'x'.repeat(20),
    plan: { steps: ['a'], effort: 'M', risks: [], upstream: { fork: true }, acceptCriteria: [] },
  })
  assert.equal(withUpstream.plan.upstream.fork, true)
  assert.equal(withUpstream.plan.upstream.repo, null)
})

test('amend rejects an empty addition and keeps the record unchanged', async () => {
  const { service } = await makeService()
  const id = await decidedRecord(service)
  await assert.rejects(() => service.amend(id, ' '), /2 个字/)
  const detail = await service.detail(id)
  assert.equal(detail.record.intent.rev, 1)
  assert.ok(detail.record.decision)
})

