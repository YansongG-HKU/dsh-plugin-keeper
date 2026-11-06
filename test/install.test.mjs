import test from 'node:test'
import assert from 'node:assert/strict'
import { cp, mkdtemp, mkdir, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

import { createSmithService, createStore } from '../lib/service.js'

const here = dirname(fileURLToPath(import.meta.url))
const bundleDir = join(here, 'fixtures', 'bundle-good')

/**
 * Full install chain against a fake profile manager: intake → candidates →
 * source audit (real engine + digest) → blood → decision → panel install
 * (L0 verify, pnpm step, L2 load confirmation, L4 digest match) → rollback (L5).
 */
function fakeManager({ profileDir }) {
  const state = { installed: false }
  const target = join(profileDir, 'node_modules', 'fixture-good')
  return {
    async inspect(spec) {
      return { status: 'accepted', kind: 'path', name: 'fixture-good', version: '1.0.0', bundle: true, registry: null, host: undefined, description: 'fixture' }
    },
    async installBundle(spec) {
      await cp(bundleDir, target, { recursive: true })
      state.installed = true
      return {
        changed: true,
        application: 'applied',
        stage: 'install',
        target: spec,
        bundle: 'fixture-good',
        version: '1.0.0',
        warnings: [],
      }
    },
    async listBundles() {
      return state.installed
        ? [
            {
              name: 'fixture-good',
              official: false,
              availability: 'profile',
              enabled: true,
              installed: true,
              optional: false,
              removable: true,
              rows: [{ rowId: 'fixture-good', moduleName: 'fixture-good', entryId: 'include:fixture-good' }],
              overrides: [],
            },
          ]
        : []
    },
    async listPlugins() {
      return state.installed
        ? [{ entryId: 'include:fixture-good', moduleName: 'fixture-good', enabled: true, fiberPhase: 'active' }]
        : []
    },
    async removeBundle(name) {
      await rm(join(profileDir, 'node_modules', name), { recursive: true, force: true })
      state.installed = false
      return { changed: true, application: 'applied', stage: 'remove', target: name }
    },
  }
}

async function setup() {
  const profileDir = await mkdtemp(join(tmpdir(), 'smith-accept-profile-'))
  await mkdir(join(profileDir, 'node_modules'), { recursive: true })
  const dataDir = await mkdtemp(join(tmpdir(), 'smith-accept-data-'))
  const ctx = {
    agents: { currentInitiator: () => undefined },
    workingDirectory: { get: () => dataDir },
    get() {
      return undefined
    },
  }
  const service = createSmithService({ ctx, store: createStore({ dir: dataDir }) })
  return { profileDir, dataDir, ctx, service }
}

test('panel install runs L0 → L2 → L4 and rollback runs L5', async () => {
  const { profileDir, ctx, service } = await setup()
  const previousProfile = process.env.DSH_PROFILE_DIR
  process.env.DSH_PROFILE_DIR = profileDir
  try {
    const created = await service.intake('验收：把一个真实本地 bundle 装进隔离 profile', { depth: 'quick' })
    const id = created.record.id
    await service.upsertCandidates(id, [
      { name: 'fixture-good', version: '1.0.0', spec: bundleDir, source: 'local', license: 'MIT' },
    ])

    const audited = await service.audit(id, { path: bundleDir })
    assert.equal(audited.auditScope, 'source')
    assert.match(audited.record.audit.digest, /^[0-9a-f]{64}$/)
    assert.equal(audited.record.audit.digestFiles, audited.record.audit.stats.files)

    const blooded = await service.blood(id, { gaps: [] })
    assert.equal(blooded.record.blood.label, 'full')

    const decided = await service.decide(id, {
      kind: 'install',
      rationale: '满血、源码可读、审计安全，用验收夹具跑完整安装链路。',
    })
    assert.equal(decided.record.status, 'awaiting-approval')

    ctx.pluginManager = fakeManager({ profileDir })
    const installed = await service.install(id, { via: 'panel' })
    assert.equal(installed.ok, true, installed.error)
    assert.equal(installed.record.status, 'installed')
    assert.equal(installed.record.install.application, 'applied')
    assert.equal(installed.record.install.bundle, 'fixture-good')
    assert.equal(installed.record.approval.via, 'panel')

    const checks = installed.record.verification.checks
    const byName = (name) => checks.find((check) => check.name === name)
    assert.equal(byName('manifest 可解析').status, 'pass')
    assert.equal(byName('bundle patch').status, 'pass')
    assert.equal(byName('JS 语法').status, 'pass')
    assert.equal(byName('pnpm 安装').status, 'pass')
    assert.equal(byName('profile 加载确认').status, 'pass')
    assert.equal(byName('安装物完整性').status, 'pass')
    assert.equal(installed.record.verification.passed, true)
    // The gate is the highest CONTIGUOUS level: L0/L1/L2 were verified and L3
    // (behavior) is not automated in V1, so the gate stays L2 while the L4
    // integrity row still records its own pass.
    assert.equal(installed.record.verification.gate, 'L2')
    assert.deepEqual(installed.record.verification.checks.map((check) => check.level).slice(-2), ['L2', 'L4'])

    const state = await service.state()
    assert.equal(state.stats.installed, 1)
    assert.equal(state.history.length, 1)
    assert.equal(state.history[0].recordId, id)

    const rolledBack = await service.rollback(id)
    assert.equal(rolledBack.ok, true, rolledBack.error)
    assert.equal(rolledBack.record.status, 'ready')
    assert.equal(rolledBack.record.install.application, 'cancelled')
    const l5 = rolledBack.record.verification.checks.find((check) => check.level === 'L5')
    assert.equal(l5.status, 'pass')
  } finally {
    if (previousProfile === undefined) delete process.env.DSH_PROFILE_DIR
    else process.env.DSH_PROFILE_DIR = previousProfile
    await rm(profileDir, { recursive: true, force: true })
  }
})

test('an install without the panel approval is refused for the agent tool', async () => {
  const { profileDir, ctx, service } = await setup()
  const previousProfile = process.env.DSH_PROFILE_DIR
  process.env.DSH_PROFILE_DIR = profileDir
  try {
    const created = await service.intake('验收：模型不能代替用户点安装')
    const id = created.record.id
    await service.upsertCandidates(id, [{ name: 'fixture-good', spec: bundleDir, source: 'local' }])
    await service.audit(id, { path: bundleDir })
    await service.blood(id, { gaps: [] })
    await service.decide(id, { kind: 'install', rationale: '满血、安全，等待用户确认安装动作' })
    ctx.pluginManager = fakeManager({ profileDir })

    const result = await service.install(id, { via: 'tool' })
    assert.equal(result.ok, false)
    assert.equal(result.requiresUserConfirmation, true)
    assert.match(result.error, /面板/)

    const unchanged = await service.detail(id)
    assert.equal(unchanged.record.status, 'awaiting-approval')
    assert.equal(unchanged.record.install, null)
  } finally {
    if (previousProfile === undefined) delete process.env.DSH_PROFILE_DIR
    else process.env.DSH_PROFILE_DIR = previousProfile
    await rm(profileDir, { recursive: true, force: true })
  }
})

test('L4 fails when the installed package differs from the audited digest', async () => {
  const { profileDir, ctx, service } = await setup()
  const previousProfile = process.env.DSH_PROFILE_DIR
  process.env.DSH_PROFILE_DIR = profileDir
  try {
    const created = await service.intake('验收：安装物被替换时必须拦截')
    const id = created.record.id
    await service.upsertCandidates(id, [{ name: 'fixture-good', spec: bundleDir, source: 'local' }])
    await service.audit(id, { path: bundleDir })
    await service.blood(id, { gaps: [] })
    await service.decide(id, { kind: 'install', rationale: '满血、安全，验证 L4 拦截被替换的安装物。' })

    const manager = fakeManager({ profileDir })
    const originalInstall = manager.installBundle
    manager.installBundle = async (spec) => {
      const result = await originalInstall(spec)
      // Simulate a tampered artifact: alter a file after installation.
      const { writeFile } = await import('node:fs/promises')
      await writeFile(join(profileDir, 'node_modules', 'fixture-good', 'index.js'), 'export function apply() {}\n// tampered\n', 'utf8')
      return result
    }
    ctx.pluginManager = manager

    const result = await service.install(id, { via: 'panel' })
    assert.equal(result.ok, false)
    assert.equal(result.record.status, 'verifying')
    const integrity = result.record.verification.checks.find((check) => check.level === 'L4')
    assert.equal(integrity.status, 'fail')
    assert.match(result.error, /不一致/)
  } finally {
    if (previousProfile === undefined) delete process.env.DSH_PROFILE_DIR
    else process.env.DSH_PROFILE_DIR = previousProfile
    await rm(profileDir, { recursive: true, force: true })
  }
})
