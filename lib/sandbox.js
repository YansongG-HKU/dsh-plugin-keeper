/**
 * Isolated trial install ("sandbox" evidence).
 *
 * A static audit proves what the published bytes contain. It does not prove the
 * package can be resolved and materialized without surprises, and it cannot see
 * `npm install`-time behavior. This module closes that gap without touching the
 * user's profile:
 *
 *   1. create a throwaway directory with a minimal manifest;
 *   2. run the profile's own pnpm against the candidate with `--ignore-scripts`
 *      (no lifecycle script from the package or its dependencies can run);
 *   3. digest the materialized package and compare it with the digest of the
 *      audited tarball (this is the "same artifact" proof, before any install);
 *   4. delete the directory.
 *
 * It never boots a Harness, never imports the candidate's code, and never writes
 * outside the temporary directory.
 */

import { execFile } from 'node:child_process'
import { existsSync } from 'node:fs'
import { mkdir, mkdtemp, readdir, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { basename, dirname, join } from 'node:path'
import { promisify } from 'node:util'
import { digestDirectory } from './digest.js'
import { errorMessage, nowMs } from './util.js'

const execFileAsync = promisify(execFile)
const DEFAULT_TIMEOUT_MS = 180_000

/**
 * Resolve the profile's pnpm invocation (synchronous, no filesystem probing).
 *
 * Precedence: `DSH_SMITH_PNPM`, the pnpm path this process was launched with
 * (packaged desktop apps pass it as an argument), the Host's
 * `profileContext.packageManager`, then `pnpm` on PATH.
 *
 * @returns {{command: string, prefixArgs: string[], env: Record<string,string>, source: string}}
 */
export function resolvePnpm(ctx) {
  const explicit = process.env.DSH_SMITH_PNPM
  if (typeof explicit === 'string' && explicit.trim().length > 0) {
    return { command: explicit.trim(), prefixArgs: [], env: {}, source: 'env:DSH_SMITH_PNPM' }
  }

  const electron = Boolean(process.versions?.electron)
  const viaArgv = findPnpmInArgv()
  if (viaArgv) {
    return {
      command: process.execPath,
      prefixArgs: [viaArgv],
      env: electron ? { ELECTRON_RUN_AS_NODE: '1' } : {},
      source: 'argv',
    }
  }

  const pm = packageManagerOf(ctx)
  if (pm) {
    const first = pm.args[0]
    const looksLikeScript = typeof first === 'string' && /\.(c|m)?js$/i.test(first)
    const base = basename(pm.command).toLowerCase()
    const isNode = base === 'node' || base === 'node.exe' || base.includes('electron') || base.includes('deepseek harness')
    const env = { ...(pm.env ?? {}) }
    if (looksLikeScript && electron && !env.ELECTRON_RUN_AS_NODE) env.ELECTRON_RUN_AS_NODE = '1'
    return {
      command: pm.command,
      prefixArgs: [...pm.args],
      env,
      source: isNode ? 'profileContext' : 'profileContext:binary',
    }
  }

  return {
    command: process.platform === 'win32' ? 'pnpm.cmd' : 'pnpm',
    prefixArgs: [],
    env: {},
    source: 'path',
  }
}

/**
 * Resolve the invocation, then make it spawnable.
 *
 * A `pnpm.cmd`/`pnpm.bat` shim cannot be spawned without a shell (Node raises
 * EINVAL), so a shim found on PATH is read and rewritten to `node <script>`.
 * The probe is bounded and never throws.
 *
 * @returns {Promise<{command: string, prefixArgs: string[], env: Record<string,string>, source: string}>}
 */
export async function resolvePnpmAsync(ctx) {
  const base = resolvePnpm(ctx)
  let discovered = base
  if (base.source === 'path' && process.platform === 'win32') {
    const found = await probePnpmOnPath()
    if (found) discovered = { command: found, prefixArgs: [], env: {}, source: 'where' }
  }
  return normalizeInvocation(await materializeShim(discovered))
}

/** A JS entry point is not an executable: run it through the current Node. */
function normalizeInvocation(invocation) {
  if (/\.(c|m)?js$/i.test(invocation.command)) {
    return {
      command: process.execPath,
      prefixArgs: [invocation.command, ...invocation.prefixArgs],
      env: { ...(invocation.env ?? {}) },
      source: invocation.source.endsWith(':script') ? invocation.source : `${invocation.source}:script`,
    }
  }
  return invocation
}

async function probePnpmOnPath() {
  try {
    const { stdout } = await execFileAsync('where', ['pnpm'], { timeout: 5000, windowsHide: true, maxBuffer: 256 * 1024 })
    const first = String(stdout ?? '')
      .split(/\r?\n/)
      .map((line) => line.trim())
      .find(Boolean)
    return first || null
  } catch {
    return null
  }
}

async function materializeShim(invocation) {
  if (!/\.(cmd|bat)$/i.test(invocation.command)) return invocation
  try {
    const text = await readFile(invocation.command, 'utf8')
    const match = /"([^"]+\.(?:c|m)?js)"/i.exec(text) ?? /%~dp0\\([^\s"]+\.(?:c|m)?js)/i.exec(text)
    if (!match) return invocation
    const raw = match[1]
    const script = /^[A-Za-z]:/.test(raw) ? raw : join(dirname(invocation.command), raw.replace(/^[.][\\/]?/, ''))
    if (!existsSync(script)) return invocation
    return {
      command: process.execPath,
      prefixArgs: [script, ...invocation.prefixArgs],
      env: { ...(invocation.env ?? {}) },
      source: `${invocation.source}:shim`,
    }
  } catch {
    return invocation
  }
}

function findPnpmInArgv() {
  for (const arg of process.argv) {
    if (typeof arg !== 'string' || arg.length === 0) continue
    if (!/pnpm/i.test(arg)) continue
    if (/\.(c|m)?js$/i.test(arg) && arg.length > 12) return arg
  }
  return null
}

function packageManagerOf(ctx) {
  try {
    const direct = ctx?.profileContext?.packageManager
    if (direct && typeof direct.command === 'string') return direct
    const service = typeof ctx?.get === 'function' ? ctx.get('profileContext') : null
    const pm = service?.packageManager
    if (pm && typeof pm.command === 'string') return pm
  } catch {
    /* profileContext is optional */
  }
  return null
}

/** Read one package.json inside a directory, or null. */
async function readManifest(dir) {
  try {
    return JSON.parse(await readFile(join(dir, 'package.json'), 'utf8'))
  } catch {
    return null
  }
}

/**
 * Materialize `spec` in a throwaway directory with lifecycle scripts disabled.
 *
 * @param {string} spec package spec accepted by pnpm (registry name, path, git, tarball URL)
 * @param {{ctx?: object, timeoutMs?: number, root?: string}} [options]
 * @returns {Promise<{ok: boolean, root?: string, dir?: string, packageName?: string, version?: string,
 *   pnpm?: object, scriptsDisabled?: boolean, ms?: number, error?: string,
 *   cleanup?: () => Promise<void>}>}
 */
export async function trialInstall(spec, options = {}) {
  const started = nowMs()
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS
  if (typeof spec !== 'string' || spec.trim().length === 0) {
    return { ok: false, error: '缺少可试装的 spec' }
  }
  const pnpm = await resolvePnpmAsync(options.ctx)
  let root
  try {
    root = await mkdtemp(join(options.root ?? tmpdir(), 'smith-sandbox-'))
    await writeFile(join(root, 'package.json'), `${JSON.stringify({ name: 'smith-sandbox', private: true, version: '0.0.0' })}\n`, 'utf8')
    const args = [...pnpm.prefixArgs, '--dir', root, 'add', spec, '--ignore-scripts', '--reporter=silent']
    await execFileAsync(pnpm.command, args, {
      cwd: root,
      timeout: timeoutMs,
      windowsHide: true,
      maxBuffer: 2 * 1024 * 1024,
      env: {
        ...process.env,
        ...pnpm.env,
        CI: '1',
        npm_config_ignore_scripts: 'true',
        NPM_CONFIG_IGNORE_SCRIPTS: 'true',
      },
    })
    const found = await findInstalledPackage(root)
    if (!found) {
      await rm(root, { recursive: true, force: true }).catch(() => {})
      return { ok: false, error: 'pnpm 完成但没有找到被安装的包目录', pnpm, ms: nowMs() - started }
    }
    return {
      ok: true,
      root,
      dir: found.dir,
      packageName: found.name,
      version: found.version,
      pnpm,
      scriptsDisabled: true,
      ms: nowMs() - started,
      cleanup: async () => {
        await rm(root, { recursive: true, force: true }).catch(() => {})
      },
    }
  } catch (error) {
    if (root) await rm(root, { recursive: true, force: true }).catch(() => {})
    return { ok: false, error: errorMessage(error), pnpm, ms: nowMs() - started }
  }
}

/** Find the one real package directory inside `<root>/node_modules`. */
async function findInstalledPackage(root) {
  const nodeModules = join(root, 'node_modules')
  let entries
  try {
    entries = await readdir(nodeModules, { withFileTypes: true })
  } catch {
    return null
  }
  for (const entry of entries.sort((left, right) => left.name.localeCompare(right.name))) {
    if (!entry.isDirectory() && !entry.isSymbolicLink()) continue
    if (entry.name.startsWith('.')) continue
    if (entry.name.startsWith('@')) {
      let scoped
      try {
        scoped = await readdir(join(nodeModules, entry.name), { withFileTypes: true })
      } catch {
        continue
      }
      for (const child of scoped) {
        if (!child.isDirectory() && !child.isSymbolicLink()) continue
        const dir = join(nodeModules, entry.name, child.name)
        const manifest = await readManifest(dir)
        if (manifest?.name) return { name: manifest.name, version: manifest.version ?? null, dir }
      }
      continue
    }
    const dir = join(nodeModules, entry.name)
    const manifest = await readManifest(dir)
    if (manifest?.name) return { name: manifest.name, version: manifest.version ?? null, dir }
  }
  return null
}

/**
 * Trial-install a candidate and prove the materialized package is the audited
 * artifact. The temporary directory is always removed before returning.
 *
 * @param {{spec: string, expectedDigest?: string|null, ctx?: object, timeoutMs?: number}} input
 */
export async function sandboxEvidence({ spec, expectedDigest, ctx, timeoutMs } = {}) {
  const trial = await trialInstall(spec, { ctx, timeoutMs })
  if (!trial.ok) {
    return {
      ok: false,
      evidenceLevel: 'sandbox',
      scriptsDisabled: true,
      digestMatch: null,
      ms: trial.ms ?? null,
      pnpm: trial.pnpm ?? null,
      error: trial.error,
    }
  }
  try {
    const actual = await digestDirectory(trial.dir)
    const expected = typeof expectedDigest === 'string' && expectedDigest.length > 0 ? expectedDigest : null
    const digestMatch = expected ? actual.hash === expected : null
    return {
      ok: true,
      evidenceLevel: 'sandbox',
      scriptsDisabled: true,
      digestMatch,
      packageName: trial.packageName,
      version: trial.version,
      files: actual.files,
      bytes: actual.bytes,
      ms: trial.ms,
      pnpm: trial.pnpm,
      error: digestMatch === false ? '试装产物与审计对象摘要不一致' : undefined,
    }
  } finally {
    await trial.cleanup?.()
  }
}

/** Create a directory scaffold for tests that need a sandbox root. */
export async function makeSandboxRoot(base = tmpdir()) {
  const root = await mkdtemp(join(base, 'smith-sandbox-root-'))
  await mkdir(root, { recursive: true })
  return root
}
