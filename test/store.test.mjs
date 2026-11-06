import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, readFile, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { KeeperStore } from '../lib/store.js'
import { emptyRecord } from '../lib/records.js'

async function tempStore() {
  const dir = await mkdtemp(join(tmpdir(), 'keeper-store-'))
  const store = new KeeperStore({ dir })
  await store.init()
  return { dir, store }
}

test('records survive a reload', async () => {
  const { dir, store } = await tempStore()
  const record = emptyRecord({ text: '持久化测试' })
  record.id = 'sc-persist'
  await store.saveRecord(record)

  const reopened = new KeeperStore({ dir })
  await reopened.init()
  const loaded = reopened.getRecord('sc-persist')
  assert.ok(loaded)
  assert.equal(loaded.intent.text, '持久化测试')
  const document = JSON.parse(await readFile(join(dir, 'records.json'), 'utf8'))
  assert.equal(document.version, 1)
  assert.equal(document.records.length, 1)
})

test('history is append-only and newest first', async () => {
  const { store } = await tempStore()
  await store.addHistory({ recordId: 'a', title: 'A', spec: 'a', application: 'applied' })
  await store.addHistory({ recordId: 'b', title: 'B', spec: 'b', application: 'failed' })
  const rows = store.listHistory()
  assert.equal(rows.length, 2)
  assert.equal(rows[0].recordId, 'b')
})

test('a corrupt ledger does not throw and starts empty', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'keeper-store-'))
  await writeFile(join(dir, 'records.json'), '{ not json', 'utf8')
  const store = new KeeperStore({ dir })
  await store.init()
  assert.deepEqual(store.listRecords(), [])
})

test('an unknown record id returns null', async () => {
  const { store } = await tempStore()
  assert.equal(store.getRecord('nope'), null)
})
