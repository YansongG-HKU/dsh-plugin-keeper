/**
 * The only code path allowed to change the user's profile.
 *
 * Design rules:
 *  - A bundle is installed only from an approved record: the decision must say
 *    "install", the audit must not be unsafe, and a full-blood claim must hold.
 *  - The panel is the consent surface. The agent tool cannot install on its own:
 *    it receives a `requiresUserConfirmation` answer until the user has clicked
 *    install in the panel (that click writes `record.approval`).
 *  - Before pnpm runs, the spec is inspected and a local bundle is re-verified;
 *    after it runs, the profile's own inventory must confirm the bundle is
 *    installed and enabled. Those confirmations are written into the record.
 *  - Every attempt appends one install-history entry with a rollback handle.
 */

import { join } from 'node:path'
import { sha256 } from './util.js'
import { addHistory, normalizeInstall } from './records.js'
import { nowMs } from './util.js'
import { installGate } from './pipeline.js'
import { loadCheck, makeVerification, verificationPassed, verifyBundle } from './verify.js'

export function createInstaller({ ctx, store, log }) {
  function manager() {
    try {
      const direct = ctx?.pluginManager
      if (direct && typeof direct.installBundle === 'function') return direct
      const viaGet = typeof ctx?.get === 'function' ? ctx.get('pluginManager') : null
      return viaGet && typeof viaGet.installBundle === 'function' ? viaGet : null
    } catch {
      return null
    }
  }

  /** Profile inventory used for the L2 confirmation. */
  async function inventory() {
    const api = manager()
    if (!api) return { bundles: [], plugins: [] }
    const [bundles, plugins] = await Promise.all([
      typeof api.listBundles === 'function' ? api.listBundles().catch(() => []) : [],
      typeof api.listPlugins === 'function' ? api.listPlugins().catch(() => []) : [],
    ])
    return { bundles: Array.isArray(bundles) ? bundles : [], plugins: Array.isArray(plugins) ? plugins : [] }
  }

  /**
   * Install one record's candidate.
   *
   * @param {object} record
   * @param {{ via: 'panel'|'tool', actor?: string }} options
   * @returns {Promise<{ok: boolean, record: object, application?: string, warnings?: string[], error?: string, requiresUserConfirmation?: boolean}>}
   */
  async function install(record, options = {}) {
    const via = options.via ?? 'tool'
    const at = nowMs()
    const gate = installGate(record)
    if (!gate.ok) {
      return { ok: false, record, error: gate.error }
    }
    // Consent: only the panel click sets this. A model cannot click for the user.
    if (via !== 'panel' && !record.approval) {
      return {
        ok: false,
        record,
        requiresUserConfirmation: true,
        error: '安装这一步必须由用户确认：请在「插件管家」面板里点安装，然后再继续。',
      }
    }
    const api = manager()
    if (!api) {
      return { ok: false, record, error: '当前 profile 没有插件管理服务（pluginManager），无法安装。' }
    }
    if (via === 'panel') {
      record.approval = { via: 'panel', at }
      addHistory(record, 'approval', '用户在面板确认安装', at)
    }

    const spec = record.candidate.spec
    const warnings = []
    const checks = []

    // Pre-flight: what does the spec name?
    let inspection = null
    try {
      if (typeof api.inspect === 'function') {
        inspection = await api.inspect(spec)
      }
    } catch (error) {
      warnings.push(`spec 预检失败：${error instanceof Error ? error.message : String(error)}`)
    }
    if (inspection) {
      if (inspection.status === 'refused') {
        checks.push({
          level: 'L0',
          name: 'spec 预检',
          status: 'fail',
          detail: inspection.reason ?? inspection.problem ?? 'spec 被拒绝',
          at,
        })
        return finishBlocked(record, at, checks, `spec 预检被拒绝：${inspection.reason ?? inspection.problem}`, spec)
      }
      const name = inspection.name ?? record.candidate.name
      const version = inspection.version ?? record.candidate.version ?? null
      checks.push({
        level: 'L0',
        name: 'spec 预检',
        status: 'pass',
        detail: `${inspection.kind} · ${name}${version ? `@${version}` : ''}${inspection.bundle === false ? '（不是 bundle）' : ''}`,
        at,
      })
    } else {
      checks.push({ level: 'L0', name: 'spec 预检', status: 'skip', detail: 'profile 未提供 inspect（跳过预检）', at })
    }

    // A local bundle must pass the static gate before it is linked into the profile.
    const local = looksLikeLocalPath(spec)
    if (local) {
      const verified = await verifyBundle(spec, { runTests: false, log })
      checks.push(...verified.verification.checks)
      if (!verified.ok) {
        return finishBlocked(record, at, checks, '本地 bundle 未通过 L0 静态门禁', spec)
      }
    }

    // --- the real change ---------------------------------------------------
    let result
    try {
      result = await api.installBundle(spec, { enabled: true })
    } catch (error) {
      return finishBlocked(record, at, checks, `安装失败：${error instanceof Error ? error.message : String(error)}`, spec)
    }
    if (!result || result.changed === false || result.application === 'failed' || result.application === 'cancelled') {
      const detail = result?.error?.diagnostic ?? result?.error?.code ?? result?.application ?? '未知原因'
      return finishBlocked(record, at, checks, `安装未完成：${detail}`, spec)
    }

    for (const warning of Array.isArray(result.warnings) ? result.warnings : []) warnings.push(String(warning))
    checks.push({
      level: 'L2',
      name: 'pnpm 安装',
      status: 'pass',
      detail: `application=${result.application}${result.version ? ` · version=${result.version}` : ''}`,
      at,
    })

    // Post-install: the profile itself must confirm the bundle is live.
    let inventoryNow = { bundles: [], plugins: [] }
    try {
      inventoryNow = await inventory()
    } catch {
      inventoryNow = { bundles: [], plugins: [] }
    }
    const load = loadCheck({
      bundles: inventoryNow.bundles,
      plugins: inventoryNow.plugins,
      spec,
      bundleName: result.bundle ?? record.candidate.name,
    })
    checks.push(load)
    // L4: prove the bytes that landed in the profile are the bytes that were audited.
    const integrity = await integrityCheck({
      audit: record.audit,
      packageName: result.bundle ?? record.candidate.name,
      profileDir: profileDirOf(ctx),
    })
    checks.push(integrity)
    const merged = mergeWithRecord(record, checks)
    record.verification = merged

    const integrityFailed = integrity.status === 'fail'
    const installedOk = load.status === 'pass' && !integrityFailed
    if (!installedOk && result.application === 'restart-required') {
      warnings.push('该插件需要重启后生效；重启后再点一次「重新验收」确认 L2。')
    }
    if (integrityFailed) warnings.push(integrity.detail)

    record.install = normalizeInstall({
      spec,
      at,
      application: result.application,
      version: result.version ?? record.candidate.version ?? null,
      bundle: result.bundle ?? null,
      warnings,
      evidenceHash: sha256(`${spec}|${result.version ?? ''}|${result.bundle ?? ''}`),
      rollback: result.bundle ? { kind: 'remove-bundle', name: result.bundle } : null,
      ...(installedOk ? {} : { error: '安装已提交，但 profile 尚未确认加载' }),
    })

    record.status = installedOk ? 'installed' : 'verifying'
    record.statusReason = installedOk
      ? '安装完成并通过 L2 加载确认'
      : integrityFailed
        ? '安装后内容与审计对象不一致，L4 完整性校验失败'
        : '安装已提交，等待加载确认'
    addHistory(
      record,
      'install',
      `${spec} → ${result.application}${installedOk ? '（L2 通过）' : integrityFailed ? '（L4 失败）' : '（待确认）'}`,
      at,
    )

    await store.addHistory({
      recordId: record.id,
      title: record.intent?.title ?? '',
      at,
      spec,
      application: result.application,
      version: record.install.version,
      bundle: record.install.bundle,
      rollbackName: record.install.rollback?.name ?? null,
    })
    await store.saveRecord(record)
    return {
      ok: installedOk,
      record,
      application: result.application,
      warnings,
      error: installedOk
        ? undefined
        : integrityFailed
          ? '安装后内容与审计对象不一致（L4 失败），请回滚并重新审计'
          : '已提交安装，但 profile 未确认加载',
    }
  }

  /** Remove a previously installed bundle and record the outcome. */
  async function rollback(record, options = {}) {
    const at = nowMs()
    const api = manager()
    if (!api) return { ok: false, record, error: '当前 profile 没有插件管理服务' }
    const name = record?.install?.rollback?.name ?? record?.install?.bundle ?? record?.candidate?.name
    if (!name) return { ok: false, record, error: '没有可回滚的安装记录' }
    let result
    try {
      result = await api.removeBundle(name)
    } catch (error) {
      return { ok: false, record, error: `卸载失败：${error instanceof Error ? error.message : String(error)}` }
    }
    const removed = result && result.changed !== false && result.application !== 'failed'
    addHistory(record, 'rollback', `${name} → ${result?.application ?? 'unknown'}`, at)
    if (removed) {
      record.status = 'ready'
      record.statusReason = '已回滚，记录保留以便重新安装'
      record.install = record.install ? { ...record.install, application: 'cancelled' } : null
      const rollbackCheck = {
        level: 'L5',
        name: '回滚',
        status: 'pass',
        detail: `已移除 ${name}（${result?.application ?? 'ok'}）`,
        at,
      }
      record.verification = mergeWithRecord(record, [rollbackCheck])
    }
    await store.saveRecord(record)
    return { ok: removed, record, error: removed ? undefined : '卸载未完成' }
  }

  function finishBlocked(record, at, checks, error, spec) {
    record.status = 'blocked'
    record.statusReason = error
    record.verification = mergeWithRecord(record, checks)
    record.install = normalizeInstall({ spec, at, application: 'failed', warnings: [error], rollback: null, error })
    addHistory(record, 'install-blocked', error, at)
    void store.saveRecord(record)
    return { ok: false, record, error }
  }

  return { install, rollback, inventory, manager }
}

function mergeWithRecord(record, checks) {
  const previous = record.verification
  const existing = Array.isArray(previous?.checks) ? previous.checks : []
  const merged = [
    ...existing.filter((check) => !checks.some((next) => next.level === check.level && next.name === check.name)),
    ...checks,
  ]
  merged.sort((left, right) => String(left.level).localeCompare(String(right.level)))
  const verification = makeVerification(merged)
  // L2 pass is what turns a submitted install into an accepted one.
  return verification
}

function looksLikeLocalPath(spec) {
  if (typeof spec !== 'string') return false
  return spec.startsWith('.') || spec.startsWith('/') || /^[A-Za-z]:[\\/]/.test(spec) || spec.startsWith('file:')
}

/** Where this profile keeps installed packages; `undefined` outside a profile. */
export function profileDirOf(ctx) {
  const fromEnv = process.env.DSH_PROFILE_DIR
  if (typeof fromEnv === 'string' && fromEnv.length > 0) return fromEnv
  try {
    const info = ctx?.get?.('profileContext')
    if (typeof info?.dir === 'string' && info.dir.length > 0) return info.dir
    if (typeof ctx?.profileContext?.dir === 'string') return ctx.profileContext.dir
  } catch {
    /* not a profile-launched host */
  }
  return undefined
}

/**
 * L4 check: the installed package directory must digest to the same value as
 * the audited source. A missing digest or unknown profile directory yields a
 * `skip` (never a pass, never a failure): absence of evidence is not evidence.
 *
 * @param {{audit?: object|null, packageName?: string|null, profileDir?: string|undefined}} input
 * @returns {Promise<{level: 'L4', name: string, status: 'pass'|'fail'|'skip', detail: string, at: number}>}
 */
export async function integrityCheck({ audit, packageName, profileDir } = {}) {
  const at = nowMs()
  const base = { level: 'L4', name: '安装物完整性', at }
  const expected = typeof audit?.digest === 'string' ? audit.digest : null
  if (!expected) {
    return { ...base, status: 'skip', detail: '审计没有生成源码摘要（元数据级审计），无法比对安装物' }
  }
  if (audit?.digestTruncated) {
    return { ...base, status: 'skip', detail: '审计摘要因文件数/体积上限被截断，不做完整性结论' }
  }
  if (!profileDir) {
    return { ...base, status: 'skip', detail: '未检测到 profile 目录（DSH_PROFILE_DIR），跳过哈希比对' }
  }
  if (typeof packageName !== 'string' || packageName.length === 0) {
    return { ...base, status: 'skip', detail: '不知道安装后的包名，跳过哈希比对' }
  }
  const installedDir = join(profileDir, 'node_modules', packageName)
  try {
    const { digestDirectory } = await import('./digest.js')
    const actual = await digestDirectory(installedDir)
    if (actual.files === 0) {
      return { ...base, status: 'skip', detail: `安装目录 ${installedDir} 为空或不可读` }
    }
    if (actual.truncated) {
      return { ...base, status: 'skip', detail: '安装目录超过摘要上限，不做完整性结论' }
    }
    if (actual.hash === expected) {
      return { ...base, status: 'pass', detail: `已安装内容与审计对象一致（${actual.files} 个文件，sha256 ${expected.slice(0, 12)}…）` }
    }
    return {
      ...base,
      status: 'fail',
      detail: `安装后内容与审计对象不一致：审计 ${audit.digestFiles ?? '?'} 个文件 / 安装 ${actual.files} 个文件，请回滚`,
    }
  } catch (error) {
    return { ...base, status: 'skip', detail: `无法读取安装目录：${error instanceof Error ? error.message : String(error)}` }
  }
}

export { verificationPassed }
