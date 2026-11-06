import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { createSmithService, createStore } from '../lib/service.js'

async function makeService() {
  const dir = await mkdtemp(join(tmpdir(), 'smith-service-'))
  const store = createStore({ dir })
  const ctx = {
    agents: { currentInitiator: () => undefined },
    workingDirectory: { get: () => dir },
  }
  const service = createSmithService({ ctx, store })
  return { service, dir }
}

test('intake → update → reject is a complete round trip', async () => {
  const { service } = await makeService()
  const created = await service.intake('需要一个能导出会话为 PDF 的插件', { depth: 'quick' })
  assert.equal(created.ok, true)
  const id = created.record.id
  assert.match(id, /^sc-\d{8}-\d{6}-[0-9a-f]{4}$/)

  const listed = await service.state()
  assert.equal(listed.stats.total, 1)
  assert.equal(listed.records[0].id, id)

  const updated = await service.update(id, { intent: { capabilities: ['导出 PDF', '选择范围'], constraints: ['本地运行'] } })
  assert.deepEqual(updated.record.intent.capabilities, ['导出 PDF', '选择范围'])

  const rejected = await service.reject(id, '已有更合适的方案')
  assert.equal(rejected.record.status, 'rejected')
})

test('candidates require a decision that respects the evidence', async () => {
  const { service } = await makeService()
  const { record } = await service.intake('批量导出插件')
  const result = await service.upsertCandidates(record.id, [
    { name: '@scope/exporter', spec: '@scope/exporter', source: 'npm', fitScore: 80, license: 'MIT' },
    { name: 'other-exporter', spec: 'other-exporter', source: 'npm', fitScore: 60, license: 'Apache-2.0' },
  ])
  assert.equal(result.record.candidates.length, 2)
  assert.equal(result.record.candidate.name, '@scope/exporter')
  assert.equal(result.record.status, 'scouting')

  // No audit yet: install must be refused with the audit reason.
  await assert.rejects(
    () => service.decide(record.id, { kind: 'install', rationale: '看起来可以，功能齐全' }),
    /审计/,
  )
})

test('claimSession writes the execution session and returns a brief', async () => {
  const { service } = await makeService()
  const { record } = await service.intake('需要一个导出插件')
  const claimed = await service.claimSession(record.id, 'work', 'sess-123')
  assert.equal(claimed.record.execution.sessionId, 'sess-123')
  assert.equal(claimed.record.status, 'executing')
  assert.match(claimed.brief, /plugin_scout/)
  assert.deepEqual(claimed.record.links.sessionIds, ['sess-123'])
})

test('notes, archive and reopen keep the ledger coherent', async () => {
  const { service } = await makeService()
  const { record } = await service.intake('测试备注')
  const noted = await service.note(record.id, '已和用户确认范围')
  assert.equal(noted.record.notes.length, 1)
  const archived = await service.archive(record.id)
  assert.equal(archived.record.status, 'archived')
  const reopened = await service.reopen(record.id)
  assert.notEqual(reopened.record.status, 'archived')
})

test('install without a decision is refused before touching the profile', async () => {
  const { service } = await makeService()
  const { record } = await service.intake('测试安装门禁')
  const result = await service.install(record.id, { via: 'panel' })
  assert.equal(result.ok, false)
  assert.match(result.error, /决策|spec/)
})
