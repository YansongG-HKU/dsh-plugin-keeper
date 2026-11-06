import test from 'node:test'
import assert from 'node:assert/strict'
import { createServer } from 'node:http'
import { execFile } from 'node:child_process'
import { existsSync } from 'node:fs'
import { mkdtemp, mkdir, readFile, rm, stat, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { promisify } from 'node:util'

import { digestDirectory } from '../lib/digest.js'
import { resolvePnpm, sandboxEvidence, trialInstall } from '../lib/sandbox.js'
import { createKeeperService, createStore } from '../lib/service.js'

const execFileAsync = promisify(execFile)
const here = dirname(fileURLToPath(import.meta.url))
const fixtureDir = join(here, 'fixtures', 'bundle-good')

/**
 * This workspace runs on a machine whose pnpm is the packaged desktop runtime,
 * not a PATH executable. Tests use the same override the plugin supports
 * (`DSH_KEEPER_PNPM`); without a discoverable pnpm the pnpm-dependent tests skip
 * instead of failing the suite.
 */
const PNPM_CANDIDATES = [
  process.env.KEEPER_TEST_PNPM,
  process.env.DSH_KEEPER_PNPM,
  'E:/DeepSeek Harness/resources/runtime/primary-runtime/dependencies/pnpm/bin/pnpm.mjs',
].filter((value) => typeof value === 'string' && value.length > 0)
const pnpmPath = PNPM_CANDIDATES.find((candidate) => existsSync(candidate)) ?? null
if (pnpmPath) process.env.DSH_KEEPER_PNPM = pnpmPath
const noPnpm = pnpmPath ? false : 'no discoverable pnpm on this machine (set KEEPER_TEST_PNPM)'

test('resolvePnpm prefers the Host profileContext package manager', () => {
  const previous = process.env.DSH_KEEPER_PNPM
  delete process.env.DSH_KEEPER_PNPM
  try {
    const resolved = resolvePnpm({ profileContext: { packageManager: { command: 'node', args: ['/opt/pnpm.cjs'], env: { X: '1' } } } })
    assert.equal(resolved.command, 'node')
    assert.deepEqual(resolved.prefixArgs, ['/opt/pnpm.cjs'])
    assert.equal(resolved.env.X, '1')
  } finally {
    if (previous !== undefined) process.env.DSH_KEEPER_PNPM = previous
  }
})

test('trialInstall materializes a local bundle with scripts disabled and cleans up', { skip: noPnpm }, async () => {
  const trial = await trialInstall(fixtureDir, { timeoutMs: 120000 })
  assert.equal(trial.ok, true, trial.error)
  assert.equal(trial.packageName, 'fixture-good')
  assert.equal(trial.version, '1.0.0')
  assert.equal(trial.scriptsDisabled, true)
  const manifest = JSON.parse(await readFile(join(trial.dir, 'package.json'), 'utf8'))
  assert.equal(manifest.name, 'fixture-good')

  const actual = await digestDirectory(trial.dir)
  const expected = await digestDirectory(fixtureDir)
  assert.equal(actual.hash, expected.hash)

  const root = trial.root
  await trial.cleanup()
  await assert.rejects(() => stat(root))
})

test('sandboxEvidence proves digest parity and always deletes the sandbox root', { skip: noPnpm }, async () => {
  const expected = await digestDirectory(fixtureDir)
  const evidence = await sandboxEvidence({ spec: fixtureDir, expectedDigest: expected.hash })
  assert.equal(evidence.ok, true, evidence.error)
  assert.equal(evidence.evidenceLevel, 'sandbox')
  assert.equal(evidence.scriptsDisabled, true)
  assert.equal(evidence.digestMatch, true)
  assert.equal(evidence.packageName, 'fixture-good')
  assert.equal(evidence.files, expected.files)

  const mismatched = await sandboxEvidence({ spec: fixtureDir, expectedDigest: 'f'.repeat(64) })
  assert.equal(mismatched.ok, true)
  assert.equal(mismatched.digestMatch, false)
  assert.match(mismatched.error, /不一致/)
})

test('trialInstall reports an unresolvable spec without throwing', { skip: noPnpm }, async () => {
  const trial = await trialInstall('this-package-name-should-not-exist-keeper-000@0.0.0', { timeoutMs: 60000 })
  assert.equal(trial.ok, false)
  assert.ok(typeof trial.error === 'string' && trial.error.length > 0)
})

async function localRegistry() {
  const tarball = join(await mkdtemp(join(tmpdir(), 'keeper-tar-')), 'pkg.tgz')
  const stage = await mkdtemp(join(tmpdir(), 'keeper-stage-'))
  const pkgDir = join(stage, 'package')
  await mkdir(pkgDir, { recursive: true })
  const files = {
    'package.json': JSON.stringify({ name: 'fixture-pkg', version: '1.2.3', type: 'module', license: 'MIT' }, null, 2),
    'index.js': 'export const answer = 42\n',
    'cordis.patch.yml': '- insert:\n    - id: fixture-pkg\n      name: fixture-pkg\n',
  }
  for (const [name, content] of Object.entries(files)) await writeFile(join(pkgDir, name), content, 'utf8')
  await execFileAsync('tar', ['-czf', tarball, '-C', stage, 'package'], { windowsHide: true })
  const bytes = await readFile(tarball)

  const server = createServer((req, res) => {
    if (req.url === '/fixture-pkg') {
      res.writeHead(200, { 'content-type': 'application/json' })
      res.end(
        JSON.stringify({
          name: 'fixture-pkg',
          'dist-tags': { latest: '1.2.3' },
          time: { created: '2025-01-01T00:00:00.000Z', modified: '2025-01-02T00:00:00.000Z', '1.2.3': '2025-01-02T00:00:00.000Z' },
          maintainers: [{ name: 'fixture' }],
          versions: {
            '1.2.3': {
              name: 'fixture-pkg',
              version: '1.2.3',
              license: 'MIT',
              dist: { tarball: `${base}/fixture-pkg-1.2.3.tgz` },
            },
          },
        }),
      )
      return
    }
    if (req.url === '/fixture-pkg-1.2.3.tgz') {
      res.writeHead(200, { 'content-type': 'application/octet-stream' })
      res.end(bytes)
      return
    }
    res.writeHead(404).end('missing')
  })
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve))
  const base = `http://127.0.0.1:${server.address().port}`
  return {
    base,
    tarballUrl: `${base}/fixture-pkg-1.2.3.tgz`,
    expectedDigest: (await digestDirectory(pkgDir)).hash,
    close: () => new Promise((resolve) => server.close(resolve)),
  }
}

test('sandboxEvidence works against a tarball over HTTP', { skip: noPnpm }, async () => {
  const registry = await localRegistry()
  try {
    const evidence = await sandboxEvidence({
      spec: registry.tarballUrl,
      expectedDigest: registry.expectedDigest,
      timeoutMs: 120000,
    })
    assert.equal(evidence.ok, true, evidence.error)
    assert.equal(evidence.packageName, 'fixture-pkg')
    assert.equal(evidence.digestMatch, true)
  } finally {
    await registry.close()
  }
})

test('service.audit with sandbox:true upgrades the evidence level to sandbox', { skip: noPnpm }, async () => {
  const registry = await localRegistry()
  const dataDir = await mkdtemp(join(tmpdir(), 'keeper-sandbox-svc-'))
  try {
    const service = createKeeperService({
      ctx: { agents: { currentInitiator: () => undefined }, workingDirectory: { get: () => dataDir } },
      store: createStore({ dir: dataDir }),
    })
    const created = await service.intake('深挖审计：验证隔离试装证据', { depth: 'deep' })
    const id = created.record.id
    await service.upsertCandidates(id, [
      { name: 'fixture-pkg', version: '1.2.3', spec: registry.tarballUrl, source: 'npm' },
    ])

    const audited = await service.audit(id, {
      packageName: 'fixture-pkg',
      registry: registry.base,
      community: false,
      sandbox: true,
      sourceTimeoutMs: 20000,
      sandboxTimeoutMs: 120000,
    })
    assert.equal(audited.auditScope, 'source')
    assert.equal(audited.audit.evidenceLevel, 'sandbox')
    assert.equal(audited.audit.sandbox.ok, true)
    assert.equal(audited.audit.sandbox.scriptsDisabled, true)
    assert.equal(audited.audit.sandbox.digestMatch, true)
    assert.equal(audited.audit.sandbox.version, '1.2.3')
    assert.match(audited.audit.sandbox.packageName, /fixture-pkg/)
  } finally {
    await registry.close()
    await rm(dataDir, { recursive: true, force: true })
  }
})
