import test from 'node:test'
import assert from 'node:assert/strict'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

import { loadCheck, makeVerification, verificationPassed, verifyBundle } from '../lib/verify.js'

const here = dirname(fileURLToPath(import.meta.url))
const fixtures = join(here, 'fixtures')

test('a well-formed bundle passes the L0 gate', async () => {
  const result = await verifyBundle(join(fixtures, 'bundle-good'))
  assert.equal(result.ok, true)
  assert.equal(result.verification.passed, true)
  assert.equal(result.verification.gate, 'L0')
  assert.ok(result.verification.checks.every((check) => check.status !== 'fail'))
})

test('a broken bundle fails on the missing patch and bad syntax', async () => {
  const result = await verifyBundle(join(fixtures, 'bundle-broken'))
  assert.equal(result.ok, false)
  assert.equal(result.verification.passed, false)
  const failed = result.verification.checks.filter((check) => check.status === 'fail').map((check) => check.name)
  assert.ok(failed.includes('bundle patch'))
  assert.ok(failed.includes('JS 语法'))
})

test('a missing directory fails cleanly', async () => {
  const result = await verifyBundle(join(fixtures, 'does-not-exist'))
  assert.equal(result.ok, false)
  assert.match(result.error ?? '', /目录/)
})

test('a failed check keeps verification closed', () => {
  const verification = makeVerification([
    { level: 'L0', name: 'manifest', status: 'pass', detail: '' },
    { level: 'L1', name: 'tests', status: 'fail', detail: 'boom' },
  ])
  assert.equal(verification.passed, false)
  assert.equal(verificationPassed(verification), false)
})

test('L2 load confirmation requires installed and enabled', () => {
  const passing = loadCheck({
    bundles: [{ name: 'pkg', installed: true, enabled: true, rows: [] }],
    plugins: [],
    spec: 'pkg',
    bundleName: 'pkg',
  })
  assert.equal(passing.status, 'pass')

  const disabled = loadCheck({
    bundles: [{ name: 'pkg', installed: true, enabled: false, rows: [] }],
    plugins: [],
    spec: 'pkg',
    bundleName: 'pkg',
  })
  assert.equal(disabled.status, 'fail')

  const missing = loadCheck({ bundles: [], plugins: [], spec: 'pkg', bundleName: 'pkg' })
  assert.equal(missing.status, 'fail')
})

test('a failed plugin row blocks L2', () => {
  const result = loadCheck({
    bundles: [{ name: 'pkg', installed: true, enabled: true, rows: [{ rowId: 'r1', entryId: 'e1', moduleName: 'pkg' }] }],
    plugins: [{ entryId: 'e1', moduleName: 'pkg', fiberPhase: 'failed' }],
    spec: 'pkg',
    bundleName: 'pkg',
  })
  assert.equal(result.status, 'fail')
})
