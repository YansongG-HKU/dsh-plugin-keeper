/**
 * Registry evidence for candidates that are not on disk.
 *
 * A plugin that is not installed yet cannot be read, so the honest audit object
 * for it is metadata-level: publish age, install scripts, dependency surface,
 * maintainers, repository, deprecation, usage. This module collects that (plus a
 * best-effort GitHub snapshot) and turns it into findings with the same severity
 * vocabulary as the static engine, so the panel compares candidates on one scale.
 *
 * Every network call is bounded and best-effort: a registry outage must degrade
 * the audit, never fail the demand.
 */

import { execFile } from 'node:child_process'
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { promisify } from 'node:util'
import { nowMs, truncate } from './util.js'

const execFileAsync = promisify(execFile)

const DEFAULT_REGISTRY = 'https://registry.npmjs.org'
const DOWNLOADS_API = 'https://api.npmjs.org/downloads/point/last-month'
const GITHUB_API = 'https://api.github.com'
const TIMEOUT_MS = 9000
const STALE_DAYS = 730

const SEVERITY_WEIGHT = { critical: 45, high: 20, medium: 8, low: 3, info: 0 }

/** Fetch registry metadata plus optional usage/GitHub context. */
export async function collectRegistryEvidence(name, options = {}) {
  const registry = options.registry ?? DEFAULT_REGISTRY
  const timeoutMs = options.timeoutMs ?? TIMEOUT_MS
  const encoded = encodeURIComponent(String(name ?? ''))
  const metaUrl = `${registry.replace(/\/$/, '')}/${encoded}`
  const meta = await getJson(metaUrl, timeoutMs)
  if (!meta.ok || !meta.value) {
    return {
      ok: false,
      error: meta.error ?? `npm 上没有找到 ${name}`,
      findings: [
        {
          id: 'npm-missing',
          severity: 'high',
          kind: 'provenance',
          title: 'npm 元数据不可得',
          detail: `无法从 ${registry} 读取 ${name}：${meta.error ?? '未知错误'}`,
        },
      ],
    }
  }

  const document = meta.value
  const latest = document?.['dist-tags']?.latest
  const manifest = latest && document?.versions ? document.versions[latest] : null
  const publishTime = document?.time?.[latest] ? Date.parse(document.time[latest]) : null
  const modifiedTime = document?.time?.modified ? Date.parse(document.time.modified) : null
  const createdTime = document?.time?.created ? Date.parse(document.time.created) : null
  const dependencyCount = manifest ? Object.keys(manifest.dependencies ?? {}).length : 0
  const communityEnabled = options.community !== false

  const downloads = communityEnabled ? await getDownloads(name, timeoutMs) : { ok: false }
  const repositoryUrl = normalizeRepoUrl(manifest?.repository ?? document?.repository)
  const github = communityEnabled && repositoryUrl ? await getGithub(repositoryUrl, timeoutMs) : { ok: false }

  const pkg = {
    name: document?.name ?? name,
    version: latest ?? null,
    description: truncate(manifest?.description ?? document?.description ?? '', 600),
    license: normalizeLicense(manifest?.license ?? document?.license),
    repository: repositoryUrl,
    homepage: manifest?.homepage ?? document?.homepage ?? null,
    scripts: manifest?.scripts ?? {},
    dependencies: dependencyCount,
    deprecated: Boolean(manifest?.deprecated),
    engines: manifest?.engines ?? {},
    maintainers: Array.isArray(document?.maintainers) ? document.maintainers.map((entry) => entry?.name).filter(Boolean) : [],
    publishTime,
    modifiedTime,
    createdTime,
    versions: document?.versions ? Object.keys(document.versions).length : 0,
    weeklyDownloads: downloads.ok ? downloads.value : null,
    tarballUrl: typeof manifest?.dist?.tarball === 'string' ? manifest.dist.tarball : null,
    integrity: typeof manifest?.dist?.integrity === 'string' ? manifest.dist.integrity : null,
  }

  const findings = findingsForPackage(pkg)
  const community = {
    downloadsLastMonth: downloads.ok ? downloads.value : null,
    githubStars: github.ok ? github.value.stars : null,
    githubOpenIssues: github.ok ? github.value.openIssues : null,
    githubPushedAt: github.ok ? github.value.pushedAt : null,
    githubArchived: github.ok ? github.value.archived : null,
  }
  return { ok: true, package: pkg, findings, community }
}

/** Turn collected evidence into the Audit shape the panel renders. */
export function toAudit(evidence) {
  const findings = Array.isArray(evidence?.findings) ? evidence.findings : []
  const { score, verdict } = scoreFindings(findings)
  const scripts = evidence?.package?.scripts ?? {}
  const installScripts = ['preinstall', 'install', 'postinstall', 'prepare'].some(
    (key) => typeof scripts[key] === 'string' && scripts[key].trim().length > 0,
  )
  return {
    score,
    verdict,
    evidenceLevel: 'static',
    target: `npm:${evidence?.package?.name ?? '?'}${evidence?.package?.version ? `@${evidence.package.version}` : ''}`,
    findings,
    permissions: {
      installScripts,
      network: [],
      childProcess: false,
      eval: false,
      filesystemWrite: false,
      credentials: false,
      obfuscated: false,
      nativeAddons: false,
      patchesShippedRows: false,
      sparseSource: !evidence?.package?.repository,
    },
    stats: {
      files: 0,
      bytes: 0,
      dependencies: evidence?.package?.dependencies ?? 0,
      scannedAt: nowMs(),
    },
    ...(evidence?.community ? { community: evidence.community } : {}),
  }
}

/** Findings derived from registry metadata alone. */
export function findingsForPackage(pkg) {
  const findings = []
  const push = (severity, kind, id, title, detail) => findings.push({ id, severity, kind, title, detail })

  const scripts = pkg?.scripts ?? {}
  const riskyScript = ['preinstall', 'install', 'postinstall', 'prepare'].find(
    (key) => typeof scripts[key] === 'string' && scripts[key].trim().length > 0,
  )
  if (riskyScript) {
    push(
      'high',
      'installScript',
      'npm-install-script',
      '包含安装期脚本',
      `${riskyScript}: ${truncate(scripts[riskyScript], 200)}`,
    )
  }
  if (pkg?.deprecated) {
    push('high', 'maintenance', 'npm-deprecated', '包已被标记弃用', truncate(pkg.deprecated, 300))
  }
  const ageDays = pkg?.publishTime ? Math.round((nowMs() - pkg.publishTime) / 86400000) : null
  if (ageDays !== null && ageDays > STALE_DAYS) {
    push('medium', 'maintenance', 'npm-stale', '最近版本已过时', `最新版本发布于 ${ageDays} 天前`)
  }
  if (!pkg?.repository) {
    push('medium', 'provenance', 'npm-no-repository', '没有公开仓库', '无法核对源码与发布物是否一致')
  }
  if (!pkg?.license) {
    push('low', 'provenance', 'npm-no-license', '没有 license', '来源与再分发条件不明')
  }
  if (pkg?.dependencies > 25) {
    push('low', 'supply-chain', 'npm-heavy-deps', '依赖面偏大', `${pkg.dependencies} 个直接依赖`)
  }
  if (Array.isArray(pkg?.maintainers) && pkg.maintainers.length === 1) {
    push('info', 'provenance', 'npm-single-maintainer', '单一维护者', pkg.maintainers[0])
  }
  if (pkg?.versions <= 1) {
    push('low', 'maturity', 'npm-first-release', '只有一个发布版本', '缺少迭代证据，风险与完成度都更难判断')
  }
  if (pkg?.weeklyDownloads !== null && pkg.weeklyDownloads < 50) {
    push('low', 'adoption', 'npm-low-usage', '使用量很低', `${pkg.weeklyDownloads} 次/月下载`)
  }
  return findings
}

/** Shared scoring so metadata and source audits compare on one scale. */
export function scoreFindings(findings) {
  const totals = { critical: 0, high: 0, medium: 0, low: 0, info: 0 }
  for (const finding of Array.isArray(findings) ? findings : []) {
    const severity = [ 'critical', 'high', 'medium', 'low', 'info' ].includes(finding?.severity) ? finding.severity : 'info'
    totals[severity] += SEVERITY_WEIGHT[severity]
  }
  const score = Math.max(
    0,
    Math.min(100, 100 - Math.min(50, totals.critical) - Math.min(30, totals.high) - Math.min(16, totals.medium) - Math.min(6, totals.low)),
  )
  const forced = totals.critical > 0
  const verdict = forced ? 'unsafe' : score >= 80 ? 'safe' : score >= 60 ? 'caution' : 'unsafe'
  return { score, verdict, totals }
}

// ---------------------------------------------------------------------------
// network helpers

async function getJson(url, timeoutMs) {
  try {
    const response = await fetch(url, {
      signal: AbortSignal.timeout(timeoutMs),
      headers: { accept: 'application/json', 'user-agent': 'dsh-plugin-smith/0.1 (+https://github.com/YansongG-HKU/dsh-plugin-smith)' },
    })
    if (!response.ok) return { ok: false, error: `HTTP ${response.status}` }
    return { ok: true, value: await response.json() }
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : String(error) }
  }
}

async function getDownloads(name, timeoutMs) {
  const url = `${DOWNLOADS_API}/${encodeURIComponent(String(name))}`
  const result = await getJson(url, timeoutMs)
  if (!result.ok) return { ok: false }
  const downloads = Number(result.value?.downloads)
  return Number.isFinite(downloads) ? { ok: true, value: downloads } : { ok: false }
}

async function getGithub(repoUrl, timeoutMs) {
  const match = /github\.com[/:]([^/]+)\/([^/#?]+)/i.exec(repoUrl ?? '')
  if (!match) return { ok: false }
  const owner = match[1]
  const repo = match[2].replace(/\.git$/, '')
  const result = await getJson(`${GITHUB_API}/repos/${owner}/${repo}`, timeoutMs)
  if (!result.ok) return { ok: false }
  const value = result.value ?? {}
  return {
    ok: true,
    value: {
      stars: Number(value.stargazers_count) || 0,
      openIssues: Number(value.open_issues_count) || 0,
      pushedAt: value.pushed_at ?? null,
      archived: Boolean(value.archived),
      license: value.license?.spdx_id ?? null,
    },
  }
}

function normalizeRepoUrl(repository) {
  if (!repository) return null
  if (typeof repository === 'string') return repository
  if (typeof repository?.url === 'string') return repository.url
  return null
}

function normalizeLicense(license) {
  if (typeof license === 'string') return license
  if (license && typeof license === 'object' && typeof license.type === 'string') return license.type
  return null
}

// ---------------------------------------------------------------------------
// Source-level audit for a registry candidate
//
// Metadata alone cannot answer "what does this code do". Before the panel is
// allowed to recommend a registry package, the Smith downloads its published
// tarball, extracts it into a throwaway directory, runs the same static engine
// used for local bundles, and deletes the extraction. Nothing is installed and
// no script from the package is executed.

const MAX_TARBALL_BYTES = 30 * 1024 * 1024
const TAR_TIMEOUT_MS = 60_000

/** Download one tarball with a byte ceiling and a timeout. */
export async function fetchTarball(url, options = {}) {
  const timeoutMs = options.timeoutMs ?? TIMEOUT_MS
  const maxBytes = options.maxBytes ?? MAX_TARBALL_BYTES
  try {
    const response = await fetch(url, {
      signal: AbortSignal.timeout(timeoutMs),
      redirect: 'follow',
      headers: { accept: 'application/octet-stream', 'user-agent': 'dsh-plugin-smith/0.1' },
    })
    if (!response.ok) return { ok: false, error: `HTTP ${response.status}` }
    const declared = Number(response.headers.get('content-length'))
    if (Number.isFinite(declared) && declared > maxBytes) {
      return { ok: false, error: `tarball 超过上限（${declared} > ${maxBytes} 字节）` }
    }
    const buffer = new Uint8Array(await response.arrayBuffer())
    if (buffer.byteLength > maxBytes) {
      return { ok: false, error: `tarball 超过上限（${buffer.byteLength} > ${maxBytes} 字节）` }
    }
    return { ok: true, buffer }
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : String(error) }
  }
}

/**
 * Extract a package tarball into a fresh temporary directory.
 * Caller owns `cleanup()`. Extraction never runs package code.
 */
export async function extractTarball(buffer, options = {}) {
  const root = options.root ?? tmpdir()
  const timeoutMs = options.timeoutMs ?? TAR_TIMEOUT_MS
  let workdir
  try {
    workdir = await mkdtemp(join(root, 'smith-src-'))
    const file = join(workdir, 'package.tgz')
    await writeFile(file, buffer)
    const outDir = join(workdir, 'package')
    await mkdir(outDir, { recursive: true })
    // npm tarballs wrap everything in a single `package/` directory; strip it.
    await execFileAsync('tar', ['-xzf', file, '-C', outDir, '--strip-components', '1'], {
      timeout: timeoutMs,
      windowsHide: true,
      maxBuffer: 1024 * 1024,
    })
    return {
      ok: true,
      dir: outDir,
      bytes: buffer.byteLength,
      cleanup: async () => {
        await rm(workdir, { recursive: true, force: true }).catch(() => {})
      },
    }
  } catch (error) {
    if (workdir) await rm(workdir, { recursive: true, force: true }).catch(() => {})
    return { ok: false, error: error instanceof Error ? error.message : String(error) }
  }
}

/**
 * Source-level audit for one registry package.
 *
 * @param {{name?: string, version?: string|null, tarballUrl?: string|null}} pkg
 *   the package object returned by {@link collectRegistryEvidence}
 * @returns {Promise<{ok: boolean, audit?: object, error?: string, bytes?: number, version?: string}>}
 */
export async function auditRegistrySource(pkg, options = {}) {
  if (!pkg || typeof pkg.tarballUrl !== 'string' || pkg.tarballUrl.length === 0) {
    return { ok: false, error: 'registry 没有提供 tarball 地址' }
  }
  const fetched = await fetchTarball(pkg.tarballUrl, { timeoutMs: options.timeoutMs, maxBytes: options.maxBytes })
  if (!fetched.ok) return { ok: false, error: `tarball 下载失败：${fetched.error}` }
  const extracted = await extractTarball(fetched.buffer, { timeoutMs: options.tarTimeoutMs })
  if (!extracted.ok) return { ok: false, error: `tarball 解包失败：${extracted.error}` }
  try {
    const engine = await import('./audit.js')
    if (typeof engine.auditDirectory !== 'function') {
      return { ok: false, error: '静态审计引擎缺少 auditDirectory()' }
    }
    const audit = await engine.auditDirectory(extracted.dir, { maxFiles: options.maxFiles ?? 800 })
    let digest = null
    try {
      const { digestDirectory } = await import('./digest.js')
      digest = await digestDirectory(extracted.dir, { maxFiles: options.maxFiles ?? 800 })
    } catch {
      digest = null
    }
    return {
      ok: true,
      audit: {
        ...audit,
        scope: 'source',
        evidenceLevel: 'static',
        target: `npm:${pkg.name ?? '?'}${pkg.version ? `@${pkg.version}` : ''}#source`,
        stats: { ...(audit.stats ?? {}), bytes: audit.stats?.bytes ?? extracted.bytes, scannedAt: nowMs() },
        ...(digest
          ? { digest: digest.hash, digestFiles: digest.files, digestTruncated: digest.truncated }
          : {}),
      },
      bytes: fetched.buffer.byteLength,
      version: pkg.version ?? null,
    }
  } catch (error) {
    return { ok: false, error: `源码审计失败：${error instanceof Error ? error.message : String(error)}` }
  } finally {
    await extracted.cleanup()
  }
}
