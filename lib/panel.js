/**
 * The panel's HTTP surface.
 *
 * One loopback, same-origin, JSON-only route owned by this plugin. The Client
 * half is the only intended caller: it must send the `x-plugin-smith` header,
 * and the Host header must name this process's own port. Mutations are POSTs
 * with a JSON body; nothing is executed from a query string.
 *
 * The route is defensive: no handler may throw into the web server, a bad body
 * is a 400, and every response is `{ok:false,error}` instead of a stack trace.
 */

import { errorMessage } from './util.js'

const ROUTE_PREFIX = '/plugin-smith'
const STATE_PATH = `${ROUTE_PREFIX}/api/state`
const RECORD_PATH = `${ROUTE_PREFIX}/api/record`
const ACTION_PATH = `${ROUTE_PREFIX}/api/action`
const REQUEST_HEADER = 'x-plugin-smith'
const MAX_BODY_BYTES = 1024 * 1024
/** Actions the panel may call. Anything else is a 404. */
const PANEL_ACTIONS = new Set([
  'intake',
  'install',
  'rollback',
  'archive',
  'reopen',
  'reject',
  'note',
  'amend',
  'set-depth',
  'claim-session',
])

export function registerPanel(ctx, { service, log }) {
  return ctx.inject(['webServer'], (webCtx) => {
    const webServer = webCtx.webServer
    webCtx.effect(
      () =>
        webServer.register({
          kind: 'prefix',
          path: ROUTE_PREFIX,
          handler: (req, res) => {
            void handleRequest(webCtx, service, req, res, log)
          },
        }),
      'dsh-plugin-smith: panel route',
    )
  })
}

/** Same-origin gate: loopback Host header, plugin header, matching Origin when present. */
function sameOrigin(webServer, req) {
  const headers = req.headers ?? {}
  const host = headers.host
  const port = webServer.port
  if (typeof host !== 'string' || port === undefined) return false
  const expected = [`127.0.0.1:${port}`, `localhost:${port}`, `[::1]:${port}`]
  if (!expected.includes(host)) return false
  if (headers[REQUEST_HEADER] !== '1') return false
  const origin = headers.origin
  if (origin === undefined) return true
  const protocol = typeof webServer.protocol === 'string' ? webServer.protocol : 'http:'
  return origin === `${protocol}//${host}`
}

async function handleRequest(webCtx, service, req, res, log) {
  try {
    if (!sameOrigin(webCtx.webServer, req)) {
      sendJson(res, 403, { ok: false, error: 'Same-origin plugin-smith request required' })
      return
    }
    const url = new URL(req.url ?? '/', 'http://localhost')
    const method = req.method ?? 'GET'

    if (url.pathname === STATE_PATH && (method === 'GET' || method === 'HEAD')) {
      sendJson(res, 200, await service.state(), method === 'HEAD' ? { body: false } : undefined)
      return
    }
    if (url.pathname === RECORD_PATH && (method === 'GET' || method === 'HEAD')) {
      const id = url.searchParams.get('id') ?? ''
      const payload = await service.detail(id)
      sendJson(res, 200, payload, method === 'HEAD' ? { body: false } : undefined)
      return
    }
    if (url.pathname === ACTION_PATH && method === 'POST') {
      const body = await readJsonBody(req)
      const action = typeof body?.action === 'string' ? body.action : ''
      if (!PANEL_ACTIONS.has(action)) {
        sendJson(res, 404, { ok: false, error: `未知操作：${action || '（空）'}` })
        return
      }
      const result = await runAction(service, action, body)
      sendJson(res, 200, result)
      return
    }
    if (url.pathname === ACTION_PATH) {
      sendJson(res, 405, { ok: false, error: `Method ${method} is not allowed` })
      return
    }
    sendJson(res, 404, { ok: false, error: 'Unknown plugin-smith route' })
  } catch (error) {
    const message = errorMessage(error)
    try {
      log?.warn?.(`panel request failed: ${message}`)
    } catch {
      /* ignore */
    }
    try {
      sendJson(res, 200, { ok: false, error: message })
    } catch {
      /* the response may already be gone */
    }
  }
}

async function runAction(service, action, body) {
  const id = typeof body.id === 'string' ? body.id : ''
  switch (action) {
    case 'intake':
      return service.intake(body.text, { depth: body.depth, actor: 'user' })
    case 'install':
      return service.install(id, { via: 'panel', actor: 'user' })
    case 'rollback':
      return service.rollback(id, { actor: 'user' })
    case 'archive':
      return service.archive(id, { actor: 'user' })
    case 'reopen':
      return service.reopen(id, { actor: 'user' })
    case 'reject':
      return service.reject(id, body.reason, { actor: 'user' })
    case 'note':
      return service.note(id, body.text, { actor: 'user' })
    case 'amend':
      return service.amend(id, body.text, { note: body.note, actor: 'user' })
    case 'set-depth':
      return service.setDepth(id, body.depth)
    case 'claim-session':
      return service.claimSession(id, body.kind, body.sessionId, { actor: 'user' })
    default:
      return { ok: false, error: `未知操作：${action}` }
  }
}

function readJsonBody(req) {
  return new Promise((resolve, reject) => {
    let size = 0
    const chunks = []
    req.on('data', (chunk) => {
      size += chunk.length
      if (size > MAX_BODY_BYTES) {
        reject(new Error('请求体过大'))
        req.destroy()
        return
      }
      chunks.push(chunk)
    })
    req.on('end', () => {
      if (chunks.length === 0) {
        resolve({})
        return
      }
      try {
        resolve(JSON.parse(Buffer.concat(chunks).toString('utf8')))
      } catch (error) {
        reject(new Error(`请求体不是合法 JSON：${errorMessage(error)}`))
      }
    })
    req.on('error', (error) => reject(error))
  })
}

function sendJson(res, status, value, options) {
  if (res.headersSent || res.writableEnded) return
  const body = JSON.stringify(value === undefined ? {} : value)
  res.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'cache-control': 'no-store',
    'x-content-type-options': 'nosniff',
  })
  if (options && options.body === false) {
    res.end()
    return
  }
  res.end(body)
}
