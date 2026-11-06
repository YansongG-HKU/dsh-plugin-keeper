/**
 * Verification fixture: seed an isolated Harness home with two realistic ledger
 * records so the installed panel can be checked against every detail section
 * (blood gaps, audit findings, decision plan, verification rows, install record).
 *
 * Usage: node scripts/seed-verify-home.mjs <target-dsh-home>
 * It never touches a real profile: the caller passes an isolated DSH_HOME.
 */

import { mkdir, writeFile } from 'node:fs/promises'
import { join } from 'node:path'

const target = process.argv[2]
if (!target) {
  console.error('usage: node scripts/seed-verify-home.mjs <target-dsh-home>')
  process.exit(1)
}

const now = Date.now()
const at = (minutesAgo) => now - minutesAgo * 60_000

const recordA = {
  id: 'sc-20261105-030000-a1b2',
  createdAt: at(180),
  updatedAt: at(6),
  intent: {
    text: '我想要一个能把当前会话导出成带样式的 PDF 的插件，最好能选时间范围，并且完全本地运行不上传。',
    title: '会话导出为带样式 PDF，可选时间范围，纯本地',
    capabilities: ['导出会话为 PDF', '保留代码块与表格样式', '按时间范围筛选消息', '完全本地运行，不上传内容'],
    constraints: ['不引入云端服务', '导出结果可读、可分页'],
    depth: 'standard',
  },
  status: 'awaiting-approval',
  statusReason: '已找到可用候选并完成验毒；存在两处缺口，等待用户确认补齐方案。',
  candidate: {
    name: '@acme/session-pdf-export',
    version: '1.4.2',
    spec: '@acme/session-pdf-export',
    source: 'npm',
    repository: 'https://github.com/acme/session-pdf-export',
    homepage: 'https://github.com/acme/session-pdf-export#readme',
    license: 'MIT',
    description: 'Render a Harness session transcript to a styled PDF locally.',
    capabilities: [
      { id: '导出会话为 PDF', state: 'present', evidence: 'README + 实际代码路径 lib/render.js' },
      { id: '保留代码块与表格样式', state: 'present', evidence: '主题模板 templates/default.css' },
      { id: '按时间范围筛选消息', state: 'missing', evidence: 'CLI 只有 --all，没有时间范围参数；issue #41 请求中' },
      { id: '完全本地运行，不上传内容', state: 'partial', evidence: '渲染在本地，但封面图会请求 fonts.googleapis.com' },
    ],
    fitScore: 82,
    qualityScore: 76,
    maintenanceScore: 88,
    riskScore: 9,
    notes: '两处缺口：时间范围筛选、在线字体依赖。均可本地补齐，不需要改动上游架构。',
    addedAt: at(150),
  },
  candidates: [
    {
      name: '@acme/session-pdf-export',
      version: '1.4.2',
      spec: '@acme/session-pdf-export',
      source: 'npm',
      repository: 'https://github.com/acme/session-pdf-export',
      license: 'MIT',
      fitScore: 82,
      qualityScore: 76,
      maintenanceScore: 88,
      riskScore: 9,
      addedAt: at(150),
    },
    {
      name: 'transcript-pdf',
      version: '0.9.0',
      spec: 'transcript-pdf',
      source: 'npm',
      license: 'GPL-3.0',
      fitScore: 61,
      qualityScore: 58,
      maintenanceScore: 40,
      riskScore: 34,
      addedAt: at(150),
    },
    {
      name: 'dsh-export-suite',
      version: '2.0.0',
      spec: 'dsh-export-suite',
      source: 'github',
      license: 'Apache-2.0',
      fitScore: 70,
      qualityScore: 65,
      maintenanceScore: 72,
      riskScore: 22,
      addedAt: at(150),
    },
  ],
  audit: {
    score: 91,
    verdict: 'safe',
    evidenceLevel: 'static',
    scope: 'source',
    target: 'npm:@acme/session-pdf-export@1.4.2',
    findings: [
      {
        id: 'npm-install-script',
        severity: 'low',
        kind: 'installScript',
        title: 'prepare 脚本',
        detail: 'prepare 只构建本地模板，不含网络下载。',
      },
      {
        id: 'network',
        severity: 'low',
        kind: 'network',
        title: '有限的网络出口',
        detail: '封面模板请求 fonts.googleapis.com；正文渲染完全本地。',
      },
      {
        id: 'npm-single-maintainer',
        severity: 'info',
        kind: 'provenance',
        title: '单一维护者',
        detail: 'maintainer: acme-labs',
      },
    ],
    permissions: {
      installScripts: true,
      network: ['fonts.googleapis.com'],
      childProcess: false,
      eval: false,
      filesystemWrite: true,
      credentials: false,
      obfuscated: false,
      nativeAddons: false,
      patchesShippedRows: false,
      sparseSource: false,
    },
    stats: { files: 41, bytes: 284_331, dependencies: 6, scannedAt: at(120) },
    digest: '3f9c1d2e4b5a69788796a5b4c3d2e1f00112233445566778899aabbccddeeff0',
    digestFiles: 41,
    community: { downloadsLastMonth: 1840, githubStars: 37, githubOpenIssues: 5, githubArchived: false },
  },
  blood: {
    score: 72,
    label: 'thin',
    summary: '残血：能力大体覆盖，但缺少时间范围筛选，且首次渲染依赖在线字体。',
    gaps: [
      {
        id: 'gap-time-range',
        capability: '按时间范围筛选消息',
        state: 'missing',
        kind: 'incomplete',
        evidence: 'CLI 只有 --all；issue #41 已提出但未实现',
        remedy: '在导出入口增加 --since/--until 过滤，复用它已有的消息游标；补一条单测。',
        effort: 'M',
        risk: 'low',
      },
      {
        id: 'gap-offline-fonts',
        capability: '完全本地运行，不上传内容',
        state: 'partial',
        kind: 'integration',
        evidence: '模板请求 fonts.googleapis.com，断网或离线环境会退化',
        remedy: '把字体改成本地打包的 woff2，删除远程 link；附 license 说明。',
        effort: 'S',
        risk: 'low',
      },
    ],
  },
  decision: {
    kind: 'complete-then-install',
    rationale:
      '候选审计安全（91/100），能力覆盖 3/4，但时间范围与离线字体两处缺口直接影响原始需求，直接安装等于接受残血版。补齐成本 M，风险低，保留 MIT 署名即可。',
    at: at(30),
    plan: {
      steps: [
        'fork acme/session-pdf-export，保留 LICENSE 与原仓库链接',
        '本地打包字体并删除远程 font link，验证离线渲染',
        '增加 --since/--until 过滤，复用现有消息游标',
        '补两条测试：时间范围过滤、离线渲染',
        '跑 L0/L1 门禁，产出可安装 bundle',
      ],
      effort: 'M',
      risks: ['上游后续改动需要 rebase', '字体文件增加包体积约 300KB'],
      upstream: {
        repo: 'https://github.com/acme/session-pdf-export',
        fork: true,
        attribution: 'Derived from @acme/session-pdf-export (MIT), copyright acme-labs.',
        licenseNote: 'MIT 允许修改与再分发，保留版权声明与许可全文。',
      },
      acceptCriteria: [
        '离线环境可完整导出 PDF',
        '--since/--until 生效且边界正确',
        'L0/L1 全过，L2 安装后加载确认',
      ],
    },
  },
  execution: null,
  verification: {
    passed: true,
    gate: 'L0',
    at: at(40),
    checks: [
      { level: 'L0', name: 'spec 预检', status: 'pass', detail: 'registry · @acme/session-pdf-export@1.4.2', at: at(40) },
      { level: 'L1', name: '自带测试', status: 'skip', detail: 'registry 包安装前无法运行上游测试', at: at(40) },
    ],
  },
  install: null,
  approval: null,
  links: { sessionIds: ['session-demo-a'] },
  notes: [
    { at: at(25), text: '用户确认：先把缺口补齐再装，不接受在线字体。', actor: 'user' },
  ],
  history: [
    { at: at(180), kind: 'intake', detail: '立案（standard）' },
    { at: at(150), kind: 'candidates', detail: '候选 3 个（选中 @acme/session-pdf-export）' },
    { at: at(120), kind: 'audit', detail: 'static 审计 91/100 safe，发现 3 项' },
    { at: at(60), kind: 'blood', detail: '血量 72/100 thin，缺口 2 项' },
    { at: at(30), kind: 'decision', detail: '决策 complete-then-install' },
    { at: at(6), kind: 'update', detail: '补充上游署名与验收标准' },
  ],
}

const recordB = {
  id: 'sc-20261104-221500-c3d4',
  createdAt: at(480),
  updatedAt: at(300),
  intent: {
    text: '长会话太占上下文，想要一个能自动折叠旧历史、又能按关键词找回原文的插件。',
    title: '自动折叠旧历史并可检索恢复',
    capabilities: ['自动压缩旧上下文', '全文检索历史', '按 seq 精确恢复原文'],
    constraints: ['不改动会话可见内容', '可回滚'],
    depth: 'standard',
  },
  status: 'installed',
  statusReason: '安装完成并通过 L2 加载确认',
  candidate: {
    name: 'dsh-context-keeper',
    version: '0.1.0',
    spec: 'dsh-context-keeper',
    source: 'npm',
    repository: 'https://github.com/YansongG-HKU/dsh-context-keeper',
    license: 'MIT',
    description: 'Context budget tools plus incremental reversible auto-compaction.',
    capabilities: [
      { id: '自动压缩旧上下文', state: 'present', evidence: 'lib/auto.js' },
      { id: '全文检索历史', state: 'present', evidence: 'lib/events.js searchEvents' },
      { id: '按 seq 精确恢复原文', state: 'present', evidence: 'lib/events.js restoreEvents' },
    ],
    fitScore: 96,
    qualityScore: 90,
    maintenanceScore: 85,
    riskScore: 3,
    addedAt: at(450),
  },
  candidates: [
    {
      name: 'dsh-context-keeper',
      version: '0.1.0',
      spec: 'dsh-context-keeper',
      source: 'npm',
      repository: 'https://github.com/YansongG-HKU/dsh-context-keeper',
      license: 'MIT',
      fitScore: 96,
      qualityScore: 90,
      maintenanceScore: 85,
      riskScore: 3,
      addedAt: at(450),
    },
  ],
  audit: {
    score: 97,
    verdict: 'safe',
    evidenceLevel: 'static',
    scope: 'source',
    target: 'npm:dsh-context-keeper@0.1.0',
    findings: [
      { id: 'npm-first-release', severity: 'low', kind: 'maturity', title: '只有一个发布版本', detail: '缺少迭代证据' },
      { id: 'npm-single-maintainer', severity: 'info', kind: 'provenance', title: '单一维护者', detail: 'YansongG-HKU' },
    ],
    permissions: {
      installScripts: false,
      network: ['github.com'],
      childProcess: false,
      eval: false,
      filesystemWrite: false,
      credentials: false,
      obfuscated: false,
      nativeAddons: false,
      patchesShippedRows: false,
      sparseSource: false,
    },
    stats: { files: 12, bytes: 96_400, dependencies: 0, scannedAt: at(430) },
    digest: '9f2c4a1b77d0e5c6b8a9f0e1d2c3b4a5968778695a4b3c2d1e0f9a8b7c6d5e4f',
    digestFiles: 12,
    community: { downloadsLastMonth: 210, githubStars: 12, githubOpenIssues: 1, githubArchived: false },
  },
  blood: { score: 100, label: 'full', summary: '能力覆盖完整，未发现阉割或残缺。', gaps: [] },
  decision: {
    kind: 'install',
    rationale: '满血且安全：三项能力全部命中，审计 97/100，无安装脚本与网络出口。',
    at: at(400),
    plan: null,
  },
  execution: { kind: 'install', startedAt: at(360), bundlePath: null, sessionId: 'session-demo-b', steps: [] },
  verification: {
    passed: true,
    gate: 'L2',
    at: at(320),
    checks: [
      { level: 'L0', name: 'spec 预检', status: 'pass', detail: 'registry · dsh-context-keeper@0.1.0', at: at(350) },
      { level: 'L1', name: '自带测试', status: 'pass', detail: 'node --test：7 个文件全过', at: at(340) },
      { level: 'L2', name: 'profile 加载确认', status: 'pass', detail: 'dsh-context-keeper@0.1.0 已安装并启用，1 个插件行在位', at: at(320) },
    ],
  },
  install: {
    spec: 'dsh-context-keeper',
    at: at(320),
    application: 'applied',
    version: '0.1.0',
    bundle: 'dsh-context-keeper',
    warnings: [],
    evidenceHash: '9f2c4a1b77d0',
    rollback: { kind: 'remove-bundle', name: 'dsh-context-keeper' },
  },
  approval: { via: 'panel', at: at(330) },
  links: { sessionIds: ['session-demo-b'] },
  notes: [{ at: at(300), text: '安装后上下文占用下降约 38%，检索恢复验证通过。', actor: 'agent' }],
  history: [
    { at: at(480), kind: 'intake', detail: '立案（standard）' },
    { at: at(450), kind: 'candidates', detail: '候选 1 个（选中 dsh-context-keeper）' },
    { at: at(430), kind: 'audit', detail: 'static 审计 97/100 safe' },
    { at: at(410), kind: 'blood', detail: '血量 100/100 full' },
    { at: at(400), kind: 'decision', detail: '决策 install' },
    { at: at(330), kind: 'approval', detail: '用户在面板确认安装' },
    { at: at(320), kind: 'install', detail: 'dsh-context-keeper → applied（L2 通过）' },
  ],
}

const history = [
  {
    recordId: recordB.id,
    title: recordB.intent.title,
    at: at(320),
    spec: 'dsh-context-keeper',
    application: 'applied',
    version: '0.1.0',
    bundle: 'dsh-context-keeper',
    rollbackName: 'dsh-context-keeper',
  },
]

const dir = join(target, 'plugin-smith')
await mkdir(dir, { recursive: true })
await writeFile(join(dir, 'records.json'), `${JSON.stringify({ version: 1, records: [recordA, recordB] }, null, 2)}\n`, 'utf8')
await writeFile(join(dir, 'history.json'), `${JSON.stringify({ version: 1, entries: history }, null, 2)}\n`, 'utf8')
console.log(`seeded ${dir}`)
