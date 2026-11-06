/**
 * Acceptance fixture: one record whose candidate is a real local bundle, fully
 * audited with a content digest, blood full, decision install. Seeding this
 * record and pressing install in the panel exercises the complete chain:
 *
 *   install gate → spec inspect → L0 verify → pnpm install → L2 load → L4 digest
 *   → install ledger → rollback (L5)
 *
 * Usage: node scripts/seed-install-test.mjs <target-dsh-home>
 */

import { mkdir, writeFile } from 'node:fs/promises'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { auditDirectory } from '../lib/audit.js'
import { digestDirectory } from '../lib/digest.js'

const here = dirname(fileURLToPath(import.meta.url))
const target = process.argv[2]
if (!target) {
  console.error('usage: node scripts/seed-install-test.mjs <target-dsh-home>')
  process.exit(1)
}

const bundleDir = resolve(here, '..', 'test', 'fixtures', 'bundle-good')
const audit = await auditDirectory(bundleDir, { maxFiles: 200 })
const digest = await digestDirectory(bundleDir)
const now = Date.now()
const at = (minutesAgo) => now - minutesAgo * 60_000

const record = {
  id: 'sc-20261105-040000-ffee',
  createdAt: at(30),
  updatedAt: at(10),
  intent: {
    text: '验收用：把一个真实本地 bundle 装进隔离 profile，验证 L0/L2/L4 与回滚 L5。',
    title: '验收：本地 bundle 安装链路',
    capabilities: ['安装本地 bundle', 'L2 加载确认', 'L4 内容摘要一致'],
    constraints: ['只在隔离 profile 里做'],
    depth: 'quick',
  },
  status: 'awaiting-approval',
  statusReason: '审计与血量已完成，等待用户点击安装。',
  candidate: {
    name: 'fixture-good',
    version: '1.0.0',
    spec: bundleDir,
    source: 'local',
    license: 'MIT',
    description: 'Acceptance fixture bundle',
    capabilities: [{ id: '安装本地 bundle', state: 'present', evidence: 'bundle-good 结构完整' }],
    fitScore: 100,
    qualityScore: 100,
    maintenanceScore: 100,
    riskScore: 0,
    addedAt: at(25),
  },
  candidates: [
    {
      name: 'fixture-good',
      version: '1.0.0',
      spec: bundleDir,
      source: 'local',
      license: 'MIT',
      fitScore: 100,
      qualityScore: 100,
      maintenanceScore: 100,
      riskScore: 0,
      addedAt: at(25),
    },
  ],
  audit: {
    ...audit,
    scope: 'source',
    evidenceLevel: 'static',
    target: bundleDir,
    digest: digest.hash,
    digestFiles: digest.files,
    digestTruncated: digest.truncated,
  },
  blood: {
    score: 100,
    label: 'full',
    summary: '验收夹具：能力完整、无缺口。',
    gaps: [],
  },
  decision: {
    kind: 'install',
    rationale: '验收夹具：满血且本地源码可读，用于验证安装链路与 L4 完整性。',
    at: at(15),
    plan: null,
  },
  execution: null,
  verification: null,
  install: null,
  approval: null,
  links: { sessionIds: [] },
  notes: [],
  history: [
    { at: at(30), kind: 'intake', detail: '立案（quick）：验收夹具' },
    { at: at(25), kind: 'candidates', detail: '候选 1 个（选中 fixture-good）' },
    { at: at(20), kind: 'audit', detail: `static/source 审计 ${audit.score}/100 ${audit.verdict}` },
    { at: at(15), kind: 'blood', detail: '血量 100/100 full' },
    { at: at(15), kind: 'decision', detail: '决策 install' },
  ],
}

const dir = join(target, 'plugin-keeper')
await mkdir(dir, { recursive: true })
await writeFile(join(dir, 'records.json'), `${JSON.stringify({ version: 1, records: [record] }, null, 2)}\n`, 'utf8')
await writeFile(join(dir, 'history.json'), `${JSON.stringify({ version: 1, entries: [] }, null, 2)}\n`, 'utf8')
console.log(JSON.stringify({ seeded: dir, bundleDir, digest: digest.hash, auditScore: audit.score }))
