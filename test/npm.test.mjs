import test from 'node:test'
import assert from 'node:assert/strict'
import { createServer } from 'node:http'
import { execFile } from 'node:child_process'
import { mkdtemp, mkdir, readdir, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { promisify } from 'node:util'

import {
  auditRegistrySource,
  collectRegistryEvidence,
  extractTarball,
  fetchTarball,
} from '../lib/npm.js'
import { mergeAudits } from '../lib/service.js'

const execFileAsync = promisify(execFile)

/** A realistic little package: manifest + one source file with a shell hook. */
async function makePackageDir({ withInstallScript = true } = {}) {
  const dir = await mkdtemp(join(tmpdir(), 'smith-pkg-'))
  const pkgDir = join(dir, 'package')
  await mkdir(pkgDir, { recursive: true })
  await writeFile(
    join(pkgDir, 'package.json'),
    JSON.stringify(
      {
        name: 'fixture-pkg',
        version: '1.2.3',
        type: 'module',
        license: 'MIT',
        repository: { url: 'https://github.com/example/fixture-pkg' },
        ...(withInstallScript
          ? { scripts: { postinstall: 'node ./scripts/install.js' } }
          : {}),
      },
      null,
      2,
    ),
    'utf8',
  )
  await writeFile(join(pkgDir, 'index.js'), 'export const answer = 42\n', 'utf8')
  await writeFile(
    join(pkgDir, 'risky.js'),
    "import { execSync } from 'node:child_process'\nexport const ping = () => execSync('echo hi')\nexport const run = (code) => eval(code)\n",
    'utf8',
  )
  return { root: dir, pkgDir }
}

async function makeTarball() {
  const { root, pkgDir } = await makePackageDir()
  const file = join(root, 'fixture-pkg-1.2.3.tgz')
  // npm tarballs carry a single top-level `package/` directory.
  await execFileAsync('tar', ['-czf', file, '-C', root, 'package'], { windowsHide: true })
  return { file, root, pkgDir }
}

async function withRegistry(handler) {
  const server = createServer(handler)
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve))
  const address = server.address()
  const base = `http://127.0.0.1:${address.port}`
  return {
    base,
    close: () => new Promise((resolve) => server.close(resolve)),
  }
}

test('fetchTarball rejects a non-2xx response', async () => {
  const registry = await withRegistry((_req, res) => {
    res.writeHead(404).end('nope')
  })
  try {
    const result = await fetchTarball(`${registry.base}/missing.tgz`, { timeoutMs: 3000 })
    assert.equal(result.ok, false)
    assert.match(result.error, /404/)
  } finally {
    await registry.close()
  }
})

test('extractTarball strips the npm package/ prefix and reports bytes', async () => {
  const { file, root } = await makeTarball()
  const { readFile } = await import('node:fs/promises')
  try {
    const buffer = new Uint8Array(await readFile(file))
    const extracted = await extractTarball(buffer, { root: tmpdir() })
    assert.equal(extracted.ok, true)
    assert.ok(extracted.bytes > 0)
    const files = await readdir(extracted.dir)
    assert.ok(files.includes('package.json'))
    assert.ok(files.includes('index.js'))
    await extracted.cleanup()
    await assert.rejects(() => readdir(extracted.dir))
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})

test('extractTarball fails cleanly on a non-archive buffer', async () => {
  const result = await extractTarball(new Uint8Array([1, 2, 3, 4]), { timeoutMs: 5000 })
  assert.equal(result.ok, false)
  assert.ok(typeof result.error === 'string' && result.error.length > 0)
})

test('registry evidence + source audit runs against a local registry', async () => {
  const { file, root } = await makeTarball()
  const { readFile } = await import('node:fs/promises')
  const tarballBytes = await readFile(file)
  const registry = await withRegistry((req, res) => {
    if (req.url === '/fixture-pkg') {
      res.writeHead(200, { 'content-type': 'application/json' })
      res.end(
        JSON.stringify({
          name: 'fixture-pkg',
          'dist-tags': { latest: '1.2.3' },
          time: { created: '2025-01-01T00:00:00.000Z', modified: '2025-02-01T00:00:00.000Z', '1.2.3': '2025-02-01T00:00:00.000Z' },
          maintainers: [{ name: 'fixture' }],
          versions: {
            '1.2.3': {
              name: 'fixture-pkg',
              version: '1.2.3',
              license: 'MIT',
              scripts: { postinstall: 'node ./scripts/install.js' },
              repository: { url: 'https://github.com/example/fixture-pkg' },
              dist: { tarball: `${registry.base}/fixture-pkg-1.2.3.tgz` },
            },
          },
        }),
      )
      return
    }
    if (req.url === '/fixture-pkg-1.2.3.tgz') {
      res.writeHead(200, { 'content-type': 'application/octet-stream' })
      res.end(tarballBytes)
      return
    }
    res.writeHead(404).end('missing')
  })
  try {
    const evidence = await collectRegistryEvidence('fixture-pkg', {
      registry: registry.base,
      community: false,
    })
    assert.equal(evidence.ok, true)
    assert.equal(evidence.package.version, '1.2.3')
    assert.match(evidence.package.tarballUrl, /fixture-pkg-1\.2\.3\.tgz$/)
    // The metadata audit must already catch the install script.
    assert.ok(evidence.findings.some((finding) => finding.id === 'npm-install-script'))

    const before = (await readdir(tmpdir())).filter((name) => name.startsWith('smith-src-')).length
    const source = await auditRegistrySource(evidence.package, { maxFiles: 100 })
    const after = (await readdir(tmpdir())).filter((name) => name.startsWith('smith-src-')).length

    assert.equal(source.ok, true, source.error)
    assert.equal(source.audit.scope, 'source')
    assert.equal(source.audit.evidenceLevel, 'static')
    assert.match(source.audit.target, /#source$/)
    assert.ok(source.audit.stats.files >= 2)
    assert.equal(source.audit.permissions.installScripts, true)
    assert.ok(source.audit.findings.some((finding) => finding.kind === 'eval') || source.audit.permissions.eval === true)
    assert.match(source.audit.digest, /^[0-9a-f]{64}$/)
    assert.ok(source.audit.digestFiles >= 2)
    assert.equal(after, before, 'the extracted source directory must be deleted')

    // Merged view keeps one comparable score and both evidence families.
    const merged = mergeAudits(
      {
        findings: [{ id: 'npm-install-script', severity: 'high', kind: 'installScript', title: '安装脚本', detail: '' }],
        permissions: {},
        stats: {},
        community: { downloadsLastMonth: 10 },
      },
      source.audit,
    )
    assert.equal(merged.scope, 'source')
    assert.equal(merged.evidenceLevel, 'static')
    assert.ok(merged.findings.some((finding) => finding.id === 'npm-install-script'))
    assert.ok(typeof merged.score === 'number')
    assert.deepEqual(merged.community, { downloadsLastMonth: 10 })
  } finally {
    await registry.close()
    await rm(root, { recursive: true, force: true })
  }
})

test('auditRegistrySource degrades when no tarball is published', async () => {
  const result = await auditRegistrySource({ name: 'x', version: '1.0.0', tarballUrl: null })
  assert.equal(result.ok, false)
  assert.match(result.error, /tarball/)
})
