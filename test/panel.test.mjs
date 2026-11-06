import test from 'node:test'
import assert from 'node:assert/strict'
import { Readable } from 'node:stream'
import { mkdtemp } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

/**
 * End-to-end Host test without the real Harness: mount `apply()` on a fake
 * Cordis context, capture the registered tool and the panel route, then drive
 * the panel over fake HTTP requests. This is the same code the installed
 * profile will execute.
 */
async function mount() {
  const dataDir = await mkdtemp(join(tmpdir(), 'smith-panel-'))
  const tools = []
  const routes = []
  const ctx = {
    logger: { info() {}, warn() {} },
    tools: { register(definition) { tools.push(definition); return () => {} } },
    systemPrompt: { section() { return () => {} } },
    effect(callback) { const dispose = callback(); return () => {} },
    inject(_deps, callback) { callback(ctx) },
    get() { return undefined },
    agents: { currentInitiator() { return undefined } },
    workingDirectory: { get() { return dataDir } },
    webServer: {
      port: 1234,
      protocol: 'http:',
      register(route) { routes.push(route); return () => {} },
    },
  }
  const { apply } = await import('../index.js')
  apply(ctx, { dataDir })
  const tool = tools.find((entry) => entry.name === 'plugin_scout')
  assert.ok(tool, 'plugin_scout must be registered')
  const route = routes.find((entry) => entry.path === '/plugin-smith')
  assert.ok(route, 'panel route must be registered')
  return { tool, route, ctx, dataDir }
}

function fakeRequest({ method = 'GET', url = '/plugin-smith/api/state', headers = {}, body = null } = {}) {
  const chunks = body === null ? [] : [Buffer.from(JSON.stringify(body), 'utf8')]
  const req = Readable.from(chunks)
  req.method = method
  req.url = url
  req.headers = { host: '127.0.0.1:1234', 'x-plugin-smith': '1', ...headers }
  return req
}

function fakeResponse() {
  let ended
  const done = new Promise((resolve) => {
    ended = resolve
  })
  const res = {
    status: 0,
    headers: null,
    payload: null,
    headersSent: false,
    writableEnded: false,
    writeHead(status, headers) {
      res.status = status
      res.headers = headers
      res.headersSent = true
    },
    end(body) {
      res.writableEnded = true
      if (typeof body === 'string' && body.length > 0) res.payload = JSON.parse(body)
      ended()
    },
  }
  return { res, done }
}

async function call(route, request) {
  const { res, done } = fakeResponse()
  route.handler(request, res)
  await done
  return res
}

async function waitFor(predicate, timeoutMs = 3000) {
  const started = Date.now()
  for (;;) {
    const value = await predicate()
    if (value) return value
    if (Date.now() - started > timeoutMs) throw new Error('timeout waiting for condition')
    await new Promise((resolve) => setTimeout(resolve, 25))
  }
}

test('panel rejects a request without the plugin header', async () => {
  const { route } = await mount()
  const response = await call(route, fakeRequest({ headers: { 'x-plugin-smith': '0' } }))
  assert.equal(response.status, 403)
  assert.equal(response.payload.ok, false)
})

test('tool and panel share one record', async () => {
  const { tool, route } = await mount()

  const created = await tool.execute({ action: 'intake', text: '需要一个能把会话导出为 PDF 的插件', depth: 'quick' })
  assert.equal(created.ok, true)
  const id = created.record.id

  const state = await call(route, fakeRequest())
  assert.equal(state.status, 200)
  assert.equal(state.payload.ok, true)
  assert.equal(state.payload.stats.total, 1)
  assert.equal(state.payload.records[0].id, id)

  const detail = await call(route, fakeRequest({ url: `/plugin-smith/api/record?id=${encodeURIComponent(id)}` }))
  assert.equal(detail.payload.ok, true)
  assert.equal(detail.payload.record.id, id)
  assert.match(detail.payload.brief, /plugin_scout/)

  const claimed = await call(
    route,
    fakeRequest({
      method: 'POST',
      url: '/plugin-smith/api/action',
      body: { action: 'claim-session', id, kind: 'work', sessionId: 'sess-panel-1' },
    }),
  )
  assert.equal(claimed.payload.ok, true)
  assert.equal(claimed.payload.record.execution.sessionId, 'sess-panel-1')
  assert.equal(claimed.payload.record.status, 'executing')
})

test('panel intake validates the requirement text', async () => {
  const { route } = await mount()
  const response = await call(
    route,
    fakeRequest({ method: 'POST', url: '/plugin-smith/api/action', body: { action: 'intake', text: '短' } }),
  )
  assert.equal(response.payload.ok, false)
  assert.match(response.payload.error, /4 个字/)
})

test('panel install is refused while there is no decision', async () => {
  const { tool, route } = await mount()
  const created = await tool.execute({ action: 'intake', text: '安装门禁测试记录' })
  const id = created.record.id
  const response = await call(
    route,
    fakeRequest({ method: 'POST', url: '/plugin-smith/api/action', body: { action: 'install', id } }),
  )
  assert.equal(response.payload.ok, false)
})

test('unknown actions and routes answer JSON, never a crash', async () => {
  const { route } = await mount()
  const unknownAction = await call(
    route,
    fakeRequest({ method: 'POST', url: '/plugin-smith/api/action', body: { action: 'rm -rf /' } }),
  )
  assert.equal(unknownAction.status, 404)
  assert.equal(unknownAction.payload.ok, false)

  const unknownRoute = await call(route, fakeRequest({ url: '/plugin-smith/api/nope' }))
  assert.equal(unknownRoute.status, 404)
})

test('a malformed JSON body is a clean error, not a 500 stack', async () => {
  const { route } = await mount()
  const req = Readable.from([Buffer.from('{oops', 'utf8')])
  req.method = 'POST'
  req.url = '/plugin-smith/api/action'
  req.headers = { host: '127.0.0.1:1234', 'x-plugin-smith': '1' }
  const { res, done } = fakeResponse()
  route.handler(req, res)
  await waitFor(() => res.writableEnded)
  assert.equal(res.status, 200)
  assert.equal(res.payload.ok, false)
  assert.match(res.payload.error, /JSON/)
})

test('panel amend appends a requirement revision; gap session returns the regap brief', async () => {
  const { tool, route } = await mount()
  const created = await tool.execute({ action: 'intake', text: '面板补充需求入口验收记录', depth: 'quick' })
  const id = created.record.id

  const amended = await call(
    route,
    fakeRequest({
      method: 'POST',
      url: '/plugin-smith/api/action',
      body: { action: 'amend', id, text: '追加：还要支持按时间范围筛选。', note: '面板增补' },
    }),
  )
  assert.equal(amended.payload.ok, true)
  assert.equal(amended.payload.record.intent.rev, 2)
  assert.equal(amended.payload.record.intent.revisions.length, 2)
  assert.equal(amended.payload.record.intent.revisions[1].source, 'user')
  assert.equal(amended.payload.record.intent.revisions[1].note, '面板增补')

  const short = await call(
    route,
    fakeRequest({ method: 'POST', url: '/plugin-smith/api/action', body: { action: 'amend', id, text: ' ' } }),
  )
  assert.equal(short.payload.ok, false)
  assert.match(short.payload.error, /2 个字/)

  const claimed = await call(
    route,
    fakeRequest({
      method: 'POST',
      url: '/plugin-smith/api/action',
      body: { action: 'claim-session', id, kind: 'gap', sessionId: 'sess-gap-panel' },
    }),
  )
  assert.equal(claimed.payload.ok, true)
  assert.equal(claimed.payload.record.execution.kind, 'gap')
  assert.match(claimed.payload.brief, /缺口复查/)
})
