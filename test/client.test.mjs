/**
 * dsh-plugin-smith — Client half smoke tests.
 *
 * Loads `client.js` in a stub `window.__ModuleLoader__` capture, runs the lazy
 * factory with a tiny fake `react`, and calls `apply` with a fake plugin
 * context whose `slots`, `locale` and `effect` services are recording stubs.
 *
 * No dependencies: Node's built-in `node:test` and `node:assert` only.
 */
import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const here = dirname(fileURLToPath(import.meta.url))
const clientPath = join(here, '..', 'client.js')
const source = readFileSync(clientPath, 'utf8')

const CJK_PATTERN = /[\u3400-\u9fff]/

/** Loads `client.js` and returns the single module spec handed to the loader. */
function loadModuleSpec() {
  const captured = []
  const previousWindow = globalThis.window
  globalThis.window = {
    __ModuleLoader__: {
      load(spec) {
        captured.push(spec)
      },
    },
  }
  try {
    // Plain browser script: executing it only calls the module loader.
    new Function('window', source)(globalThis.window)
  } finally {
    if (previousWindow === undefined) delete globalThis.window
    else globalThis.window = previousWindow
  }
  assert.equal(captured.length, 1, 'the loader must be called exactly once')
  return captured[0]
}

/** Minimal React: enough for module definition and the pure icon component. */
function createReactStub() {
  const calls = { createElement: 0 }
  const react = {
    createElement(type, props, ...children) {
      calls.createElement += 1
      return { type, props: props || {}, children }
    },
    memo(component) {
      return component
    },
  }
  return { react, calls }
}

/** Recording fake of the Cordis-style plugin context used by `apply`. */
function createFakeContext() {
  const state = {
    injections: [],
    registrations: [],
    effects: [],
    locales: [],
  }

  const ctx = {
    effect(fn, label) {
      state.effects.push(label)
      const dispose = fn()
      return typeof dispose === 'function' ? dispose : () => {}
    },
    slots: {
      inject(name, callback) {
        state.injections.push(name)
        return callback()
      },
      register(definition, component) {
        state.registrations.push({ definition, component })
        return () => {}
      },
    },
    locale: {
      register(namespace, dictionaries) {
        state.locales.push({ namespace, dictionaries })
        return () => {}
      },
      bind(namespace) {
        return (key) => {
          const entry = state.locales.find((item) => item.namespace === namespace)
          if (!entry) return key
          const dictionaries = entry.dictionaries || {}
          const dictionary = dictionaries.zh || {}
          return Object.prototype.hasOwnProperty.call(dictionary, key) ? dictionary[key] : key
        }
      },
    },
  }

  return { ctx, state }
}

function applyPlugin() {
  const spec = loadModuleSpec()
  const { react, calls } = createReactStub()
  const requested = []
  const factory = spec.factory
  const plugin = factory((name) => {
    requested.push(name)
    assert.equal(name, 'react', 'the factory should only require react')
    return react
  })
  const { ctx, state } = createFakeContext()
  plugin.apply(ctx)
  return { spec, plugin, state, calls, requested }
}

function findRegistration(state, name) {
  return state.registrations.find((entry) => entry.definition && entry.definition.name === name)
}

function dictionaryCount(dictionary) {
  return Object.keys(dictionary).length
}

test('module spec is the frozen client identity', () => {
  const spec = loadModuleSpec()
  assert.equal(spec.id, 'dsh-plugin-smith')
  assert.equal(typeof spec.factory, 'function')
})

test('factory declares slots + locale and apply registers all three slots', () => {
  const { plugin, state, requested } = applyPlugin()
  assert.deepEqual(requested, ['react'])
  assert.deepEqual(plugin.inject, ['slots', 'locale'])
  assert.equal(typeof plugin.apply, 'function')
  assert.equal(state.effects.length, 1)
  assert.deepEqual(state.injections, ['sidebar.panellist', 'main', 'plugins.tab'])
  assert.equal(state.registrations.length, 3)

  const sidebar = findRegistration(state, 'sidebar.panellist')
  assert.ok(sidebar, 'sidebar.panellist must be registered')
  assert.equal(sidebar.definition.id, 'dsh-plugin-smith')
  assert.equal(sidebar.definition.order, 30)
  assert.equal(sidebar.definition.locale, 'dshPluginSmith')
  assert.equal(typeof sidebar.definition.label, 'function')
  assert.equal(sidebar.definition.label(), '插件锻造炉')
  assert.equal(typeof sidebar.component, 'function')

  const main = findRegistration(state, 'main')
  assert.ok(main, 'main must be registered')
  assert.equal(main.definition.key, 'dsh-plugin-smith')
  assert.equal(main.definition.locale, 'dshPluginSmith')
  assert.equal(typeof main.component, 'function')

  const pluginsTab = findRegistration(state, 'plugins.tab')
  assert.ok(pluginsTab, 'plugins.tab must be registered')
  assert.equal(pluginsTab.definition.id, 'dsh-plugin-smith-tab')
  assert.equal(pluginsTab.definition.order, 20)
  assert.equal(pluginsTab.definition.locale, 'dshPluginSmith')
  assert.equal(typeof pluginsTab.definition.label, 'function')
  assert.equal(pluginsTab.definition.label(), '锻造')
  assert.equal(typeof pluginsTab.component, 'function')

  // The tab content must tolerate a missing slotProps and a missing `t`.
  assert.doesNotThrow(() => pluginsTab.component(undefined))
  assert.doesNotThrow(() => pluginsTab.component({}))
  assert.doesNotThrow(() => pluginsTab.component({ t: () => 'Forge' }))
  const tabElement = pluginsTab.component({ t: () => 'Forge' })
  assert.ok(tabElement && typeof tabElement === 'object', 'the tab must render an element')
})

test('sidebar icon renders a crisp currentColor anvil with the amber accent', () => {
  const { state } = applyPlugin()
  const sidebar = findRegistration(state, 'sidebar.panellist')
  const element = sidebar.component({ size: 18 })
  assert.equal(element.type, 'svg')
  assert.equal(element.props.width, 18)
  assert.equal(element.props.height, 18)
  assert.equal(element.props.viewBox, '0 0 24 24')
  assert.equal(element.props['aria-hidden'], true)
  assert.ok(element.children.length >= 3, 'anvil + spark + strike marks')
  const serialized = JSON.stringify(element)
  assert.ok(serialized.includes('currentColor'), 'the body follows the current color')
  assert.ok(serialized.includes('#e08a2e'), 'the amber accent is present')
})

test('locale dictionaries register for zh and en with identical key sets', () => {
  const spec = loadModuleSpec()
  const { react } = createReactStub()
  const plugin = spec.factory(() => react)
  const { ctx, state } = createFakeContext()
  plugin.apply(ctx)
  assert.equal(state.locales.length, 1)

  const entry = state.locales[0]
  assert.equal(entry.namespace, 'dshPluginSmith')
  const zh = entry.dictionaries && entry.dictionaries.zh
  const en = entry.dictionaries && entry.dictionaries.en
  assert.ok(zh && typeof zh === 'object', 'zh dictionary must exist')
  assert.ok(en && typeof en === 'object', 'en dictionary must exist')

  const zhKeys = Object.keys(zh).sort()
  const enKeys = Object.keys(en).sort()
  assert.deepEqual(zhKeys, enKeys, 'zh and en must cover the same key set')
  assert.ok(zhKeys.length >= 200, `expected a complete dictionary, got ${zhKeys.length} keys`)

  for (const key of zhKeys) {
    assert.equal(typeof zh[key], 'string', `zh.${key} must be a string`)
    assert.ok(zh[key].length > 0, `zh.${key} must not be empty`)
    assert.equal(typeof en[key], 'string', `en.${key} must be a string`)
    assert.ok(en[key].length > 0, `en.${key} must not be empty`)
  }

  assert.equal(zh.panel, '插件锻造炉')
  assert.equal(en.panel, 'Plugin Smith')
  for (const key of ['title', 'intakeSubmit', 'statusAwaitingApproval', 'bloodCut', 'decisionCompleteThenInstall', 'sessionDraftHint', 'ledgerTitle']) {
    assert.ok(CJK_PATTERN.test(zh[key]), `zh.${key} should be Chinese: ${zh[key]}`)
  }
})

test('V1.1 keys exist in both dictionaries (audit scope + Plugins tab)', () => {
  const spec = loadModuleSpec()
  const { react } = createReactStub()
  const plugin = spec.factory(() => react)
  const { ctx, state } = createFakeContext()
  plugin.apply(ctx)
  const { zh, en } = state.locales[0].dictionaries

  assert.equal(zh.auditScope, '审计范围')
  assert.equal(zh.auditScopeSource, '源码级')
  assert.equal(zh.auditScopeMetadata, '元数据级')
  assert.equal(en.auditScope, 'Audit scope')
  assert.equal(en.auditScopeSource, 'Source level')
  assert.equal(en.auditScopeMetadata, 'Metadata only')
  assert.ok(CJK_PATTERN.test(zh.auditScopeHint))
  assert.equal(en.auditScopeHint, 'Published source could not be fetched; weaker evidence')

  assert.equal(zh.pluginsTab, '锻造')
  assert.equal(en.pluginsTab, 'Forge')

  for (const key of ['auditScope', 'auditScopeSource', 'auditScopeMetadata', 'auditScopeHint', 'pluginsTab']) {
    assert.ok(Object.prototype.hasOwnProperty.call(zh, key), `zh is missing ${key}`)
    assert.ok(Object.prototype.hasOwnProperty.call(en, key), `en is missing ${key}`)
  }

  // The 03 audit section must render the scope row and its metadata-only hint.
  assert.ok(source.includes("const SCOPE_KEYS"), 'source-level scope labels must be mapped')
  assert.ok(source.includes('audit.scope'), 'the audit scope must be read from the record')
  assert.ok(source.includes("t('auditScope')"), 'the scope row label must be translated')
  assert.ok(source.includes("t('auditScopeHint')"), 'the metadata-only hint must be translated')
  assert.ok(source.includes("auditScope === 'metadata'"), 'the hint must be gated on metadata scope')
})

test('V1.2 sandbox evidence keys exist in both dictionaries', () => {
  const spec = loadModuleSpec()
  const { react } = createReactStub()
  const plugin = spec.factory(() => react)
  const { ctx, state } = createFakeContext()
  plugin.apply(ctx)
  const { zh, en } = state.locales[0].dictionaries

  assert.equal(zh.auditSandbox, '隔离试装')
  assert.equal(zh.auditSandboxPassed, '通过')
  assert.equal(zh.auditSandboxMismatch, '摘要不一致')
  assert.equal(zh.auditSandboxCompleted, '已完成')
  assert.equal(zh.auditSandboxIncomplete, '未完成')
  assert.equal(zh.auditSandboxHint, '脚本已禁用 · {files} 个文件 · {ms} ms')

  assert.equal(en.auditSandbox, 'Trial install')
  assert.equal(en.auditSandboxPassed, 'Passed')
  assert.equal(en.auditSandboxMismatch, 'Digest mismatch')
  assert.equal(en.auditSandboxCompleted, 'Completed')
  assert.equal(en.auditSandboxIncomplete, 'Incomplete')
  assert.equal(en.auditSandboxHint, 'scripts disabled · {files} files · {ms} ms')

  for (const key of [
    'auditSandbox',
    'auditSandboxPassed',
    'auditSandboxMismatch',
    'auditSandboxCompleted',
    'auditSandboxIncomplete',
    'auditSandboxHint',
  ]) {
    assert.ok(Object.prototype.hasOwnProperty.call(zh, key), `zh is missing ${key}`)
    assert.ok(Object.prototype.hasOwnProperty.call(en, key), `en is missing ${key}`)
  }

  // The 03 audit section renders the sandbox row only when evidence exists.
  assert.ok(source.includes('audit.sandbox'), 'sandbox evidence must be read from the audit')
  assert.ok(source.includes("t('auditSandbox')"), 'the sandbox row label must be translated')
  assert.ok(source.includes('sandboxStateKey'), 'the sandbox state mapping must exist')
  assert.ok(source.includes('sandboxHintText'), 'the sandbox caption must exist')
  assert.ok(source.includes("t('auditSandboxHint'"), 'the sandbox caption template must be translated')
  assert.ok(source.includes("sandbox.ok !== true"), 'the incomplete branch must key off ok')
  assert.ok(source.includes("sandbox.digestMatch === false"), 'the mismatch branch must key off digestMatch')
})

test('requirement revisions and gap re-check are wired end to end', () => {
  const spec = loadModuleSpec()
  const { react } = createReactStub()
  const plugin = spec.factory(() => react)
  const { ctx, state } = createFakeContext()
  plugin.apply(ctx)
  const { zh, en } = state.locales[0].dictionaries

  assert.equal(zh.revisionBadge, 'rev {rev}')
  assert.equal(zh.revisionCount, '已增补 {count} 次')
  assert.equal(zh.revisionListTitle, '需求修订')
  assert.equal(zh.revisionExpand, '展开全文')
  assert.equal(zh.revisionCollapse, '收起')
  assert.equal(zh.sourceUser, '你')
  assert.equal(zh.sourceAgent, '模型')
  assert.equal(zh.amendTitle, '补充需求')
  assert.equal(zh.amendSubmit, '增补')
  assert.equal(zh.amendSubmitting, '增补中…')
  assert.ok(zh.amendFailed.includes('{message}'))
  assert.ok(CJK_PATTERN.test(zh.amendPlaceholder))
  assert.ok(CJK_PATTERN.test(zh.amendSuccess))
  assert.ok(CJK_PATTERN.test(zh.amendEmpty))
  assert.equal(zh.gapRoundLabel, '第 {round} 轮缺口分析')
  assert.equal(zh.gapRecheck, '复查')
  assert.equal(zh.gapRoundShort, '第 {round} 轮')
  assert.equal(zh.regapButton, '复查缺口')
  assert.equal(zh.bloodStaleHint, '需求已变更，本缺口分析已过期')
  assert.equal(zh.decisionStaleHint, '需求已变更，旧决策失效：需重新做缺口分析与决策')

  assert.equal(en.revisionBadge, 'rev {rev}')
  assert.equal(en.revisionCount, 'Amended {count}×')
  assert.equal(en.revisionListTitle, 'Requirement revisions')
  assert.equal(en.revisionExpand, 'Show full text')
  assert.equal(en.revisionCollapse, 'Collapse')
  assert.equal(en.sourceUser, 'You')
  assert.equal(en.sourceAgent, 'Model')
  assert.equal(en.amendTitle, 'Add requirement')
  assert.equal(en.amendSubmit, 'Amend')
  assert.equal(en.amendSubmitting, 'Amending…')
  assert.equal(en.amendFailed, 'Amend failed: {message}')
  assert.equal(en.gapRoundLabel, 'Gap analysis · round {round}')
  assert.equal(en.gapRecheck, 're-check')
  assert.equal(en.gapRoundShort, 'round {round}')
  assert.equal(en.regapButton, 'Re-check gaps')
  assert.equal(en.bloodStaleHint, 'The requirement changed; this gap analysis is stale')
  assert.equal(
    en.decisionStaleHint,
    'The requirement changed; the old decision is invalid — redo gap analysis and decision',
  )

  for (const key of [
    'revisionBadge',
    'revisionCount',
    'revisionListTitle',
    'revisionExpand',
    'revisionCollapse',
    'sourceUser',
    'sourceAgent',
    'amendTitle',
    'amendPlaceholder',
    'amendSubmit',
    'amendSubmitting',
    'amendSuccess',
    'amendFailed',
    'amendEmpty',
    'gapRoundLabel',
    'gapRecheck',
    'gapRoundShort',
    'regapButton',
    'bloodStaleHint',
    'decisionStaleHint',
  ]) {
    assert.ok(Object.prototype.hasOwnProperty.call(zh, key), `zh is missing ${key}`)
    assert.ok(Object.prototype.hasOwnProperty.call(en, key), `en is missing ${key}`)
  }

  // amend POSTs, gap claim-session flow, and summary/record field reads.
  assert.ok(source.includes("action: 'amend'"), 'the amend action must be POSTed')
  assert.ok(source.includes('amendIntent'), 'the amend wiring must exist')
  assert.ok(source.includes("runSession('gap')"), 'the gap flow must claim a gap session')
  assert.ok(source.includes("add('gap')"), 'gap must be exposed as a secondary action')
  assert.ok(source.includes("gap: 'regapButton'"), 'the gap action must resolve to 复查缺口')
  assert.ok(source.includes('intent.revisions'), 'the revision list must read intent.revisions')
  assert.ok(source.includes('summary.revisionCount'), 'record cards must read summary.revisionCount')
  assert.ok(source.includes('summary.intentRev'), 'record cards must show the revision number')
  assert.ok(source.includes('summary.gapRound'), 'record cards must read summary.gapRound')
  assert.ok(source.includes('blood.round'), 'the blood section must read blood.round')
  assert.ok(source.includes('blood.stale'), 'the blood section must read blood.stale')
  assert.ok(source.includes('summary.bloodStale'), 'the action bar must read summary.bloodStale')
  assert.ok(source.includes('summary.decisionStale'), 'the decision section must read summary.decisionStale')
})

test('every statically referenced translation key exists in both dictionaries', () => {
  const spec = loadModuleSpec()
  const { react } = createReactStub()
  const plugin = spec.factory(() => react)
  const { ctx, state } = createFakeContext()
  plugin.apply(ctx)
  const { zh, en } = state.locales[0].dictionaries

  const keys = new Set()
  for (const match of source.matchAll(/\bt\('([a-zA-Z0-9_]+)'/g)) keys.add(match[1])
  assert.ok(keys.size >= 80, `expected many static keys, found ${keys.size}`)
  for (const key of keys) {
    assert.ok(Object.prototype.hasOwnProperty.call(zh, key), `zh is missing ${key}`)
    assert.ok(Object.prototype.hasOwnProperty.call(en, key), `en is missing ${key}`)
  }
})

test('page text is confined to the dictionaries', () => {
  const start = source.indexOf('const DICTIONARIES = {')
  const end = source.indexOf('const STYLES =')
  assert.ok(start >= 0 && end > start, 'dictionary block boundaries must be discoverable')
  const outside = `${source.slice(0, start)}\n${source.slice(end)}`
  const matches = outside.split('\n').filter((line) => CJK_PATTERN.test(line))
  assert.deepEqual(matches, [], `Chinese text outside the dictionaries: ${matches.join(' | ')}`)
})

test('request plumbing and frozen API surface are wired', () => {
  for (const required of [
    '/plugin-smith/api/state',
    '/plugin-smith/api/record',
    '/plugin-smith/api/action',
    "HEADER_NAME = 'x-plugin-smith'",
    'REFRESH_MS = 3000',
    "inject('sidebar.panellist'",
    "inject('main'",
    "inject('plugins.tab'",
    'order: 30',
    'visibilitychange',
    "documentHidden()",
    'prefers-reduced-motion',
    'set-depth',
    'claim-session',
    "action: 'amend'",
    "runSession('gap')",
    "add('gap')",
    'rollback',
    'archive',
    'reopen',
    'reject',
    'whenDraftExists',
    "whenDraftExists: 'append'",
    'sessions.create',
    'startSession',
    'openSession',
    'queue',
  ]) {
    assert.ok(source.includes(required), `client.js should contain ${required}`)
  }
})
