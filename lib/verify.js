/**
 * The acceptance gate.
 *
 * "Install" is not acceptance. A record may only reach `installed` after the
 * bundle passes an ordered set of checks, and every check is written into the
 * record so the panel can show exactly why a claim was accepted:
 *
 *   L0  static: manifest parses, declared files exist, patch parses, JS syntax OK
 *   L1  tests:  the bundle's own test suite (opt-in; runs in the bundle dir)
 *   L2  load:   the profile actually reports the bundle installed and enabled
 *   L3  behavior / L4 integrity / L5 rollback: written by the agent or the host
 *               with concrete evidence, never assumed
 *
 * A failed check blocks the install gate; a skipped check never counts as a pass.
 */

import { execFile } from 'node:child_process'
import { readdir, readFile, stat, unlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, relative } from 'node:path'
import { promisify } from 'node:util'
import { normalizeVerification, verificationGate } from './records.js'
import { errorMessage, nowMs, sha256, truncate } from './util.js'

const execFileAsync = promisify(execFile)

const LEVELS = ['L0', 'L1', 'L2', 'L3', 'L4', 'L5']
const SYNTAX_FILE_LIMIT = 40
const SCAN_FILE_LIMIT = 400

/** Build a Verification object from checks, deriving `gate` and `passed`. */
export function makeVerification(checks, at = nowMs()) {
  const normalized = checks.map((check) => ({ at, ...check }))
  const gate = verificationGate(normalized)
  const failed = normalized.some((check) => check.status === 'fail')
  return normalizeVerification({
    passed: !failed && gate !== 'none',
    gate,
    at,
    checks: normalized,
  })
}

/** Whether a verification object may open the install gate. */
export function verificationPassed(verification) {
  if (!verification) return false
  if (verification.passed !== true) return false
  if (!LEVELS.includes(verification.gate)) return false
  return verification.checks.every((check) => check.status !== 'fail')
}

/**
 * Run the automated gate for a local bundle directory.
 *
 * @param {string} dir absolute bundle directory
 * @param {{ runTests?: boolean, timeoutMs?: number, log?: object }} [options]
 * @returns {Promise<{ok: boolean, verification: object, error?: string}>}
 */
export async function verifyBundle(dir, options = {}) {
  const log = options.log
  const checks = []
  const push = (level, name, status, detail) => checks.push({ level, name, status, detail: truncate(detail, 1200) })

  if (typeof dir !== 'string' || dir.trim().length === 0) {
    push('L0', 'bundle 目录', 'fail', '没有提供 bundle 目录')
    return { ok: false, verification: makeVerification(checks), error: '没有提供 bundle 目录' }
  }

  let info
  try {
    info = await stat(dir)
  } catch (error) {
    push('L0', 'bundle 目录', 'fail', `目录不可读：${errorMessage(error)}`)
    return { ok: false, verification: makeVerification(checks), error: '目录不可读' }
  }
  if (!info.isDirectory()) {
    push('L0', 'bundle 目录', 'fail', `${dir} 不是目录`)
    return { ok: false, verification: makeVerification(checks), error: '不是目录' }
  }
  push('L0', 'bundle 目录', 'pass', dir)

  // --- L0: manifest ------------------------------------------------------
  const manifestPath = join(dir, 'package.json')
  let manifest = null
  try {
    manifest = JSON.parse(await readFile(manifestPath, 'utf8'))
    push('L0', 'manifest 可解析', 'pass', 'package.json 解析成功')
  } catch (error) {
    push('L0', 'manifest 可解析', 'fail', `package.json 不可用：${errorMessage(error)}`)
  }

  if (manifest && typeof manifest === 'object') {
    const nameOk = typeof manifest.name === 'string' && manifest.name.length > 0
    const versionOk = typeof manifest.version === 'string' && manifest.version.length > 0
    push('L0', 'manifest 必填字段', nameOk && versionOk ? 'pass' : 'fail', `name=${manifest.name ?? '—'} version=${manifest.version ?? '—'}`)

    const bundlePatch = manifest?.dsh?.bundle?.patch
    if (typeof bundlePatch === 'string' && bundlePatch.length > 0) {
      const patchPath = join(dir, bundlePatch)
      try {
        const text = await readFile(patchPath, 'utf8')
        const meaningful = /(^|\n)\s*(-\s*)?(insert|override|disable|group|isolate)\s*:/m.test(text)
        push('L0', 'bundle patch', meaningful ? 'pass' : 'fail', `${bundlePatch}：${meaningful ? '包含 Loader 指令' : '没有 insert/override 等指令'}`)
      } catch (error) {
        push('L0', 'bundle patch', 'fail', `${bundlePatch} 不可读：${errorMessage(error)}`)
      }
    } else {
      push('L0', 'bundle patch', 'skip', '未声明 dsh.bundle.patch（纯 Client 或配置型 bundle 可跳过）')
    }

    const client = manifest?.dsh?.client
    if (client) {
      const clientExport = manifest?.exports?.['./client']
      const clientFile = typeof clientExport === 'string' ? clientExport : null
      if (!clientFile) {
        push('L0', 'client 入口', 'fail', '声明了 dsh.client 但没有导出 ./client')
      } else {
        try {
          const text = await readFile(join(dir, clientFile), 'utf8')
          const looksLikeModule = text.includes('__ModuleLoader__') && /\bload\s*\(/.test(text)
          push('L0', 'client 入口', looksLikeModule ? 'pass' : 'fail', `${clientFile}：${looksLikeModule ? '包含 ModuleLoader 注册' : '缺少 ModuleLoader 注册'}`)
        } catch (error) {
          push('L0', 'client 入口', 'fail', `${clientFile} 不可读：${errorMessage(error)}`)
        }
      }
    } else {
      push('L0', 'client 入口', 'skip', 'Host-only bundle')
    }

    if (Array.isArray(manifest.files)) {
      const missing = []
      for (const declared of manifest.files.slice(0, 40)) {
        if (typeof declared !== 'string' || declared.includes('*')) continue
        try {
          await stat(join(dir, declared))
        } catch {
          missing.push(declared)
        }
      }
      push('L0', 'files 清单', missing.length === 0 ? 'pass' : 'fail', missing.length === 0 ? '声明的文件都存在' : `缺失：${missing.join(', ')}`)
    }
  }

  // --- L0: JavaScript syntax --------------------------------------------
  const sources = await collectSourceFiles(dir)
  const esm = manifest?.type === 'module'
  if (sources.length === 0) {
    push('L0', 'JS 语法', 'skip', '没有发现 JS 源文件')
  } else {
    const failures = []
    for (const file of sources.slice(0, SYNTAX_FILE_LIMIT)) {
      const result = await nodeCheck(file, { esm, timeoutMs: options.timeoutMs ?? 15000 })
      if (!result.ok) failures.push(`${relative(dir, file)}: ${truncate(result.detail, 160)}`)
    }
    push('L0', 'JS 语法', failures.length === 0 ? 'pass' : 'fail', failures.length === 0 ? `检查 ${Math.min(sources.length, SYNTAX_FILE_LIMIT)} 个文件` : failures.join(' | '))
  }

  // --- L1: the bundle's own tests ---------------------------------------
  if (options.runTests === true && manifest) {
    const hasTestScript = typeof manifest?.scripts?.test === 'string'
    let hasTestDir = false
    try {
      const entries = await readdir(dir, { withFileTypes: true })
      hasTestDir = entries.some((entry) => entry.isDirectory() && (entry.name === 'test' || entry.name === 'tests'))
    } catch {
      hasTestDir = false
    }
    if (!hasTestScript && !hasTestDir) {
      push('L1', '自带测试', 'skip', '没有 test 脚本或 test/ 目录')
    } else {
      const result = await runNodeTests(dir, options.timeoutMs ?? 120000)
      push('L1', '自带测试', result.ok ? 'pass' : 'fail', result.detail)
    }
  } else {
    push('L1', '自带测试', 'skip', '本次未开启（runTests=false）')
  }

  const verification = makeVerification(checks)
  const failed = checks.some((check) => check.status === 'fail')
  if (failed) log?.warn?.(`verify gate failed for ${dir}`)
  return {
    ok: !failed,
    verification,
    error: failed ? 'L0/L1 存在失败项，安装门禁不通过' : undefined,
  }
}

/**
 * Merge already-recorded checks (for example an agent's L3 UI observation or
 * the host's L2 load confirmation) into a verification object.
 */
export function mergeChecks(verification, extraChecks) {
  const existing = Array.isArray(verification?.checks) ? verification.checks : []
  const merged = [...existing.filter((check) => !extraChecks.some((extra) => extra.level === check.level && extra.name === check.name)), ...extraChecks]
  merged.sort((left, right) => LEVELS.indexOf(left.level) - LEVELS.indexOf(right.level))
  return makeVerification(merged)
}

/** L2 check built from the profile's own bundle/plugin inventory. */
export function loadCheck({ bundles, plugins, spec, bundleName }) {
  const at = nowMs()
  const list = Array.isArray(bundles) ? bundles : []
  const match = list.find((entry) => {
    if (bundleName && entry?.name === bundleName) return true
    if (!spec) return false
    return [entry?.name, entry?.installTarget?.spec].filter(Boolean).some((value) => String(value).includes(spec))
  })
  if (!match) {
    return { level: 'L2', name: 'profile 加载确认', status: 'fail', detail: `listBundles 里找不到 ${bundleName ?? spec}`, at }
  }
  if (!match.installed) {
    return { level: 'L2', name: 'profile 加载确认', status: 'fail', detail: `${match.name} 已声明但未安装`, at }
  }
  if (!match.enabled) {
    return { level: 'L2', name: 'profile 加载确认', status: 'fail', detail: `${match.name} 已安装但未启用`, at }
  }
  const rows = Array.isArray(match.rows) ? match.rows : []
  const pluginRows = Array.isArray(plugins) ? plugins : []
  const activeRows = rows
    .map((row) => pluginRows.find((plugin) => plugin?.entryId === row?.entryId))
    .filter(Boolean)
  const failedRows = activeRows.filter((plugin) => plugin.fiberPhase === 'failed')
  if (failedRows.length > 0) {
    return { level: 'L2', name: 'profile 加载确认', status: 'fail', detail: `插件行激活失败：${failedRows.map((row) => row.moduleName).join(', ')}`, at }
  }
  return {
    level: 'L2',
    name: 'profile 加载确认',
    status: 'pass',
    detail: `${match.name}${match.version ? `@${match.version}` : ''} 已安装并启用${activeRows.length > 0 ? `，${activeRows.length} 个插件行在位` : ''}`,
    at,
  }
}

/** Highest level any check reached, for display only. */
export function highestLevel(checks) {
  let highest = 'none'
  for (const level of LEVELS) {
    if (checks.some((check) => check.level === level && check.status === 'pass')) highest = level
  }
  return highest
}

// ---------------------------------------------------------------------------
// internals

async function collectSourceFiles(dir) {
  const files = []
  const walk = async (current, depth) => {
    if (files.length >= SCAN_FILE_LIMIT || depth > 3) return
    let entries
    try {
      entries = await readdir(current, { withFileTypes: true })
    } catch {
      return
    }
    for (const entry of entries.sort((left, right) => left.name.localeCompare(right.name))) {
      if (files.length >= SCAN_FILE_LIMIT) return
      if (entry.name === 'node_modules' || entry.name === '.git' || entry.name.startsWith('.')) continue
      const full = join(current, entry.name)
      if (entry.isDirectory()) {
        await walk(full, depth + 1)
        continue
      }
      if (!entry.isFile()) continue
      if (/\.(m?js|cjs)$/i.test(entry.name)) files.push(full)
    }
  }
  await walk(dir, 0)
  return files
}

async function nodeCheck(file, { esm = false, timeoutMs = 15000 } = {}) {
  let target = file
  let temporary = null
  try {
    if (esm && !/\.mjs$/i.test(file)) {
      // `node --check` decides the parse goal from the nearest package.json and
      // Node 24 removed the default-type flag; a temporary `.mjs` copy is the
      // only reliable way to check ESM `.js` files in an arbitrary directory.
      const content = await readFile(file, 'utf8')
      temporary = join(tmpdir(), `smith-check-${process.pid}-${sha256(file, 12)}.mjs`)
      await writeFile(temporary, content, 'utf8')
      target = temporary
    }
    await execFileAsync(process.execPath, ['--check', target], {
      timeout: timeoutMs,
      windowsHide: true,
      maxBuffer: 1024 * 1024,
    })
    return { ok: true, detail: 'ok' }
  } catch (error) {
    const stderr = typeof error?.stderr === 'string' ? error.stderr : ''
    const message = stderr.trim() || errorMessage(error)
    return { ok: false, detail: message.split('\n').slice(0, 3).join(' ') }
  } finally {
    if (temporary) {
      try {
        await unlink(temporary)
      } catch {
        /* a leftover temp file must not fail verification */
      }
    }
  }
}

async function runNodeTests(dir, timeoutMs) {
  try {
    const { stdout, stderr } = await execFileAsync(process.execPath, ['--test'], {
      cwd: dir,
      timeout: timeoutMs,
      windowsHide: true,
      maxBuffer: 4 * 1024 * 1024,
    })
    const summary = summarizeTestOutput(stdout)
    return { ok: true, detail: `node --test 通过${summary ? `：${summary}` : ''}` }
  } catch (error) {
    const stdout = typeof error?.stdout === 'string' ? error.stdout : ''
    const stderr = typeof error?.stderr === 'string' ? error.stderr : ''
    const summary = summarizeTestOutput(stdout) || truncate(stderr.trim() || errorMessage(error), 600)
    return { ok: false, detail: `node --test 失败：${summary}` }
  }
}

function summarizeTestOutput(text) {
  const lines = String(text ?? '')
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => /^#\s*(pass|fail|tests)\b/.test(line) || /^ℹ\s*(pass|fail|tests)\b/.test(line))
  return lines.slice(0, 4).join('；')
}
