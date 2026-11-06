import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, mkdir, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { digestDirectory } from '../lib/digest.js'
import { integrityCheck } from '../lib/install.js'

async function fixture() {
  const dir = await mkdtemp(join(tmpdir(), 'keeper-digest-'))
  await mkdir(join(dir, 'lib'), { recursive: true })
  await writeFile(join(dir, 'package.json'), JSON.stringify({ name: 'x', version: '1.0.0' }), 'utf8')
  await writeFile(join(dir, 'lib', 'index.js'), 'export const x = 1\n', 'utf8')
  return dir
}

test('digest is deterministic and path-scoped', async () => {
  const dir = await fixture()
  const first = await digestDirectory(dir)
  const second = await digestDirectory(dir)
  assert.equal(first.hash, second.hash)
  assert.equal(first.files, 2)
  assert.equal(first.truncated, false)

  await writeFile(join(dir, 'lib', 'index.js'), 'export const x = 2\n', 'utf8')
  const changed = await digestDirectory(dir)
  assert.notEqual(changed.hash, first.hash)
})

test('digest skips node_modules and reports truncation', async () => {
  const dir = await fixture()
  await mkdir(join(dir, 'node_modules', 'dep'), { recursive: true })
  await writeFile(join(dir, 'node_modules', 'dep', 'index.js'), 'noise'.repeat(1000), 'utf8')
  const clean = await digestDirectory(dir)
  assert.equal(clean.files, 2)

  const capped = await digestDirectory(dir, { maxFiles: 1 })
  assert.equal(capped.truncated, true)
  assert.equal(capped.files, 1)
})

test('integrityCheck passes when installed content matches the audited digest', async () => {
  const profile = await mkdtemp(join(tmpdir(), 'keeper-profile-'))
  const installed = join(profile, 'node_modules', 'fixture-pkg')
  await mkdir(installed, { recursive: true })
  await writeFile(join(installed, 'package.json'), JSON.stringify({ name: 'fixture-pkg', version: '1.0.0' }), 'utf8')
  await writeFile(join(installed, 'index.js'), 'export const ok = true\n', 'utf8')
  const digest = await digestDirectory(installed)

  const check = await integrityCheck({
    audit: { digest: digest.hash, digestFiles: digest.files },
    packageName: 'fixture-pkg',
    profileDir: profile,
  })
  assert.equal(check.level, 'L4')
  assert.equal(check.status, 'pass')
  assert.match(check.detail, /一致/)
})

test('integrityCheck fails when the installed bytes differ', async () => {
  const profile = await mkdtemp(join(tmpdir(), 'keeper-profile-'))
  const installed = join(profile, 'node_modules', 'fixture-pkg')
  await mkdir(installed, { recursive: true })
  await writeFile(join(installed, 'index.js'), 'export const ok = true\n', 'utf8')
  const digest = await digestDirectory(installed)
  await writeFile(join(installed, 'index.js'), 'export const ok = false\n', 'utf8')

  const check = await integrityCheck({
    audit: { digest: digest.hash, digestFiles: digest.files },
    packageName: 'fixture-pkg',
    profileDir: profile,
  })
  assert.equal(check.status, 'fail')
  assert.match(check.detail, /不一致/)
})

test('integrityCheck skips without evidence instead of passing', async () => {
  const missingDigest = await integrityCheck({ audit: {}, packageName: 'x', profileDir: '/tmp' })
  assert.equal(missingDigest.status, 'skip')

  const truncated = await integrityCheck({
    audit: { digest: 'a'.repeat(64), digestTruncated: true },
    packageName: 'x',
    profileDir: '/tmp',
  })
  assert.equal(truncated.status, 'skip')

  const noProfile = await integrityCheck({ audit: { digest: 'a'.repeat(64) }, packageName: 'x' })
  assert.equal(noProfile.status, 'skip')

  const noPackageDir = await integrityCheck({
    audit: { digest: 'a'.repeat(64) },
    packageName: 'not-installed',
    profileDir: await mkdtemp(join(tmpdir(), 'keeper-profile-')),
  })
  assert.equal(noPackageDir.status, 'skip')
})
