/**
 * dsh-plugin-keeper — Client (browser) half.
 *
 * Hand-written browser plugin artifact: no build tooling, no npm imports, no JSX.
 * It only registers a lazy factory; nothing runs until the module is materialized.
 * Inside the factory it depends on the browser module table for React and
 * contributes two slots through the Host's `slots` service:
 *
 *   - `sidebar.panellist` (id `dsh-plugin-keeper`, order 30): the keeper glyph.
 *   - `main` (key `dsh-plugin-keeper`): the keeper panel, selected by the sidebar
 *     entry through the same id.
 *
 * Panel data comes from the co-located Host routes under `/plugin-keeper/api/*`
 * (docs/PANEL-API.md). Every request carries the `x-plugin-keeper: 1` header,
 * which marks it as coming from this plugin's own page code.
 */
window.__ModuleLoader__.load({
  id: 'dsh-plugin-keeper',
  factory(require) {
    const React = require('react')
    const h = React.createElement

    /** Locale namespace owned by this Client half. */
    const NS = 'dshPluginKeeper'
    /** Sidebar entry id; it also addresses the `main` panel key. */
    const PANEL_ID = 'dsh-plugin-keeper'
    /** Host routes registered by the Host half. */
    const API_STATE = '/plugin-keeper/api/state'
    const API_RECORD = '/plugin-keeper/api/record'
    const API_ACTION = '/plugin-keeper/api/action'
    /** Request header that gates the Host routes. */
    const HEADER_NAME = 'x-plugin-keeper'
    /** Auto-refresh cadence for the panel while it is mounted and visible. */
    const REFRESH_MS = 3000
    /** Accent pair for the keeper identity (shared with the package icon). */
    const ACCENT = '#e08a2e'
    const ACCENT_BRIGHT = '#f7b955'

    /**
     * Client locale dictionaries. Chinese is the primary language; every visible
     * string in this file comes from here. Placeholders use `{name}`.
     */
    const DICTIONARIES = {
      zh: {
        panel: '插件管家',
        pluginsTab: '管家',
        title: '插件管家',
        subtitle: '一句需求 → 侦察候选 → 审计与血量 → 补缺口 → 验收 → 安装台账',
        refresh: '刷新',
        refreshing: '刷新中…',
        autoRefresh: '每 3 秒自动刷新',
        updated: '更新于 {time}',
        createdAt: '创建于 {time}',
        statTotal: '总记录',
        statWorking: '进行中',
        statWaiting: '待你拍板',
        statInstalled: '已安装',
        intakeTitle: '提个需求',
        intakePlaceholder: '想要一个什么样的插件？例如：按项目预算自动折叠旧上下文，并保留可恢复的原文。',
        intakeHint: 'Ctrl / ⌘ + Enter 提交 · Enter 换行',
        depthLabel: '侦察深度',
        depthQuick: '快筛',
        depthStandard: '标准',
        depthDeep: '深挖',
        intakeSubmit: '交给管家',
        intakeSubmitting: '建档中…',
        intakeCreated: '已建档，管家开始侦察',
        intakeEmpty: '先写一句需求',
        tabAll: '全部',
        tabWorking: '进行中',
        tabWaiting: '待你拍板',
        tabInstalled: '已安装',
        tabBlocked: '已拦截',
        tabArchived: '已归档',
        tabsLabel: '记录筛选',
        loading: '正在读取…',
        errorLoad: '读取失败：{message}',
        retry: '重试',
        unknown: '—',
        listEmptyTitle: '管家还没接到活',
        listEmptyHint: '在上面写下一条插件需求：候选、审计、血量和缺口都会留档，装完还会生成回滚凭据。',
        listEmptyFilteredTitle: '这个筛选下没有记录',
        listEmptyFilteredHint: '切回「全部」再看看。',
        candidatesCount: '候选 {count}',
        auditScoreLabel: '审计 {score}',
        relativeJustNow: '刚刚',
        relativeMinutes: '{count} 分钟前',
        relativeHours: '{count} 小时前',
        relativeDays: '{count} 天前',
        statusIntake: '待侦察',
        statusScouting: '侦察中',
        statusAuditing: '审计中',
        statusDecision: '决策中',
        statusAwaitingApproval: '待你拍板',
        statusExecuting: '执行中',
        statusVerifying: '验收中',
        statusReady: '可安装',
        statusInstalled: '已安装',
        statusBlocked: '已拦截',
        statusRejected: '已拒绝',
        statusArchived: '已归档',
        bloodFull: '满血',
        bloodThin: '残血',
        bloodCut: '阉割',
        bloodUnknown: '未评估',
        detailBack: '返回列表',
        closeDetail: '关闭详情',
        escHint: 'Esc 关闭',
        detailLoading: '正在读取记录…',
        detailError: '记录读取失败：{message}',
        detailMissing: '记录不存在或已被删除',
        sectionIntent: '需求',
        sectionCandidates: '候选',
        sectionAudit: '审计',
        sectionBlood: '血量与缺口',
        sectionDecision: '决策',
        sectionExecution: '执行',
        sectionVerification: '验收',
        sectionInstall: '安装记录',
        sectionNotes: '备注',
        sectionHistory: '历史',
        intentEmpty: '没有需求文本',
        intentDepth: '侦察深度',
        intentCapabilities: '能力',
        intentConstraints: '约束',
        intentNone: '未标注',
        revisionBadge: 'rev {rev}',
        revisionCount: '已增补 {count} 次',
        revisionListTitle: '需求修订',
        revisionExpand: '展开全文',
        revisionCollapse: '收起',
        sourceUser: '你',
        sourceAgent: '模型',
        amendTitle: '补充需求',
        amendPlaceholder: '补充或修改需求，例如：另外要支持离线模式。',
        amendSubmit: '增补',
        amendSubmitting: '增补中…',
        amendSuccess: '已增补，旧决策与缺口分析将失效',
        amendFailed: '增补失败：{message}',
        amendEmpty: '先写要补充的需求',
        candCompare: '候选对比',
        candName: '名称',
        candSource: '来源',
        candVersion: '版本',
        candFit: '契合',
        candQuality: '质量',
        candMaintenance: '维护',
        candRisk: '风险',
        candSelected: '已选',
        candEmpty: '还没有候选',
        candLicense: '许可',
        sourceMarket: '市场',
        sourceNpm: 'npm',
        sourceGithub: 'GitHub',
        sourceLocal: '本地',
        sourceManual: '手动',
        auditEmpty: '还没有审计结果',
        auditScore: '审计分',
        auditVerdict: '结论',
        auditEvidence: '证据级别',
        auditScope: '审计范围',
        auditScopeSource: '源码级',
        auditScopeMetadata: '元数据级',
        auditScopeHint: '未能取得发布包源码，证据较弱',
        auditSandbox: '隔离试装',
        auditSandboxPassed: '通过',
        auditSandboxMismatch: '摘要不一致',
        auditSandboxCompleted: '已完成',
        auditSandboxIncomplete: '未完成',
        auditSandboxHint: '脚本已禁用 · {files} 个文件 · {ms} ms',
        auditPermissions: '权限面',
        auditFindings: '发现（{count}）',
        auditNoFindings: '未发现风险项',
        auditTarget: '审计目标',
        auditStats: '{files} 个文件 · {bytes} · {deps} 个依赖',
        scoreOutOf: '/100',
        verdictSafe: '安全',
        verdictCaution: '需留意',
        verdictUnsafe: '不安全',
        verdictUnknown: '未判定',
        evidenceStatic: '静态扫描',
        evidenceSandbox: '沙箱',
        evidenceBehavioral: '行为',
        evidenceNone: '无',
        permInstallScripts: '安装脚本',
        permNetwork: '网络出口',
        permChildProcess: '子进程',
        permEval: '动态求值',
        permFilesystemWrite: '写文件',
        permCredentials: '凭证访问',
        permObfuscated: '混淆代码',
        permNativeAddons: '原生扩展',
        permPatchesShippedRows: '改写宿主',
        permSparseSource: '源码残缺',
        permYes: '有',
        permNo: '无',
        permNone: '—',
        severityCritical: '严重',
        severityHigh: '高',
        severityMedium: '中',
        severityLow: '低',
        severityInfo: '提示',
        bloodNoData: '还没有血量评估',
        bloodGaps: '缺口（{count}）',
        bloodNoGaps: '没有明显缺口',
        gapRoundLabel: '第 {round} 轮缺口分析',
        gapRecheck: '复查',
        gapRoundShort: '第 {round} 轮',
        regapButton: '复查缺口',
        bloodStaleHint: '需求已变更，本缺口分析已过期',
        gapCapability: '能力',
        gapKind: '类型',
        gapEvidence: '证据',
        gapRemedy: '补法',
        gapEffort: '工作量',
        gapRisk: '风险',
        gapStatePartial: '部分具备',
        gapStateMissing: '缺失',
        kindCut: '阉割',
        kindIncomplete: '不完整',
        kindStale: '陈旧',
        kindIntegration: '集成不足',
        kindUx: '体验缺口',
        kindUnknown: '未知',
        effortS: '小',
        effortM: '中',
        effortL: '大',
        riskLow: '低',
        riskMedium: '中',
        riskHigh: '高',
        decisionEmpty: '还没有决策',
        decisionKind: '决策',
        decisionRationale: '理由',
        decisionSteps: '步骤',
        decisionRisks: '风险',
        decisionAccept: '验收标准',
        decisionUpstream: '上游',
        decisionFork: '是否分叉',
        decisionAttribution: '署名',
        decisionLicenseNote: '许可说明',
        decisionNoPlan: '没有执行计划',
        decisionStaleHint: '需求已变更，旧决策失效：需重新做缺口分析与决策',
        decisionEffort: '工作量',
        decisionInstall: '直接安装',
        decisionCompleteThenInstall: '补齐后安装',
        decisionBuild: '自研重建',
        decisionReject: '拒绝',
        forkYes: '是',
        forkNo: '否',
        executionEmpty: '还没有执行记录',
        executionKind: '方式',
        executionStarted: '开始时间',
        executionBundle: '产物路径',
        executionSteps: '步骤',
        executionOpenSession: '打开会话',
        execInstall: '安装',
        execComplete: '补齐',
        execBuild: '自研',
        verificationEmpty: '还没有验收结果',
        verificationGate: '门槛',
        verificationResult: '结果',
        verificationPassed: '通过',
        verificationFailed: '未通过',
        verificationAt: '时间',
        checkName: '检查',
        checkStatus: '状态',
        checkDetail: '说明',
        checkPass: '通过',
        checkFail: '失败',
        checkSkip: '跳过',
        installEmpty: '还没有安装记录',
        installSpec: '安装包',
        installApplication: '落地结果',
        installVersion: '版本',
        installBundle: '包路径',
        installWarnings: '警告',
        installAt: '时间',
        installRollback: '回滚',
        rollbackAvailable: '可用：{name}',
        rollbackNone: '不可回滚',
        appApplied: '已生效',
        appRestartRequired: '需重启',
        appOverridden: '被覆盖',
        appFailed: '失败',
        appCancelled: '已取消',
        notesEmpty: '还没有备注',
        notePlaceholder: '写一条备注，例如：候选的维护度不够，看看有没有更活跃的分支。',
        noteAdd: '添加备注',
        noteAdding: '添加中…',
        noteActorUser: '你',
        noteActorAgent: 'Agent',
        noteActorHost: '宿主',
        noteEmptyError: '备注不能为空',
        historyEmpty: '还没有历史',
        actWork: '开始处理',
        actReview: '去复核',
        actInstall: '安装',
        actComplete: '补齐缺口',
        actBuild: '自研重建',
        actRollback: '回滚',
        actArchive: '归档',
        actReopen: '重新打开',
        actReject: '拒绝',
        actNone: '现在不需要操作',
        actionPending: '处理中…',
        actionsLabel: '操作',
        actionFailed: '操作失败：{message}',
        actionInstalled: '已安装：{application}',
        actionWarnings: '警告 {count} 条',
        actionDone: '已完成',
        sessionStarted: '已打开工作会话',
        sessionDraftHint: '简报已放进输入框草稿，尚未发送；确认内容后按发送开始。',
        sessionLaunchFailed: '会话启动失败：{message}',
        sessionBriefMissing: '没有拿到会话简报',
        sessionOpened: '已打开会话 {id}',
        openSessionUnavailable: '当前界面无法打开会话',
        errorNetwork: '网络请求失败',
        errorHttp: 'HTTP {status}',
        errorUnexpected: '响应格式异常',
        errorUnknown: '未知错误',
        bytesUnitB: 'B',
        bytesUnitKB: 'KB',
        bytesUnitMB: 'MB',
        ledgerTitle: '安装台账',
        ledgerRecord: '记录',
        ledgerApplication: '结果',
        ledgerSpec: '安装包',
        ledgerAt: '时间',
        ledgerRollback: '回滚',
      },
      en: {
        panel: 'Plugin Keeper',
        pluginsTab: 'Keeper',
        title: 'Plugin Keeper',
        subtitle: 'One need → scout candidates → audit and blood score → close gaps → verify → install ledger',
        refresh: 'Refresh',
        refreshing: 'Refreshing…',
        autoRefresh: 'Auto-refreshes every 3 s',
        updated: 'Updated {time}',
        createdAt: 'Created {time}',
        statTotal: 'All records',
        statWorking: 'In progress',
        statWaiting: 'Needs you',
        statInstalled: 'Installed',
        intakeTitle: 'File a need',
        intakePlaceholder: 'What plugin do you want? For example: fold old context by project budget while keeping the original recoverable.',
        intakeHint: 'Ctrl / ⌘ + Enter to submit · Enter for a newline',
        depthLabel: 'Scout depth',
        depthQuick: 'Quick',
        depthStandard: 'Standard',
        depthDeep: 'Deep',
        intakeSubmit: 'Hand it over',
        intakeSubmitting: 'Filing…',
        intakeCreated: 'Filed — the keeper is scouting now',
        intakeEmpty: 'Write a need first',
        tabAll: 'All',
        tabWorking: 'In progress',
        tabWaiting: 'Needs you',
        tabInstalled: 'Installed',
        tabBlocked: 'Blocked',
        tabArchived: 'Archived',
        tabsLabel: 'Record filters',
        loading: 'Loading…',
        errorLoad: 'Failed to load: {message}',
        retry: 'Retry',
        unknown: '—',
        listEmptyTitle: 'The keeper has no jobs yet',
        listEmptyHint: 'Write a plugin need above: candidates, audit, blood, gaps, and the install rollback receipt all get filed here.',
        listEmptyFilteredTitle: 'Nothing under this filter',
        listEmptyFilteredHint: 'Switch back to All.',
        candidatesCount: 'Candidates {count}',
        auditScoreLabel: 'Audit {score}',
        relativeJustNow: 'just now',
        relativeMinutes: '{count} min ago',
        relativeHours: '{count} h ago',
        relativeDays: '{count} d ago',
        statusIntake: 'Intake',
        statusScouting: 'Scouting',
        statusAuditing: 'Auditing',
        statusDecision: 'Deciding',
        statusAwaitingApproval: 'Needs you',
        statusExecuting: 'Executing',
        statusVerifying: 'Verifying',
        statusReady: 'Ready',
        statusInstalled: 'Installed',
        statusBlocked: 'Blocked',
        statusRejected: 'Rejected',
        statusArchived: 'Archived',
        bloodFull: 'Full-blood',
        bloodThin: 'Thin-blood',
        bloodCut: 'Cut-down',
        bloodUnknown: 'Untested',
        detailBack: 'Back to list',
        closeDetail: 'Close detail',
        escHint: 'Esc to close',
        detailLoading: 'Loading record…',
        detailError: 'Failed to load the record: {message}',
        detailMissing: 'This record no longer exists',
        sectionIntent: 'Need',
        sectionCandidates: 'Candidates',
        sectionAudit: 'Audit',
        sectionBlood: 'Blood & gaps',
        sectionDecision: 'Decision',
        sectionExecution: 'Execution',
        sectionVerification: 'Verification',
        sectionInstall: 'Install record',
        sectionNotes: 'Notes',
        sectionHistory: 'History',
        intentEmpty: 'No need text recorded',
        intentDepth: 'Scout depth',
        intentCapabilities: 'Capabilities',
        intentConstraints: 'Constraints',
        intentNone: 'Not specified',
        revisionBadge: 'rev {rev}',
        revisionCount: 'Amended {count}×',
        revisionListTitle: 'Requirement revisions',
        revisionExpand: 'Show full text',
        revisionCollapse: 'Collapse',
        sourceUser: 'You',
        sourceAgent: 'Model',
        amendTitle: 'Add requirement',
        amendPlaceholder: 'Add or revise the requirement, e.g. it must also work offline.',
        amendSubmit: 'Amend',
        amendSubmitting: 'Amending…',
        amendSuccess: 'Amended; the old decision and gap analysis are now stale',
        amendFailed: 'Amend failed: {message}',
        amendEmpty: 'Write what to add first',
        candCompare: 'Candidate comparison',
        candName: 'Name',
        candSource: 'Source',
        candVersion: 'Version',
        candFit: 'Fit',
        candQuality: 'Quality',
        candMaintenance: 'Maintenance',
        candRisk: 'Risk',
        candSelected: 'Selected',
        candEmpty: 'No candidates yet',
        candLicense: 'License',
        sourceMarket: 'Market',
        sourceNpm: 'npm',
        sourceGithub: 'GitHub',
        sourceLocal: 'Local',
        sourceManual: 'Manual',
        auditEmpty: 'No audit yet',
        auditScore: 'Audit score',
        auditVerdict: 'Verdict',
        auditEvidence: 'Evidence level',
        auditScope: 'Audit scope',
        auditScopeSource: 'Source level',
        auditScopeMetadata: 'Metadata only',
        auditScopeHint: 'Published source could not be fetched; weaker evidence',
        auditSandbox: 'Trial install',
        auditSandboxPassed: 'Passed',
        auditSandboxMismatch: 'Digest mismatch',
        auditSandboxCompleted: 'Completed',
        auditSandboxIncomplete: 'Incomplete',
        auditSandboxHint: 'scripts disabled · {files} files · {ms} ms',
        auditPermissions: 'Permissions',
        auditFindings: 'Findings ({count})',
        auditNoFindings: 'No risky findings',
        auditTarget: 'Audit target',
        auditStats: '{files} files · {bytes} · {deps} dependencies',
        scoreOutOf: '/100',
        verdictSafe: 'Safe',
        verdictCaution: 'Caution',
        verdictUnsafe: 'Unsafe',
        verdictUnknown: 'Undetermined',
        evidenceStatic: 'Static',
        evidenceSandbox: 'Sandbox',
        evidenceBehavioral: 'Behavioral',
        evidenceNone: 'None',
        permInstallScripts: 'Install scripts',
        permNetwork: 'Network',
        permChildProcess: 'Child process',
        permEval: 'Eval',
        permFilesystemWrite: 'Filesystem write',
        permCredentials: 'Credentials',
        permObfuscated: 'Obfuscated code',
        permNativeAddons: 'Native addons',
        permPatchesShippedRows: 'Patches host file',
        permSparseSource: 'Sparse source',
        permYes: 'yes',
        permNo: 'no',
        permNone: '—',
        severityCritical: 'Critical',
        severityHigh: 'High',
        severityMedium: 'Medium',
        severityLow: 'Low',
        severityInfo: 'Info',
        bloodNoData: 'No blood assessment yet',
        bloodGaps: 'Gaps ({count})',
        bloodNoGaps: 'No obvious gaps',
        gapRoundLabel: 'Gap analysis · round {round}',
        gapRecheck: 're-check',
        gapRoundShort: 'round {round}',
        regapButton: 'Re-check gaps',
        bloodStaleHint: 'The requirement changed; this gap analysis is stale',
        gapCapability: 'Capability',
        gapKind: 'Kind',
        gapEvidence: 'Evidence',
        gapRemedy: 'Remedy',
        gapEffort: 'Effort',
        gapRisk: 'Risk',
        gapStatePartial: 'Partial',
        gapStateMissing: 'Missing',
        kindCut: 'Cut',
        kindIncomplete: 'Incomplete',
        kindStale: 'Stale',
        kindIntegration: 'Integration',
        kindUx: 'UX',
        kindUnknown: 'Unknown',
        effortS: 'S',
        effortM: 'M',
        effortL: 'L',
        riskLow: 'low',
        riskMedium: 'medium',
        riskHigh: 'high',
        decisionEmpty: 'No decision yet',
        decisionKind: 'Decision',
        decisionRationale: 'Rationale',
        decisionSteps: 'Steps',
        decisionRisks: 'Risks',
        decisionAccept: 'Acceptance criteria',
        decisionUpstream: 'Upstream',
        decisionFork: 'Fork',
        decisionAttribution: 'Attribution',
        decisionLicenseNote: 'License note',
        decisionNoPlan: 'No execution plan',
        decisionStaleHint: 'The requirement changed; the old decision is invalid — redo gap analysis and decision',
        decisionEffort: 'Effort',
        decisionInstall: 'Install as is',
        decisionCompleteThenInstall: 'Complete then install',
        decisionBuild: 'Build from scratch',
        decisionReject: 'Reject',
        forkYes: 'yes',
        forkNo: 'no',
        executionEmpty: 'Nothing executed yet',
        executionKind: 'Mode',
        executionStarted: 'Started',
        executionBundle: 'Bundle path',
        executionSteps: 'Steps',
        executionOpenSession: 'Open session',
        execInstall: 'Install',
        execComplete: 'Complete',
        execBuild: 'Build',
        verificationEmpty: 'No verification yet',
        verificationGate: 'Gate',
        verificationResult: 'Result',
        verificationPassed: 'Passed',
        verificationFailed: 'Failed',
        verificationAt: 'At',
        checkName: 'Check',
        checkStatus: 'Status',
        checkDetail: 'Detail',
        checkPass: 'pass',
        checkFail: 'fail',
        checkSkip: 'skip',
        installEmpty: 'No install record',
        installSpec: 'Spec',
        installApplication: 'Application',
        installVersion: 'Version',
        installBundle: 'Bundle',
        installWarnings: 'Warnings',
        installAt: 'At',
        installRollback: 'Rollback',
        rollbackAvailable: 'Available: {name}',
        rollbackNone: 'Not rollback-able',
        appApplied: 'applied',
        appRestartRequired: 'restart required',
        appOverridden: 'overridden',
        appFailed: 'failed',
        appCancelled: 'cancelled',
        notesEmpty: 'No notes yet',
        notePlaceholder: 'Write a note, e.g. the candidate is under-maintained — look for a more active fork.',
        noteAdd: 'Add note',
        noteAdding: 'Adding…',
        noteActorUser: 'You',
        noteActorAgent: 'Agent',
        noteActorHost: 'Host',
        noteEmptyError: 'A note cannot be empty',
        historyEmpty: 'No history yet',
        actWork: 'Start working',
        actReview: 'Review',
        actInstall: 'Install',
        actComplete: 'Close the gaps',
        actBuild: 'Build it',
        actRollback: 'Roll back',
        actArchive: 'Archive',
        actReopen: 'Reopen',
        actReject: 'Reject',
        actNone: 'Nothing to do right now',
        actionPending: 'Working…',
        actionsLabel: 'Actions',
        actionFailed: 'Action failed: {message}',
        actionInstalled: 'Installed: {application}',
        actionWarnings: 'Warnings: {count}',
        actionDone: 'Done',
        sessionStarted: 'Working session opened',
        sessionDraftHint: 'The brief is in the composer as an unsent draft; review it, then send to start.',
        sessionLaunchFailed: 'Session launch failed: {message}',
        sessionBriefMissing: 'No session brief was returned',
        sessionOpened: 'Opened session {id}',
        openSessionUnavailable: 'This surface cannot open a session',
        errorNetwork: 'Network request failed',
        errorHttp: 'HTTP {status}',
        errorUnexpected: 'Unexpected response',
        errorUnknown: 'Unknown error',
        bytesUnitB: 'B',
        bytesUnitKB: 'KB',
        bytesUnitMB: 'MB',
        ledgerTitle: 'Install ledger',
        ledgerRecord: 'Record',
        ledgerApplication: 'Result',
        ledgerSpec: 'Spec',
        ledgerAt: 'At',
        ledgerRollback: 'Rollback',
      },
    }

    /**
     * Component-local styles. Rendered as a React `<style>` element inside the
     * panel so unmounting removes them. Only host theme tokens (`--dsw-alias-*`)
     * are used for surfaces and text, with neutral fallbacks; amber is the keeper
     * identity accent and status colors follow the frozen contract.
     */
    const STYLES = `
.ps-page {
  box-sizing: border-box;
  height: 100%;
  overflow-y: auto;
  scrollbar-gutter: stable;
  padding: 24px clamp(18px, 3.2vw, 42px) 40px;
  background: var(--dsw-alias-bg-base, transparent);
  color: var(--dsw-alias-label-primary, #1f2328);
  font-size: 13px;
  line-height: 20px;
  --ps-accent: #e08a2e;
  --ps-accent-bright: #f7b955;
  --ps-accent-ink: #241708;
  --ps-ink: var(--dsw-alias-label-primary, #1f2328);
  --ps-ink-2: var(--dsw-alias-label-secondary, #4b5563);
  --ps-ink-3: var(--dsw-alias-label-tertiary, #6b7280);
  --ps-ink-4: var(--dsw-alias-label-caption, #8b949e);
  --ps-surface: var(--dsw-alias-bg-layer-1, rgba(127, 127, 127, 0.06));
  --ps-surface-2: var(--dsw-alias-bg-layer-2, rgba(127, 127, 127, 0.1));
  --ps-line-1: var(--dsw-alias-border-l1, rgba(127, 127, 127, 0.18));
  --ps-line-2: var(--dsw-alias-border-l2, rgba(127, 127, 127, 0.28));
  --ps-line-3: var(--dsw-alias-border-l3, rgba(127, 127, 127, 0.42));
  --ps-hover: var(--dsw-alias-interactive-bg-hover, rgba(127, 127, 127, 0.1));
  --ps-mono: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
  --ps-blue: #3b82f6;
  --ps-green: var(--dsw-alias-state-success-primary, #2ea043);
  --ps-red: var(--dsw-alias-state-error-primary, #d92d20);
  --ps-amber: #e08a2e;
  --ps-gray: var(--dsw-alias-label-caption, #8b949e);
}
.ps-shell { max-width: 1040px; margin: 0 auto; display: flex; flex-direction: column; gap: 16px; }
.ps-head { display: flex; align-items: flex-start; justify-content: space-between; gap: 14px 20px; flex-wrap: wrap; }
.ps-head-main { display: flex; flex-direction: column; gap: 4px; min-width: 0; }
.ps-head-title-row { display: flex; align-items: center; gap: 9px; }
.ps-head-glyph { display: inline-flex; color: var(--ps-accent); flex: none; }
.ps-title { margin: 0; font-size: 17px; line-height: 24px; font-weight: 600; letter-spacing: 0.01em; color: var(--ps-ink); }
.ps-subtitle { margin: 0; font-size: 12px; line-height: 18px; color: var(--ps-ink-3); }
.ps-toolbar { display: flex; align-items: center; gap: 10px; flex-wrap: wrap; justify-content: flex-end; }
.ps-updated { font-size: 11.5px; line-height: 16px; color: var(--ps-ink-4); font-variant-numeric: tabular-nums; }
.ps-auto { font-size: 11px; line-height: 16px; color: var(--ps-ink-4); }
.ps-head-accent { height: 2px; border-radius: 1px; margin-top: -4px; background: linear-gradient(90deg, var(--ps-accent) 0%, rgba(224, 138, 46, 0.35) 38%, rgba(224, 138, 46, 0) 100%); }
.ps-stats { display: grid; grid-template-columns: repeat(4, minmax(0, 1fr)); gap: 10px; }
.ps-stat { display: flex; flex-direction: column; gap: 2px; padding: 10px 12px; border: 0.5px solid var(--ps-line-2); border-radius: 10px; background: var(--ps-surface); min-width: 0; }
.ps-stat-label { font-size: 11px; line-height: 16px; letter-spacing: 0.05em; color: var(--ps-ink-3); }
.ps-stat-value { font-size: 20px; line-height: 26px; font-weight: 600; color: var(--ps-ink); font-variant-numeric: tabular-nums; }
.ps-btn { font: inherit; font-size: 12px; line-height: 18px; padding: 5px 12px; border-radius: 8px; border: 0.5px solid var(--ps-line-3); background: var(--ps-surface); color: var(--ps-ink-2); cursor: pointer; white-space: nowrap; transition: background 0.12s ease, color 0.12s ease, border-color 0.12s ease; }
.ps-btn:hover:not(:disabled) { background: var(--ps-hover); color: var(--ps-ink); }
.ps-btn:focus-visible { outline: 2px solid var(--ps-accent); outline-offset: 2px; }
.ps-btn:disabled { opacity: 0.5; cursor: default; }
.ps-btn-primary { background: var(--ps-accent); border-color: var(--ps-accent); color: var(--ps-accent-ink); font-weight: 600; }
.ps-btn-primary:hover:not(:disabled) { background: var(--ps-accent-bright); border-color: var(--ps-accent-bright); color: var(--ps-accent-ink); }
.ps-btn-danger { color: var(--ps-red); border-color: rgba(217, 45, 32, 0.45); }
.ps-btn-danger:hover:not(:disabled) { background: rgba(217, 45, 32, 0.1); color: var(--ps-red); }
.ps-btn-sm { font-size: 11.5px; line-height: 16px; padding: 3px 10px; }
.ps-intake { display: flex; flex-direction: column; gap: 10px; padding: 14px; border: 0.5px solid var(--ps-line-2); border-radius: 12px; background: var(--ps-surface); }
.ps-intake-head { display: flex; align-items: center; justify-content: space-between; gap: 10px; flex-wrap: wrap; }
.ps-intake-title { margin: 0; font-size: 12.5px; line-height: 18px; font-weight: 600; color: var(--ps-ink-2); }
.ps-seg { display: inline-flex; border: 0.5px solid var(--ps-line-2); border-radius: 8px; overflow: hidden; background: var(--ps-surface-2); }
.ps-seg-btn { font: inherit; font-size: 11.5px; line-height: 16px; padding: 4px 10px; border: 0; background: transparent; color: var(--ps-ink-3); cursor: pointer; }
.ps-seg-btn + .ps-seg-btn { border-left: 0.5px solid var(--ps-line-2); }
.ps-seg-btn:hover:not(:disabled) { color: var(--ps-ink); }
.ps-seg-btn:focus-visible { outline: 2px solid var(--ps-accent); outline-offset: -2px; }
.ps-seg-btn-on { background: var(--ps-surface); color: var(--ps-ink); font-weight: 600; box-shadow: inset 0 -2px 0 var(--ps-accent); }
.ps-seg-btn:disabled { opacity: 0.5; cursor: default; }
.ps-textarea { box-sizing: border-box; width: 100%; min-height: 74px; resize: vertical; font: inherit; font-size: 13px; line-height: 20px; padding: 9px 11px; border-radius: 9px; border: 0.5px solid var(--ps-line-2); background: var(--dsw-alias-bg-layer-2, var(--ps-surface)); color: var(--ps-ink); }
.ps-textarea::placeholder { color: var(--ps-ink-4); }
.ps-textarea:focus-visible { outline: 2px solid var(--ps-accent); outline-offset: 1px; border-color: var(--ps-accent); }
.ps-textarea-sm { min-height: 52px; }
.ps-intake-foot { display: flex; align-items: center; justify-content: space-between; gap: 10px; flex-wrap: wrap; }
.ps-hint { font-size: 11.5px; line-height: 16px; color: var(--ps-ink-4); }
.ps-form-error { margin: 0; font-size: 12px; line-height: 18px; color: var(--ps-red); }
.ps-form-notice { margin: 0; font-size: 12px; line-height: 18px; color: var(--ps-ink-3); }
.ps-tabs { display: flex; align-items: center; gap: 2px; border-bottom: 0.5px solid var(--ps-line-2); overflow-x: auto; scrollbar-width: none; }
.ps-tab { position: relative; display: inline-flex; align-items: center; gap: 6px; padding: 7px 10px; border: 0; background: transparent; color: var(--ps-ink-3); font: inherit; font-size: 12.5px; line-height: 18px; white-space: nowrap; cursor: pointer; border-radius: 6px 6px 0 0; }
.ps-tab:hover { color: var(--ps-ink); background: var(--ps-hover); }
.ps-tab:focus-visible { outline: 2px solid var(--ps-accent); outline-offset: -2px; }
.ps-tab-on { color: var(--ps-ink); font-weight: 600; }
.ps-tab-on::after { content: ''; position: absolute; left: 8px; right: 8px; bottom: -0.5px; height: 2px; border-radius: 1px; background: var(--ps-accent); }
.ps-tab-count { font-family: var(--ps-mono); font-size: 10.5px; line-height: 14px; color: var(--ps-ink-4); font-variant-numeric: tabular-nums; }
.ps-tab-on .ps-tab-count { color: var(--ps-accent); }
.ps-feedback { display: flex; align-items: center; justify-content: space-between; gap: 10px; margin: 0; padding: 8px 11px; border-radius: 9px; border: 0.5px solid var(--ps-line-2); background: var(--ps-surface); font-size: 12px; line-height: 18px; color: var(--ps-ink-2); }
.ps-feedback-error { border-color: rgba(217, 45, 32, 0.4); color: var(--ps-red); }
.ps-feedback-text { min-width: 0; overflow-wrap: anywhere; }
.ps-list-section { display: flex; flex-direction: column; gap: 12px; }
.ps-list { display: flex; flex-direction: column; border-top: 0.5px solid var(--ps-line-1); }
.ps-record { display: grid; grid-template-columns: minmax(0, 1fr) auto; align-items: center; gap: 10px; border-bottom: 0.5px solid var(--ps-line-1); padding: 2px 0; }
.ps-record-main { display: flex; flex-direction: column; gap: 4px; min-width: 0; text-align: left; background: transparent; border: 0; padding: 11px 12px 11px 13px; color: inherit; font: inherit; cursor: pointer; box-shadow: inset 2px 0 0 var(--ps-tone, transparent); border-radius: 6px; }
.ps-record-main:hover { background: var(--ps-hover); }
.ps-record-main:focus-visible { outline: 2px solid var(--ps-accent); outline-offset: -2px; }
.ps-record-top { display: flex; align-items: center; gap: 8px; min-width: 0; }
.ps-record-title { font-size: 13.5px; line-height: 20px; font-weight: 600; color: var(--ps-ink); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; min-width: 0; }
.ps-record-intent { margin: 0; font-size: 12px; line-height: 18px; color: var(--ps-ink-3); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.ps-record-meta { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; margin-top: 1px; }
.ps-record-time { font-size: 10.5px; line-height: 14px; color: var(--ps-ink-4); }
.ps-record-id { font-size: 10.5px; line-height: 14px; color: var(--ps-ink-4); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; max-width: 190px; }
.ps-record-side { display: flex; align-items: center; justify-content: flex-end; padding-right: 4px; }
.ps-chip { display: inline-flex; align-items: center; gap: 5px; padding: 1px 8px; border-radius: 999px; border: 0.5px solid var(--ps-line-2); background: transparent; color: var(--ps-ink-2); font-size: 11px; line-height: 17px; white-space: nowrap; max-width: 100%; }
.ps-chip-mono { font-family: var(--ps-mono); font-variant-numeric: tabular-nums; }
.ps-chip-score { color: var(--ps-ink-3); font-family: var(--ps-mono); font-size: 10.5px; }
.ps-dot { width: 6px; height: 6px; border-radius: 50%; background: var(--ps-tone, var(--ps-ink-4)); flex: none; }
.ps-badge .ps-dot { width: 5px; height: 5px; }
.ps-tone-info { --ps-tone: var(--ps-blue); }
.ps-tone-waiting { --ps-tone: var(--ps-amber); }
.ps-tone-installed { --ps-tone: var(--ps-green); }
.ps-tone-blocked { --ps-tone: var(--ps-red); }
.ps-tone-archived { --ps-tone: var(--ps-gray); }
.ps-tone-muted { --ps-tone: var(--ps-ink-4); }
.ps-state { display: flex; align-items: center; justify-content: center; min-height: 180px; font-size: 12.5px; color: var(--ps-ink-3); border-top: 0.5px solid var(--ps-line-1); }
.ps-empty { display: flex; flex-direction: column; align-items: center; gap: 8px; padding: 44px 20px; border: 0.5px dashed var(--ps-line-2); border-radius: 12px; text-align: center; }
.ps-empty-glyph { color: var(--ps-accent); opacity: 0.9; }
.ps-empty-title { margin: 0; font-size: 14px; line-height: 20px; font-weight: 600; color: var(--ps-ink-2); }
.ps-empty-hint { margin: 0; max-width: 440px; font-size: 12px; line-height: 18px; color: var(--ps-ink-3); }
.ps-detail-wrap { outline: none; }
.ps-detail { display: flex; flex-direction: column; gap: 14px; outline: none; }
.ps-detail-head { display: flex; flex-direction: column; gap: 8px; }
.ps-back { align-self: flex-start; display: inline-flex; align-items: center; gap: 6px; background: transparent; border: 0; padding: 2px 0; color: var(--ps-ink-3); font: inherit; font-size: 12px; cursor: pointer; border-radius: 4px; }
.ps-back:hover { color: var(--ps-ink); }
.ps-back:focus-visible { outline: 2px solid var(--ps-accent); outline-offset: 2px; }
.ps-detail-title { margin: 0; font-size: 16px; line-height: 23px; font-weight: 600; color: var(--ps-ink); overflow-wrap: anywhere; }
.ps-detail-meta { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; }
.ps-mono { font-family: var(--ps-mono); font-variant-numeric: tabular-nums; font-size: 11px; line-height: 16px; color: var(--ps-ink-4); }
.ps-esc { margin-left: auto; font-size: 10.5px; line-height: 14px; color: var(--ps-ink-4); font-family: var(--ps-mono); }
.ps-status-reason { margin: 0; font-size: 12px; line-height: 18px; color: var(--ps-ink-3); border-left: 2px solid var(--ps-line-2); padding-left: 9px; }
.ps-section { display: flex; flex-direction: column; gap: 9px; padding-top: 13px; border-top: 0.5px solid var(--ps-line-1); scroll-margin-top: 12px; }
.ps-section-head { display: flex; align-items: baseline; gap: 9px; }
.ps-section-index { font-family: var(--ps-mono); font-size: 10.5px; line-height: 14px; color: var(--ps-accent); letter-spacing: 0.04em; flex: none; }
.ps-section-title { margin: 0; font-size: 11.5px; line-height: 16px; font-weight: 600; letter-spacing: 0.09em; text-transform: uppercase; color: var(--ps-ink-3); }
.ps-section-aside { margin-left: auto; font-size: 11px; line-height: 16px; color: var(--ps-ink-4); }
.ps-section-body { display: flex; flex-direction: column; gap: 10px; min-height: 8px; }
.ps-empty-inline { margin: 0; font-size: 12px; line-height: 18px; color: var(--ps-ink-4); }
.ps-raw { margin: 0; white-space: pre-wrap; overflow-wrap: anywhere; font-size: 12.5px; line-height: 19px; color: var(--ps-ink-2); border-left: 2px solid var(--ps-line-2); padding-left: 10px; }
.ps-field-grid { display: grid; grid-template-columns: 96px minmax(0, 1fr); gap: 7px 12px; align-items: start; }
.ps-field-label { font-size: 11.5px; line-height: 18px; color: var(--ps-ink-4); padding-top: 1px; }
.ps-field-value { font-size: 12px; line-height: 18px; color: var(--ps-ink-2); overflow-wrap: anywhere; min-width: 0; }
.ps-chips { display: flex; flex-wrap: wrap; gap: 6px; }
.ps-subhead { margin: 2px 0 0; font-size: 10.5px; line-height: 15px; letter-spacing: 0.06em; text-transform: uppercase; color: var(--ps-ink-4); }
.ps-audit-top { display: flex; align-items: center; gap: 12px; flex-wrap: wrap; }
.ps-audit-scorewrap { display: inline-flex; align-items: baseline; gap: 2px; }
.ps-score { font-family: var(--ps-mono); font-size: 20px; line-height: 26px; font-weight: 600; color: var(--ps-ink); font-variant-numeric: tabular-nums; }
.ps-score-out { font-family: var(--ps-mono); font-size: 11px; line-height: 16px; color: var(--ps-ink-4); }
.ps-scorebar { flex: 1; min-width: 120px; height: 5px; border-radius: 3px; background: var(--dsw-alias-bg-layer-3, var(--ps-surface-2)); overflow: hidden; }
.ps-scorebar-fill { height: 100%; border-radius: 3px; background: var(--ps-tone, var(--ps-accent)); }
.ps-perm-grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(150px, 1fr)); gap: 6px 12px; }
.ps-perm { display: flex; align-items: center; justify-content: space-between; gap: 8px; padding: 5px 9px; border: 0.5px solid var(--ps-line-1); border-radius: 7px; background: var(--ps-surface); min-width: 0; }
.ps-perm-label { font-size: 11.5px; line-height: 16px; color: var(--ps-ink-3); flex: none; }
.ps-perm-value { font-family: var(--ps-mono); font-size: 11px; line-height: 16px; color: var(--ps-ink-2); display: inline-flex; align-items: center; gap: 5px; min-width: 0; overflow-wrap: anywhere; text-align: right; }
.ps-findings { display: flex; flex-direction: column; gap: 8px; }
.ps-finding { padding: 8px 10px; border: 0.5px solid var(--ps-line-1); border-radius: 8px; background: var(--ps-surface); display: flex; flex-direction: column; gap: 4px; }
.ps-finding-head { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; }
.ps-badge { font-family: var(--ps-mono); font-size: 10px; line-height: 14px; padding: 0 6px; border-radius: 4px; border: 0.5px solid var(--ps-line-2); color: var(--ps-ink-2); display: inline-flex; align-items: center; gap: 4px; }
.ps-finding-title { font-size: 12px; line-height: 17px; font-weight: 600; color: var(--ps-ink); overflow-wrap: anywhere; }
.ps-finding-detail { margin: 0; font-size: 12px; line-height: 18px; color: var(--ps-ink-3); overflow-wrap: anywhere; }
.ps-finding-loc { font-family: var(--ps-mono); font-size: 10.5px; line-height: 15px; color: var(--ps-ink-4); overflow-wrap: anywhere; }
.ps-code { font-family: var(--ps-mono); font-size: 11px; line-height: 16px; color: var(--ps-ink-2); background: var(--ps-surface-2); border-radius: 4px; padding: 0 4px; overflow-wrap: anywhere; }
.ps-table-wrap { overflow: auto; border: 0.5px solid var(--ps-line-1); border-radius: 9px; }
.ps-table { width: 100%; border-collapse: collapse; font-size: 12px; line-height: 17px; }
.ps-table th { text-align: left; padding: 6px 10px; font-size: 10.5px; line-height: 15px; font-weight: 500; letter-spacing: 0.06em; text-transform: uppercase; color: var(--ps-ink-4); background: var(--ps-surface); border-bottom: 0.5px solid var(--ps-line-1); white-space: nowrap; }
.ps-table td { padding: 7px 10px; border-bottom: 0.5px solid var(--ps-line-1); color: var(--ps-ink-2); vertical-align: top; }
.ps-table tr:last-child td { border-bottom: 0; }
.ps-table tbody tr:hover td { background: var(--ps-hover); }
.ps-table .ps-num { text-align: right; }
.ps-row-selected td { background: rgba(224, 138, 46, 0.09); }
.ps-row-selected td:first-child { box-shadow: inset 2px 0 0 var(--ps-accent); }
.ps-cand-name { font-weight: 600; color: var(--ps-ink); }
.ps-cand-sub { font-size: 10.5px; line-height: 15px; color: var(--ps-ink-4); margin-top: 2px; }
.ps-cand-selected { margin-left: 7px; vertical-align: 1px; }
.ps-gaps { display: grid; grid-template-columns: repeat(auto-fit, minmax(240px, 1fr)); gap: 9px; }
.ps-gap { display: flex; flex-direction: column; gap: 5px; padding: 9px 11px; border: 0.5px solid var(--ps-line-1); border-left: 2px solid var(--ps-tone, var(--ps-accent)); border-radius: 8px; background: var(--ps-surface); min-width: 0; }
.ps-gap-head { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; }
.ps-gap-title { font-size: 12px; line-height: 17px; font-weight: 600; color: var(--ps-ink); overflow-wrap: anywhere; }
.ps-gap-meta { display: flex; flex-wrap: wrap; gap: 6px; }
.ps-gap-line { margin: 0; font-size: 11.5px; line-height: 17px; color: var(--ps-ink-3); overflow-wrap: anywhere; }
.ps-gap-label { display: block; font-size: 10.5px; line-height: 15px; letter-spacing: 0.05em; text-transform: uppercase; color: var(--ps-ink-4); margin-bottom: 1px; }
.ps-ordered { display: flex; flex-direction: column; gap: 4px; margin: 0; padding-left: 18px; font-size: 12px; line-height: 18px; color: var(--ps-ink-2); }
.ps-hint-warn { color: var(--ps-amber); }
.ps-revisions { border: 0.5px solid var(--ps-line-1); border-radius: 8px; background: var(--ps-surface); }
.ps-revisions-summary { display: flex; align-items: center; gap: 8px; padding: 6px 10px; cursor: pointer; font-size: 11.5px; line-height: 16px; color: var(--ps-ink-3); list-style: none; }
.ps-revisions-summary::-webkit-details-marker { display: none; }
.ps-revisions-summary:focus-visible { outline: 2px solid var(--ps-accent); outline-offset: 2px; border-radius: 8px; }
.ps-revisions-count { font-family: var(--ps-mono); font-size: 10.5px; line-height: 14px; color: var(--ps-ink-4); }
.ps-revision-list { display: flex; flex-direction: column; gap: 8px; margin: 0; padding: 0 10px 10px; list-style: none; }
.ps-revision { display: flex; flex-direction: column; gap: 3px; padding-top: 8px; border-top: 0.5px solid var(--ps-line-1); }
.ps-revision-head { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; }
.ps-revision-rev { font-size: 10.5px; line-height: 14px; color: var(--ps-accent); }
.ps-revision-meta { font-size: 10.5px; line-height: 14px; color: var(--ps-ink-4); }
.ps-revision-source { font-size: 10.5px; line-height: 15px; color: var(--ps-ink-3); }
.ps-revision-note { font-size: 10.5px; line-height: 15px; color: var(--ps-ink-4); }
.ps-revision-text { margin: 0; font-size: 12px; line-height: 18px; color: var(--ps-ink-2); white-space: pre-wrap; overflow-wrap: anywhere; }
.ps-revision-clamped { display: -webkit-box; -webkit-line-clamp: 3; -webkit-box-orient: vertical; overflow: hidden; }
.ps-revision-toggle { align-self: flex-start; padding: 0; border: 0; background: transparent; color: var(--ps-accent); font: inherit; font-size: 10.5px; line-height: 15px; cursor: pointer; border-radius: 3px; }
.ps-revision-toggle:hover { text-decoration: underline; }
.ps-revision-toggle:focus-visible { outline: 2px solid var(--ps-accent); outline-offset: 2px; }
.ps-amend { display: flex; flex-direction: column; gap: 8px; padding-top: 10px; border-top: 0.5px solid var(--ps-line-1); }
.ps-amend-title { margin: 0; font-size: 11.5px; line-height: 16px; font-weight: 600; letter-spacing: 0.06em; text-transform: uppercase; color: var(--ps-ink-3); }
.ps-risks { display: flex; flex-direction: column; gap: 3px; margin: 0; padding-left: 16px; font-size: 12px; line-height: 18px; color: var(--ps-ink-3); }
.ps-steps { display: flex; flex-direction: column; gap: 5px; margin: 0; padding: 0; list-style: none; }
.ps-step { display: flex; align-items: flex-start; gap: 8px; font-size: 12px; line-height: 18px; color: var(--ps-ink-2); }
.ps-step-dot { width: 6px; height: 6px; border-radius: 1px; flex: none; margin-top: 6px; border: 0.5px solid var(--ps-line-3); background: transparent; }
.ps-step-dot-on { background: var(--ps-green); border-color: var(--ps-green); }
.ps-step-time { font-family: var(--ps-mono); font-size: 10.5px; line-height: 15px; color: var(--ps-ink-4); flex: none; margin-top: 2px; }
.ps-notes { display: flex; flex-direction: column; gap: 8px; }
.ps-note { display: flex; flex-direction: column; gap: 2px; padding: 7px 10px; border-left: 2px solid var(--ps-line-2); background: var(--ps-surface); border-radius: 0 7px 7px 0; }
.ps-note-head { display: flex; align-items: center; gap: 8px; font-size: 10.5px; line-height: 14px; color: var(--ps-ink-4); font-family: var(--ps-mono); }
.ps-note-actor { font-family: inherit; color: var(--ps-ink-3); }
.ps-note-text { margin: 0; font-size: 12px; line-height: 18px; color: var(--ps-ink-2); white-space: pre-wrap; overflow-wrap: anywhere; }
.ps-note-compose { display: flex; flex-direction: column; gap: 8px; }
.ps-timeline { display: flex; flex-direction: column; gap: 7px; margin: 0; padding: 0; list-style: none; }
.ps-timeline-item { display: grid; grid-template-columns: 104px minmax(0, 1fr); gap: 10px; font-size: 12px; line-height: 18px; color: var(--ps-ink-2); }
.ps-timeline-time { font-family: var(--ps-mono); font-size: 10.5px; line-height: 18px; color: var(--ps-ink-4); }
.ps-timeline-kind { font-family: var(--ps-mono); font-size: 10.5px; line-height: 15px; color: var(--ps-accent); margin-right: 6px; }
.ps-actionbar { position: sticky; bottom: 0; z-index: 2; display: flex; flex-direction: column; gap: 8px; padding: 10px 0 8px; margin-top: 4px; border-top: 0.5px solid var(--ps-line-2); background: var(--dsw-alias-bg-base, #f6f7f8); }
.ps-actionbar-row { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; }
.ps-action-hint { font-size: 12px; line-height: 18px; color: var(--ps-ink-4); }
.ps-action-error { margin: 0; font-size: 12px; line-height: 18px; color: var(--ps-red); overflow-wrap: anywhere; }
.ps-action-notice { margin: 0; font-size: 12px; line-height: 18px; color: var(--ps-ink-2); overflow-wrap: anywhere; }
.ps-warnings { margin: 0; padding-left: 16px; font-size: 11.5px; line-height: 17px; color: var(--ps-ink-3); display: flex; flex-direction: column; gap: 2px; overflow-wrap: anywhere; }
.ps-ledger { display: flex; flex-direction: column; gap: 8px; padding-top: 13px; border-top: 0.5px solid var(--ps-line-1); }
.ps-ledger-title { margin: 0; font-size: 11.5px; line-height: 16px; font-weight: 600; letter-spacing: 0.09em; text-transform: uppercase; color: var(--ps-ink-3); }
.ps-ledger-list { display: flex; flex-direction: column; }
.ps-ledger-row { display: grid; grid-template-columns: minmax(0, 1.4fr) 96px minmax(0, 1.2fr) 108px minmax(0, 0.9fr); gap: 10px; padding: 6px 0; border-bottom: 0.5px solid var(--ps-line-1); align-items: center; font-size: 11.5px; line-height: 16px; color: var(--ps-ink-2); }
.ps-ledger-row:last-child { border-bottom: 0; }
.ps-ledger-head { color: var(--ps-ink-4); font-size: 10.5px; line-height: 15px; letter-spacing: 0.06em; text-transform: uppercase; }
.ps-ellipsis { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; min-width: 0; }
@media (max-width: 720px) {
  .ps-page { padding: 18px 14px 32px; }
  .ps-stats { grid-template-columns: repeat(2, minmax(0, 1fr)); }
  .ps-field-grid { grid-template-columns: minmax(0, 1fr); }
  .ps-field-label { padding-top: 0; }
  .ps-record { grid-template-columns: minmax(0, 1fr); }
  .ps-record-side { justify-content: flex-start; padding: 0 12px 10px 13px; }
  .ps-ledger-row { grid-template-columns: minmax(0, 1fr) 90px; }
  .ps-ledger-application, .ps-ledger-spec, .ps-ledger-rollback { display: none; }
  .ps-timeline-item { grid-template-columns: minmax(0, 1fr); }
}
@media (prefers-reduced-motion: reduce) {
  .ps-page *, .ps-page *::before, .ps-page *::after {
    animation-duration: 0.01ms !important;
    animation-iteration-count: 1 !important;
    transition-duration: 0.01ms !important;
    scroll-behavior: auto !important;
  }
}
`

    /** Anvil silhouette, filled with the current color. */
    const ANVIL_PATH =
      'M3.2 8.1h15.1l3.5 1.4-3.5 1.4h-3.4l-1.5 4.2h4.1v3.2H6.5v-3.2h4.1l-1.5-4.2H3.2v-2.8Z'
    /** Four-point spark. */
    const SPARK_PATH = 'M19.2 3.1l0.7 1.8 1.8 0.7-1.8 0.7-0.7 1.8-0.7-1.8-1.8-0.7 1.8-0.7Z'
    /** Back chevron for the detail view. */
    const BACK_PATH = 'M13.5 5.5 8 12l5.5 6.5'

    /** Sidebar glyph: an anvil in currentColor with an amber spark above it. */
    function KeeperIcon(props) {
      const size = typeof props.size === 'number' && props.size > 0 ? props.size : 18
      const active = props.active === true
      return h(
        'svg',
        {
          width: size,
          height: size,
          viewBox: '0 0 24 24',
          fill: 'none',
          'aria-hidden': true,
          focusable: 'false',
          style: { display: 'block' },
        },
        h('path', { d: ANVIL_PATH, fill: 'currentColor' }),
        h('path', { d: SPARK_PATH, fill: active ? ACCENT_BRIGHT : ACCENT }),
        h('path', {
          d: 'M4.2 4.2 5.3 5.3',
          stroke: ACCENT,
          strokeWidth: 1.4,
          strokeLinecap: 'round',
        }),
        h('path', {
          d: 'M2.9 6.4h1.3',
          stroke: ACCENT,
          strokeWidth: 1.4,
          strokeLinecap: 'round',
        }),
      )
    }

    function BackIcon() {
      return h(
        'svg',
        {
          width: 14,
          height: 14,
          viewBox: '0 0 24 24',
          fill: 'none',
          'aria-hidden': true,
          focusable: 'false',
          style: { display: 'block' },
        },
        h('path', {
          d: BACK_PATH,
          stroke: 'currentColor',
          strokeWidth: 1.8,
          strokeLinecap: 'round',
          strokeLinejoin: 'round',
        }),
      )
    }

    /** Locale lookup with safe interpolation for `{name}` placeholders. */
    function format(template, vars) {
      if (typeof template !== 'string') return ''
      if (!vars) return template
      return template.replace(/\{([a-zA-Z0-9_]+)\}/g, (match, key) =>
        Object.prototype.hasOwnProperty.call(vars, key) ? String(vars[key]) : match,
      )
    }

    function createTranslator(base) {
      const source = typeof base === 'function' ? base : () => ''
      return (key, vars) => {
        let value = ''
        try {
          value = source(key, vars)
        } catch (error) {
          value = ''
        }
        if (typeof value !== 'string' || value.length === 0) value = key
        return format(value, vars)
      }
    }

    function finite(value) {
      return typeof value === 'number' && Number.isFinite(value)
    }

    function nonEmpty(value) {
      return typeof value === 'string' && value.length > 0
    }

    function timestampOf(value) {
      return finite(value) && value > 0 ? value : 0
    }

    function clampPercent(value) {
      if (!finite(value)) return null
      return Math.max(0, Math.min(100, value))
    }

    function scoreCell(t, value) {
      return finite(value) ? String(Math.round(value)) : t('unknown')
    }

    function countText(t, value) {
      return finite(value) ? String(Math.round(value)) : t('unknown')
    }

    function formatNumber(value) {
      try {
        return new Intl.NumberFormat().format(Math.round(value))
      } catch (error) {
        return String(Math.round(value))
      }
    }

    function formatBytes(t, value) {
      if (!finite(value) || value < 0) return t('unknown')
      if (value >= 1024 * 1024) return `${(value / (1024 * 1024)).toFixed(1)} ${t('bytesUnitMB')}`
      if (value >= 1024) return `${(value / 1024).toFixed(1)} ${t('bytesUnitKB')}`
      return `${formatNumber(value)} ${t('bytesUnitB')}`
    }

    function clockText(timestamp) {
      try {
        return new Date(timestamp).toLocaleTimeString(undefined, {
          hour: '2-digit',
          minute: '2-digit',
          second: '2-digit',
        })
      } catch (error) {
        return ''
      }
    }

    function dateTimeText(timestamp) {
      try {
        return new Date(timestamp).toLocaleString(undefined, {
          month: '2-digit',
          day: '2-digit',
          hour: '2-digit',
          minute: '2-digit',
        })
      } catch (error) {
        return ''
      }
    }

    function relativeText(t, timestamp) {
      const at = timestampOf(timestamp)
      if (at === 0) return t('unknown')
      const delta = Date.now() - at
      if (delta < 60 * 1000) return t('relativeJustNow')
      if (delta < 60 * 60 * 1000) return t('relativeMinutes', { count: Math.floor(delta / (60 * 1000)) })
      if (delta < 24 * 60 * 60 * 1000) return t('relativeHours', { count: Math.floor(delta / (60 * 60 * 1000)) })
      if (delta < 7 * 24 * 60 * 60 * 1000) return t('relativeDays', { count: Math.floor(delta / (24 * 60 * 60 * 1000)) })
      return dateTimeText(at)
    }

    function keeperError(key, vars) {
      const error = new Error(key)
      error.keeperKey = key
      if (vars) error.keeperVars = vars
      return error
    }

    function describeError(t, error) {
      if (error && typeof error.keeperKey === 'string') return t(error.keeperKey, error.keeperVars || {})
      if (error instanceof Error && nonEmpty(error.message)) return error.message
      if (nonEmpty(error)) return error
      return t('errorUnknown')
    }

    function documentHidden() {
      return typeof document !== 'undefined' && document.hidden === true
    }

    function prefersReducedMotion() {
      try {
        return typeof window !== 'undefined' && typeof window.matchMedia === 'function'
          ? window.matchMedia('(prefers-reduced-motion: reduce)').matches
          : false
      } catch (error) {
        return false
      }
    }

    /** Reads the service only when the Host actually exposes it. */
    function safeService(ctx, name) {
      if (!ctx || typeof ctx !== 'object') return null
      if (typeof ctx.get === 'function') {
        try {
          const value = ctx.get(name)
          if (value !== undefined && value !== null) return value
        } catch (error) {
          // The service is not injected for this plugin; fall through to `ctx[name]`.
        }
      }
      try {
        const value = ctx[name]
        if (value !== undefined && value !== null) return value
      } catch (error) {
        return null
      }
      return null
    }

    function readSessionId(value) {
      if (nonEmpty(value)) return value
      if (value && typeof value === 'object') {
        if (nonEmpty(value.id)) return value.id
        if (nonEmpty(value.sessionId)) return value.sessionId
        if (value.session && typeof value.session === 'object' && nonEmpty(value.session.id)) return value.session.id
      }
      return null
    }

    /** Same-origin request plumbing; every request carries the plugin header. */
    function requestInit(method, body) {
      const headers = {}
      headers[HEADER_NAME] = '1'
      const init = { method, headers, cache: 'no-store' }
      if (body !== undefined) {
        headers['content-type'] = 'application/json'
        init.body = JSON.stringify(body)
      }
      return init
    }

    async function readJsonSafe(response) {
      try {
        return await response.json()
      } catch (error) {
        return null
      }
    }

    function responseError(response, value) {
      const message = value && nonEmpty(value.error) ? value.error : null
      if (message) return new Error(message)
      return keeperError('errorHttp', { status: response.status })
    }

    async function apiGet(path, query) {
      let suffix = ''
      if (query) {
        try {
          suffix = `?${new URLSearchParams(query).toString()}`
        } catch (error) {
          suffix = ''
        }
      }
      let response
      try {
        response = await fetch(`${path}${suffix}`, requestInit('GET'))
      } catch (error) {
        throw keeperError('errorNetwork')
      }
      const value = await readJsonSafe(response)
      if (!response.ok) throw responseError(response, value)
      if (value === null || typeof value !== 'object') throw keeperError('errorUnexpected')
      if (value.ok === false) throw responseError(response, value)
      return value
    }

    async function apiPost(body) {
      let response
      try {
        response = await fetch(API_ACTION, requestInit('POST', body))
      } catch (error) {
        throw keeperError('errorNetwork')
      }
      const value = await readJsonSafe(response)
      if (!response.ok || (value && value.ok === false)) throw responseError(response, value)
      if (value === null || typeof value !== 'object') throw keeperError('errorUnexpected')
      return value
    }

    /**
     * Starts a working session for a claimed brief.
     *
     * Preferred path (when the Host exposes the client `sessions` service):
     * create -> retain -> `prompt([...], 'queue')` -> `uiWorkspace.openSession`.
     * Fallback: `uiWorkspace.startSession(undefined, { prompt, whenDraftExists: 'append' })`,
     * where the brief lands in the composer as an unsent draft.
     * Returns `{ mode: 'session' | 'draft', sessionId }`.
     */
    async function startSessionWithBrief(ctx, brief) {
      const sessions = safeService(ctx, 'sessions')
      const workspace = safeService(ctx, 'uiWorkspace')
      let lastError = null
      if (sessions && typeof sessions.create === 'function') {
        try {
          const created = await sessions.create()
          const sessionId = readSessionId(created)
          let handle = null
          if (typeof sessions.retain === 'function') {
            try {
              handle = await sessions.retain(sessionId || created)
            } catch (error) {
              lastError = error
            }
          }
          if (!handle && created && typeof created === 'object' && typeof created.prompt === 'function') {
            handle = created
          }
          if (!handle && sessionId && typeof sessions.get === 'function') {
            try {
              handle = await sessions.get(sessionId)
            } catch (error) {
              lastError = error
            }
          }
          if (sessionId && handle && typeof handle.prompt === 'function') {
            await handle.prompt([{ type: 'text', text: brief }], 'queue')
            if (workspace && typeof workspace.openSession === 'function') workspace.openSession(sessionId)
            return { mode: 'session', sessionId }
          }
        } catch (error) {
          lastError = error
        }
      }
      if (workspace && typeof workspace.startSession === 'function') {
        const started = await workspace.startSession(undefined, { prompt: brief, whenDraftExists: 'append' })
        return { mode: 'draft', sessionId: readSessionId(started) }
      }
      throw lastError || keeperError('errorUnexpected')
    }

    async function claimAndLaunch(ctx, id, kind, briefFallback) {
      const result = await apiPost({ action: 'claim-session', id, kind })
      let brief = ''
      if (result && nonEmpty(result.brief)) brief = result.brief
      else if (nonEmpty(briefFallback)) brief = briefFallback
      if (!brief) throw keeperError('sessionBriefMissing')
      return startSessionWithBrief(ctx, brief)
    }

    function openSessionById(ctx, sessionId) {
      if (!nonEmpty(sessionId)) return false
      const workspace = safeService(ctx, 'uiWorkspace')
      if (workspace && typeof workspace.openSession === 'function') {
        try {
          workspace.openSession(sessionId)
          return true
        } catch (error) {
          // Fall through to the sessions store.
        }
      }
      const sessions = safeService(ctx, 'sessions')
      if (sessions && typeof sessions.open === 'function') {
        try {
          sessions.open(sessionId)
          return true
        } catch (error) {
          return false
        }
      }
      return false
    }

    function focusSection(sectionId) {
      try {
        if (typeof document === 'undefined') return
        const node = document.getElementById(sectionId)
        if (!node || typeof node.scrollIntoView !== 'function') return
        node.scrollIntoView({ block: 'start', behavior: prefersReducedMotion() ? 'auto' : 'smooth' })
      } catch (error) {
        // Scrolling is cosmetic; never fail an action on it.
      }
    }

    /* ------------------------------------------------------------------ */
    /* Frozen contract vocabularies.                                       */
    /* ------------------------------------------------------------------ */

    const STATUS_KEYS = {
      intake: 'statusIntake',
      scouting: 'statusScouting',
      auditing: 'statusAuditing',
      decision: 'statusDecision',
      'awaiting-approval': 'statusAwaitingApproval',
      executing: 'statusExecuting',
      verifying: 'statusVerifying',
      ready: 'statusReady',
      installed: 'statusInstalled',
      blocked: 'statusBlocked',
      rejected: 'statusRejected',
      archived: 'statusArchived',
    }

    const STATUS_TONES = {
      intake: 'info',
      scouting: 'info',
      auditing: 'info',
      decision: 'info',
      'awaiting-approval': 'waiting',
      executing: 'info',
      verifying: 'info',
      ready: 'waiting',
      installed: 'installed',
      blocked: 'blocked',
      rejected: 'blocked',
      archived: 'archived',
    }

    const WORKING_STATUSES = ['intake', 'scouting', 'auditing', 'decision', 'executing', 'verifying']
    const WAITING_STATUSES = ['awaiting-approval', 'ready']

    const FILTER_ORDER = ['all', 'working', 'waiting', 'installed', 'blocked', 'archived']
    const FILTER_KEYS = {
      all: 'tabAll',
      working: 'tabWorking',
      waiting: 'tabWaiting',
      installed: 'tabInstalled',
      blocked: 'tabBlocked',
      archived: 'tabArchived',
    }
    const FILTER_STATUSES = {
      working: WORKING_STATUSES,
      waiting: WAITING_STATUSES,
      installed: ['installed'],
      blocked: ['blocked', 'rejected'],
      archived: ['archived'],
    }

    const BLOOD_KEYS = { full: 'bloodFull', thin: 'bloodThin', cut: 'bloodCut', unknown: 'bloodUnknown' }
    const BLOOD_TONES = { full: 'installed', thin: 'waiting', cut: 'blocked', unknown: 'muted' }

    const VERDICT_KEYS = {
      safe: 'verdictSafe',
      caution: 'verdictCaution',
      unsafe: 'verdictUnsafe',
      unknown: 'verdictUnknown',
    }
    const VERDICT_TONES = { safe: 'installed', caution: 'waiting', unsafe: 'blocked', unknown: 'muted' }

    const EVIDENCE_KEYS = {
      static: 'evidenceStatic',
      sandbox: 'evidenceSandbox',
      behavioral: 'evidenceBehavioral',
      none: 'evidenceNone',
    }

    /** How deep the audit looked: downloaded source vs package metadata only. */
    const SCOPE_KEYS = { source: 'auditScopeSource', metadata: 'auditScopeMetadata' }

    const SEVERITY_KEYS = {
      critical: 'severityCritical',
      high: 'severityHigh',
      medium: 'severityMedium',
      low: 'severityLow',
      info: 'severityInfo',
    }
    const SEVERITY_TONES = {
      critical: 'blocked',
      high: 'blocked',
      medium: 'waiting',
      low: 'info',
      info: 'muted',
    }

    const SOURCE_KEYS = {
      market: 'sourceMarket',
      npm: 'sourceNpm',
      github: 'sourceGithub',
      local: 'sourceLocal',
      manual: 'sourceManual',
    }

    const GAP_KIND_KEYS = {
      cut: 'kindCut',
      incomplete: 'kindIncomplete',
      stale: 'kindStale',
      integration: 'kindIntegration',
      ux: 'kindUx',
      unknown: 'kindUnknown',
    }
    const GAP_KIND_TONES = {
      cut: 'blocked',
      incomplete: 'waiting',
      stale: 'waiting',
      integration: 'info',
      ux: 'info',
      unknown: 'muted',
    }
    const GAP_STATE_KEYS = { partial: 'gapStatePartial', missing: 'gapStateMissing' }
    const GAP_STATE_TONES = { partial: 'waiting', missing: 'blocked' }
    const EFFORT_KEYS = { S: 'effortS', M: 'effortM', L: 'effortL' }
    const RISK_KEYS = { low: 'riskLow', medium: 'riskMedium', high: 'riskHigh' }
    const RISK_TONES = { low: 'installed', medium: 'waiting', high: 'blocked' }

    const DECISION_KIND_KEYS = {
      install: 'decisionInstall',
      'complete-then-install': 'decisionCompleteThenInstall',
      build: 'decisionBuild',
      reject: 'decisionReject',
    }
    const DECISION_KIND_TONES = {
      install: 'installed',
      'complete-then-install': 'waiting',
      build: 'info',
      reject: 'blocked',
    }

    const EXECUTION_KIND_KEYS = { install: 'execInstall', complete: 'execComplete', build: 'execBuild' }
    const EXECUTION_KIND_TONES = { install: 'installed', complete: 'waiting', build: 'info' }

    const APPLICATION_KEYS = {
      applied: 'appApplied',
      'restart-required': 'appRestartRequired',
      overridden: 'appOverridden',
      failed: 'appFailed',
      cancelled: 'appCancelled',
    }
    const APPLICATION_TONES = {
      applied: 'installed',
      'restart-required': 'waiting',
      overridden: 'waiting',
      failed: 'blocked',
      cancelled: 'muted',
    }

    const CHECK_KEYS = { pass: 'checkPass', fail: 'checkFail', skip: 'checkSkip' }
    const CHECK_TONES = { pass: 'installed', fail: 'blocked', skip: 'muted' }

    const NOTE_ACTOR_KEYS = { user: 'noteActorUser', agent: 'noteActorAgent', host: 'noteActorHost' }

    const PRIMARY_ACTION_KEYS = {
      work: 'actWork',
      review: 'actReview',
      install: 'actInstall',
      complete: 'actComplete',
      build: 'actBuild',
    }

    const SECONDARY_ACTION_KEYS = {
      install: 'actInstall',
      work: 'actWork',
      complete: 'actComplete',
      build: 'actBuild',
      gap: 'regapButton',
      rollback: 'actRollback',
      archive: 'actArchive',
      reopen: 'actReopen',
      reject: 'actReject',
    }

    const DEPTH_VALUES = ['quick', 'standard', 'deep']
    const DEPTH_KEYS = { quick: 'depthQuick', standard: 'depthStandard', deep: 'depthDeep' }

    const PERMISSION_DEFS = [
      { key: 'installScripts', labelKey: 'permInstallScripts', kind: 'bool', risky: true },
      { key: 'network', labelKey: 'permNetwork', kind: 'network', risky: true },
      { key: 'childProcess', labelKey: 'permChildProcess', kind: 'bool', risky: true },
      { key: 'eval', labelKey: 'permEval', kind: 'bool', risky: true },
      { key: 'filesystemWrite', labelKey: 'permFilesystemWrite', kind: 'bool', risky: true },
      { key: 'credentials', labelKey: 'permCredentials', kind: 'bool', risky: true },
      { key: 'obfuscated', labelKey: 'permObfuscated', kind: 'bool', risky: true },
      { key: 'nativeAddons', labelKey: 'permNativeAddons', kind: 'bool', risky: true },
      { key: 'patchesShippedRows', labelKey: 'permPatchesShippedRows', kind: 'bool', risky: true },
      { key: 'sparseSource', labelKey: 'permSparseSource', kind: 'bool', risky: false },
    ]

    function dictLabel(t, map, value, fallbackKey) {
      if (typeof value === 'string' && Object.prototype.hasOwnProperty.call(map, value)) return t(map[value])
      return t(fallbackKey || 'unknown')
    }

    function statusLabel(t, status) {
      if (typeof status === 'string' && Object.prototype.hasOwnProperty.call(STATUS_KEYS, status)) {
        return t(STATUS_KEYS[status])
      }
      return t('unknown')
    }

    function statusTone(status) {
      if (typeof status === 'string' && Object.prototype.hasOwnProperty.call(STATUS_TONES, status)) {
        return STATUS_TONES[status]
      }
      return 'muted'
    }

    function bloodTone(label) {
      if (typeof label === 'string' && Object.prototype.hasOwnProperty.call(BLOOD_TONES, label)) {
        return BLOOD_TONES[label]
      }
      return 'muted'
    }

    function applicationLabel(t, application) {
      if (typeof application === 'string' && Object.prototype.hasOwnProperty.call(APPLICATION_KEYS, application)) {
        return t(APPLICATION_KEYS[application])
      }
      if (nonEmpty(application)) return application
      return t('unknown')
    }

    function applicationTone(application) {
      if (typeof application === 'string' && Object.prototype.hasOwnProperty.call(APPLICATION_TONES, application)) {
        return APPLICATION_TONES[application]
      }
      return 'muted'
    }

    function installFeedback(t, result) {
      const raw = result && nonEmpty(result.application) ? result.application : null
      const warnings = result && Array.isArray(result.warnings) ? result.warnings.filter(nonEmpty) : []
      let message = t('actionInstalled', { application: applicationLabel(t, raw) })
      if (warnings.length > 0) message = `${message} · ${t('actionWarnings', { count: warnings.length })}`
      return { message, warnings }
    }

    /** Isolated trial-install evidence (`audit.sandbox`): one textual state, no color. */
    function sandboxStateKey(sandbox) {
      if (!sandbox || sandbox.ok !== true) return 'auditSandboxIncomplete'
      if (sandbox.digestMatch === true) return 'auditSandboxPassed'
      if (sandbox.digestMatch === false) return 'auditSandboxMismatch'
      return 'auditSandboxCompleted'
    }

    function sandboxHintText(t, sandbox) {
      const files = finite(sandbox.files) ? formatNumber(sandbox.files) : t('unknown')
      const ms = finite(sandbox.ms) ? formatNumber(sandbox.ms) : t('unknown')
      let text = t('auditSandboxHint', { files, ms })
      const weak = sandbox.ok !== true || sandbox.digestMatch === false
      if (weak && nonEmpty(sandbox.error)) text = `${text} · ${sandbox.error}`
      return text
    }

    /** Requirement revision source: the user or the model. */
    function revisionSourceLabel(t, source) {
      if (source === 'user') return t('sourceUser')
      if (source === 'agent') return t('sourceAgent')
      return t('unknown')
    }

    /** Append-only revisions, presented newest first. */
    function sortedRevisions(intent) {
      const revisions = intent && Array.isArray(intent.revisions) ? intent.revisions.filter((item) => item && typeof item === 'object') : []
      return revisions.slice().sort((left, right) => {
        const byTime = timestampOf(right.at) - timestampOf(left.at)
        if (byTime !== 0) return byTime
        return (finite(right.rev) ? right.rev : 0) - (finite(left.rev) ? left.rev : 0)
      })
    }

    function buildSecondaryActions(record, summary) {
      if (!record || typeof record !== 'object') return []
      const status = nonEmpty(record.status) ? record.status : ''
      const primary = summary && nonEmpty(summary.primaryAction) ? summary.primaryAction : 'none'
      const installable = summary && summary.installable === true
      const actions = []
      const add = (action) => {
        if (action !== primary && !actions.includes(action)) actions.push(action)
      }
      if (!record.install && installable) add('install')
      if (summary && summary.bloodStale === true) add('gap')
      const decisionKind = record.decision && nonEmpty(record.decision.kind) ? record.decision.kind : null
      if (!record.execution && ['awaiting-approval', 'decision', 'ready', 'blocked'].includes(status)) {
        add('work')
        if (decisionKind === 'complete-then-install') add('complete')
        if (decisionKind === 'build') add('build')
      }
      if (record.install && record.install.rollback) add('rollback')
      if (status !== 'archived') add('archive')
      if (['blocked', 'rejected', 'archived'].includes(status)) add('reopen')
      if (!['rejected', 'archived', 'installed'].includes(status)) add('reject')
      return actions
    }

    /* ------------------------------------------------------------------ */
    /* Data hooks.                                                          */
    /* ------------------------------------------------------------------ */

    function useKeeperState() {
      const [snapshot, setSnapshot] = React.useState({
        data: null,
        error: null,
        loading: true,
        busy: false,
        updatedAt: 0,
      })
      const ticket = React.useRef(0)

      const load = React.useCallback(async (manual) => {
        const current = ++ticket.current
        if (manual === true) setSnapshot((previous) => ({ ...previous, busy: true }))
        try {
          const value = await apiGet(API_STATE)
          if (current !== ticket.current) return
          setSnapshot({ data: value, error: null, loading: false, busy: false, updatedAt: Date.now() })
        } catch (error) {
          if (current !== ticket.current) return
          setSnapshot((previous) => ({ ...previous, error, loading: false, busy: false }))
        }
      }, [])

      React.useEffect(() => {
        let disposed = false
        const tick = () => {
          if (disposed || documentHidden()) return
          void load(false)
        }
        tick()
        const timer = window.setInterval(tick, REFRESH_MS)
        const onVisibility = () => {
          if (!documentHidden()) tick()
        }
        if (typeof document !== 'undefined' && typeof document.addEventListener === 'function') {
          document.addEventListener('visibilitychange', onVisibility)
        }
        return () => {
          disposed = true
          ticket.current += 1
          window.clearInterval(timer)
          if (typeof document !== 'undefined' && typeof document.removeEventListener === 'function') {
            document.removeEventListener('visibilitychange', onVisibility)
          }
        }
      }, [load])

      return {
        data: snapshot.data,
        error: snapshot.error,
        loading: snapshot.loading,
        busy: snapshot.busy,
        updatedAt: snapshot.updatedAt,
        reload: load,
      }
    }

    function useKeeperRecord(id, revision, syncKey) {
      const [state, setState] = React.useState({
        record: null,
        brief: '',
        loading: true,
        error: null,
        missing: false,
      })
      const ticket = React.useRef(0)

      React.useEffect(() => {
        if (!nonEmpty(id)) {
          setState({ record: null, brief: '', loading: false, error: null, missing: false })
          return undefined
        }
        let cancelled = false
        const current = ++ticket.current
        setState((previous) => ({ ...previous, loading: true, error: null }))
        apiGet(API_RECORD, { id })
          .then((value) => {
            if (cancelled || current !== ticket.current) return
            const record = value && typeof value.record === 'object' && value.record !== null ? value.record : null
            setState({
              record,
              brief: value && nonEmpty(value.brief) ? value.brief : '',
              loading: false,
              error: null,
              missing: record === null,
            })
          })
          .catch((error) => {
            if (cancelled || current !== ticket.current) return
            setState((previous) => ({ ...previous, loading: false, error }))
          })
        return () => {
          cancelled = true
        }
      }, [id, revision, syncKey])

      return state
    }

    /* ------------------------------------------------------------------ */
    /* Small presentational components.                                     */
    /* ------------------------------------------------------------------ */

    function Chip(props) {
      const classes = ['ps-chip']
      if (props.tone) classes.push(`ps-tone-${props.tone}`)
      if (props.mono) classes.push('ps-chip-mono')
      return h(
        'span',
        { className: classes.join(' '), title: props.title || undefined },
        props.dot === false ? null : h('span', { className: 'ps-dot' }),
        h('span', null, props.label),
        props.value === undefined || props.value === null || props.value === ''
          ? null
          : h('span', { className: 'ps-chip-score ps-mono' }, props.value),
      )
    }

    function StatusChip(props) {
      return h(Chip, { tone: statusTone(props.status), label: statusLabel(props.t, props.status) })
    }

    function BloodChip(props) {
      const labelKey = BLOOD_KEYS[props.label] || 'bloodUnknown'
      return h(Chip, {
        tone: bloodTone(props.label),
        mono: true,
        label: props.t(labelKey),
        value: finite(props.score) ? String(Math.round(props.score)) : null,
      })
    }

    function Section(props) {
      const children = Array.isArray(props.children) ? props.children : [props.children]
      return h(
        'section',
        { className: 'ps-section', id: props.id || undefined },
        h(
          'div',
          { className: 'ps-section-head' },
          h('span', { className: 'ps-section-index' }, props.index),
          h('h2', { className: 'ps-section-title' }, props.title),
          props.aside ? h('span', { className: 'ps-section-aside' }, props.aside) : null,
        ),
        h('div', { className: 'ps-section-body' }, ...children),
      )
    }

    function ErrorBar(props) {
      return h(
        'div',
        { className: 'ps-feedback ps-feedback-error', role: 'alert' },
        h('span', { className: 'ps-feedback-text' }, props.message),
        props.onRetry
          ? h('button', { type: 'button', className: 'ps-btn ps-btn-sm', onClick: props.onRetry }, props.retryLabel)
          : null,
      )
    }

    function EmptyState(props) {
      const titleKey = props.filtered ? 'listEmptyFilteredTitle' : 'listEmptyTitle'
      const hintKey = props.filtered ? 'listEmptyFilteredHint' : 'listEmptyHint'
      return h(
        'div',
        { className: 'ps-empty' },
        props.showGlyph ? h('span', { className: 'ps-empty-glyph' }, h(KeeperIcon, { size: 26 })) : null,
        h('p', { className: 'ps-empty-title' }, props.t(titleKey)),
        h('p', { className: 'ps-empty-hint' }, props.t(hintKey)),
      )
    }

    function PageHeader(props) {
      return h(
        'header',
        { className: 'ps-head' },
        h(
          'div',
          { className: 'ps-head-main' },
          h(
            'div',
            { className: 'ps-head-title-row' },
            h('span', { className: 'ps-head-glyph' }, h(KeeperIcon, { size: 20 })),
            h('h1', { className: 'ps-title' }, props.t('title')),
          ),
          h('p', { className: 'ps-subtitle' }, props.t('subtitle')),
        ),
        h(
          'div',
          { className: 'ps-toolbar' },
          props.updatedAt
            ? h('span', { className: 'ps-updated' }, props.t('updated', { time: clockText(props.updatedAt) }))
            : null,
          h(
            'button',
            { type: 'button', className: 'ps-btn', onClick: props.onRefresh, disabled: props.busy },
            props.busy ? props.t('refreshing') : props.t('refresh'),
          ),
          h('span', { className: 'ps-auto' }, props.t('autoRefresh')),
        ),
      )
    }

    function StatsRow(props) {
      const items = [
        { key: 'statTotal', value: props.counts.total },
        { key: 'statWorking', value: props.counts.working },
        { key: 'statWaiting', value: props.counts.waiting },
        { key: 'statInstalled', value: props.counts.installed },
      ]
      return h(
        'div',
        { className: 'ps-stats' },
        items.map((item) =>
          h(
            'div',
            { key: item.key, className: 'ps-stat' },
            h('span', { className: 'ps-stat-label' }, props.t(item.key)),
            h('span', { className: 'ps-stat-value' }, countText(props.t, item.value)),
          ),
        ),
      )
    }

    function DepthControl(props) {
      return h(
        'div',
        { className: 'ps-seg', role: 'group', 'aria-label': props.t('depthLabel') },
        DEPTH_VALUES.map((option) =>
          h(
            'button',
            {
              key: option,
              type: 'button',
              className: `ps-seg-btn${props.value === option ? ' ps-seg-btn-on' : ''}`,
              'aria-pressed': props.value === option,
              disabled: props.disabled === true,
              onClick: () => props.onChange(option),
            },
            props.t(DEPTH_KEYS[option]),
          ),
        ),
      )
    }

    function recordStatus(record) {
      return record && nonEmpty(record.status) ? record.status : 'unknown'
    }

    function summaryTitle(t, summary) {
      if (summary && nonEmpty(summary.title)) return summary.title
      if (summary && nonEmpty(summary.intent)) return summary.intent
      return t('unknown')
    }

    function intentExcerpt(value) {
      if (!nonEmpty(value)) return ''
      const single = value.replace(/\s+/g, ' ').trim()
      return single.length > 160 ? `${single.slice(0, 160)}…` : single
    }

    const IntakeCard = React.memo(function IntakeCard(props) {
      const t = props.t
      const onCreated = props.onCreated
      const [text, setText] = React.useState('')
      const [depth, setDepth] = React.useState('standard')
      const [pending, setPending] = React.useState(false)
      const [error, setError] = React.useState(null)
      const [notice, setNotice] = React.useState(null)
      const busyRef = React.useRef(false)

      const submit = React.useCallback(async () => {
        if (busyRef.current) return
        const value = text.trim()
        if (value.length === 0) {
          setError(t('intakeEmpty'))
          return
        }
        busyRef.current = true
        setPending(true)
        setError(null)
        setNotice(null)
        try {
          await apiPost({ action: 'intake', text: value, depth })
          setText('')
          setNotice(t('intakeCreated'))
          onCreated()
        } catch (failure) {
          setError(describeError(t, failure))
        } finally {
          busyRef.current = false
          setPending(false)
        }
      }, [depth, onCreated, t, text])

      const onKeyDown = (event) => {
        if (event.key === 'Enter' && (event.metaKey || event.ctrlKey)) {
          event.preventDefault()
          void submit()
        }
      }

      return h(
        'section',
        { className: 'ps-intake', 'aria-label': t('intakeTitle') },
        h(
          'div',
          { className: 'ps-intake-head' },
          h('h2', { className: 'ps-intake-title' }, t('intakeTitle')),
          h(DepthControl, {
            t,
            value: depth,
            disabled: pending,
            onChange: (next) => setDepth(next),
          }),
        ),
        h('textarea', {
          className: 'ps-textarea',
          value: text,
          rows: 3,
          spellCheck: false,
          placeholder: t('intakePlaceholder'),
          'aria-label': t('intakeTitle'),
          onChange: (event) => setText(event.target.value),
          onKeyDown,
        }),
        h(
          'div',
          { className: 'ps-intake-foot' },
          h('span', { className: 'ps-hint' }, t('intakeHint')),
          h(
            'button',
            {
              type: 'button',
              className: 'ps-btn ps-btn-primary',
              onClick: () => {
                void submit()
              },
              disabled: pending,
            },
            pending ? t('intakeSubmitting') : t('intakeSubmit'),
          ),
        ),
        error ? h('p', { className: 'ps-form-error', role: 'alert' }, error) : null,
        notice ? h('p', { className: 'ps-form-notice', role: 'status' }, notice) : null,
      )
    })

    function RecordCard(props) {
      const t = props.t
      const summary = props.summary
      const status = recordStatus(summary)
      const primaryKey = PRIMARY_ACTION_KEYS[summary.primaryAction]
      const primaryLabel = primaryKey ? t(primaryKey) : null
      const updated = timestampOf(summary.updatedAt) || timestampOf(summary.createdAt)
      const revisionCount = finite(summary.revisionCount) ? Math.max(1, Math.round(summary.revisionCount)) : 1
      const intentRev = finite(summary.intentRev) ? Math.max(1, Math.round(summary.intentRev)) : revisionCount
      const gapRound = finite(summary.gapRound) ? Math.max(1, Math.round(summary.gapRound)) : 1
      return h(
        'article',
        { className: `ps-record ps-tone-${statusTone(status)}` },
        h(
          'button',
          { type: 'button', className: 'ps-record-main', onClick: () => props.onOpen(summary.id) },
          h(
            'div',
            { className: 'ps-record-top' },
            h('span', { className: 'ps-record-title' }, summaryTitle(t, summary)),
            h(StatusChip, { t, status }),
          ),
          h('p', { className: 'ps-record-intent', title: nonEmpty(summary.intent) ? summary.intent : undefined }, intentExcerpt(summary.intent)),
          h(
            'div',
            { className: 'ps-record-meta' },
            summary.bloodLabel
              ? h(BloodChip, { t, label: summary.bloodLabel, score: summary.bloodScore })
              : null,
            revisionCount > 1
              ? h(Chip, { mono: true, dot: false, label: t('revisionBadge', { rev: intentRev }) })
              : null,
            h(Chip, {
              mono: true,
              dot: false,
              label: t('auditScoreLabel', { score: scoreCell(t, summary.auditScore) }),
            }),
            h(Chip, {
              mono: true,
              dot: false,
              label: t('candidatesCount', { count: countText(t, summary.candidateCount) }),
            }),
            gapRound > 1
              ? h(Chip, { mono: true, dot: false, label: t('gapRoundShort', { round: gapRound }) })
              : null,
            h('span', { className: 'ps-record-time', title: dateTimeText(updated) }, relativeText(t, updated)),
            nonEmpty(summary.id) ? h('span', { className: 'ps-record-id', title: summary.id }, summary.id) : null,
          ),
        ),
        primaryLabel
          ? h(
              'div',
              { className: 'ps-record-side' },
              h(
                'button',
                {
                  type: 'button',
                  className: 'ps-btn ps-btn-primary ps-btn-sm',
                  disabled: props.pending,
                  onClick: () => props.onPrimary(summary),
                },
                props.pending ? t('actionPending') : primaryLabel,
              ),
            )
          : null,
      )
    }

    function Ledger(props) {
      const entries = Array.isArray(props.entries) ? props.entries.filter((entry) => entry && typeof entry === 'object') : []
      if (entries.length === 0) return null
      const head = h(
        'div',
        { className: 'ps-ledger-row ps-ledger-head' },
        h('span', null, props.t('ledgerRecord')),
        h('span', { className: 'ps-ledger-application' }, props.t('ledgerApplication')),
        h('span', { className: 'ps-ledger-spec' }, props.t('ledgerSpec')),
        h('span', null, props.t('ledgerAt')),
        h('span', { className: 'ps-ledger-rollback' }, props.t('ledgerRollback')),
      )
      return h(
        'section',
        { className: 'ps-ledger', 'aria-label': props.t('ledgerTitle') },
        h('h2', { className: 'ps-ledger-title' }, props.t('ledgerTitle')),
        h(
          'div',
          { className: 'ps-ledger-list' },
          head,
          entries.slice(0, 8).map((entry, index) => {
            const name = nonEmpty(entry.title) ? entry.title : nonEmpty(entry.recordId) ? entry.recordId : props.t('unknown')
            return h(
              'div',
              { key: nonEmpty(entry.recordId) ? `${entry.recordId}-${index}` : `ledger-${index}`, className: 'ps-ledger-row' },
              h('span', { className: 'ps-ellipsis', title: name }, name),
              h('span', { className: 'ps-ledger-application' }, applicationLabel(props.t, entry.application)),
              h('span', { className: 'ps-ledger-spec ps-ellipsis ps-mono', title: nonEmpty(entry.spec) ? entry.spec : '' }, nonEmpty(entry.spec) ? entry.spec : props.t('unknown')),
              h('span', { className: 'ps-mono' }, dateTimeText(entry.at)),
              h('span', { className: 'ps-ledger-rollback ps-ellipsis' }, nonEmpty(entry.rollbackName) ? entry.rollbackName : props.t('rollbackNone')),
            )
          }),
        ),
      )
    }

    /* ------------------------------------------------------------------ */
    /* Detail sections.                                                     */
    /* ------------------------------------------------------------------ */

    /** Collapsible requirement-revision list; hidden when only the first revision exists. */
    function RevisionList(props) {
      const t = props.t
      const revisions = props.revisions
      const [expanded, setExpanded] = React.useState(null)
      if (revisions.length <= 1) return null
      return h(
        'details',
        { className: 'ps-revisions' },
        h(
          'summary',
          { className: 'ps-revisions-summary' },
          h('span', null, t('revisionListTitle')),
          h('span', { className: 'ps-revisions-count ps-mono' }, String(revisions.length)),
        ),
        h(
          'ol',
          { className: 'ps-revision-list' },
          revisions.map((revision, index) => {
            const rev = finite(revision.rev) ? Math.max(1, Math.round(revision.rev)) : revisions.length - index
            const text = nonEmpty(revision.text) ? revision.text : ''
            const isExpanded = expanded === rev
            const long = text.length > 160 || text.split('\n').length > 3
            return h(
              'li',
              { key: `revision-${rev}-${index}`, className: 'ps-revision' },
              h(
                'div',
                { className: 'ps-revision-head' },
                h('span', { className: 'ps-revision-rev ps-mono' }, t('revisionBadge', { rev })),
                finite(revision.at) ? h('span', { className: 'ps-revision-meta ps-mono' }, dateTimeText(revision.at)) : null,
                h('span', { className: 'ps-revision-source' }, revisionSourceLabel(t, revision.source)),
                nonEmpty(revision.note) ? h('span', { className: 'ps-revision-note' }, revision.note) : null,
              ),
              text ? h('p', { className: `ps-revision-text${long && !isExpanded ? ' ps-revision-clamped' : ''}` }, text) : null,
              long
                ? h(
                    'button',
                    { type: 'button', className: 'ps-revision-toggle', onClick: () => setExpanded(isExpanded ? null : rev) },
                    isExpanded ? t('revisionCollapse') : t('revisionExpand'),
                  )
                : null,
            )
          }),
        ),
      )
    }

    /** Inline "add requirement" composer: POSTs `amend`, keeps the draft local. */
    function AmendBox(props) {
      const t = props.t
      const onAmend = props.onAmend
      const [text, setText] = React.useState('')
      const [pending, setPending] = React.useState(false)
      const [error, setError] = React.useState(null)
      const [notice, setNotice] = React.useState(null)
      const busyRef = React.useRef(false)

      const submit = React.useCallback(async () => {
        if (busyRef.current) return
        const value = text.trim()
        if (value.length === 0) {
          setError(t('amendEmpty'))
          return
        }
        busyRef.current = true
        setPending(true)
        setError(null)
        setNotice(null)
        try {
          await onAmend(value)
          setText('')
          setNotice(t('amendSuccess'))
        } catch (failure) {
          setError(t('amendFailed', { message: describeError(t, failure) }))
        } finally {
          busyRef.current = false
          setPending(false)
        }
      }, [onAmend, t, text])

      const onKeyDown = (event) => {
        if (event.key === 'Enter' && (event.metaKey || event.ctrlKey)) {
          event.preventDefault()
          void submit()
        }
      }

      return h(
        'div',
        { className: 'ps-amend' },
        h('h3', { className: 'ps-amend-title' }, t('amendTitle')),
        h('textarea', {
          className: 'ps-textarea ps-textarea-sm',
          value: text,
          rows: 2,
          spellCheck: false,
          placeholder: t('amendPlaceholder'),
          'aria-label': t('amendTitle'),
          onChange: (event) => setText(event.target.value),
          onKeyDown,
        }),
        h(
          'div',
          { className: 'ps-intake-foot' },
          error
            ? h('p', { className: 'ps-form-error', role: 'alert' }, error)
            : notice
              ? h('p', { className: 'ps-form-notice', role: 'status' }, notice)
              : h('span', { className: 'ps-hint' }, t('intakeHint')),
          h(
            'button',
            { type: 'button', className: 'ps-btn', onClick: () => void submit(), disabled: pending },
            pending ? t('amendSubmitting') : t('amendSubmit'),
          ),
        ),
      )
    }

    function IntentSection(props) {
      const t = props.t
      const record = props.record
      const intent = record && record.intent && typeof record.intent === 'object' ? record.intent : null
      const text = intent && nonEmpty(intent.text) ? intent.text : ''
      const capabilities = intent && Array.isArray(intent.capabilities) ? intent.capabilities.filter(nonEmpty) : []
      const constraints = intent && Array.isArray(intent.constraints) ? intent.constraints.filter(nonEmpty) : []
      const depth = intent && nonEmpty(intent.depth) ? intent.depth : 'standard'
      const revisions = sortedRevisions(intent)
      const rev = intent && finite(intent.rev) ? Math.max(1, Math.round(intent.rev)) : 1
      const revisionTotal = revisions.length > 0 ? revisions.length : rev
      let aside = t('revisionBadge', { rev })
      if (revisionTotal > 1) aside = `${aside} · ${t('revisionCount', { count: revisionTotal - 1 })}`
      return h(
        Section,
        { index: '01', title: t('sectionIntent'), aside },
        text ? h('p', { className: 'ps-raw' }, text) : h('p', { className: 'ps-empty-inline' }, t('intentEmpty')),
        h(
          'div',
          { className: 'ps-field-grid' },
          h('span', { className: 'ps-field-label' }, t('intentDepth')),
          h(
            'div',
            { className: 'ps-field-value' },
            h(DepthControl, {
              t,
              value: depth,
              disabled: props.depthPending === true,
              onChange: props.onSetDepth,
            }),
          ),
          h('span', { className: 'ps-field-label' }, t('intentCapabilities')),
          h(
            'div',
            { className: 'ps-field-value' },
            capabilities.length > 0
              ? h(
                  'div',
                  { className: 'ps-chips' },
                  capabilities.map((capability, index) => h('span', { key: `${capability}-${index}`, className: 'ps-chip' }, capability)),
                )
              : h('span', { className: 'ps-empty-inline' }, t('intentNone')),
          ),
          h('span', { className: 'ps-field-label' }, t('intentConstraints')),
          h(
            'div',
            { className: 'ps-field-value' },
            constraints.length > 0
              ? h(
                  'div',
                  { className: 'ps-chips' },
                  constraints.map((constraint, index) => h('span', { key: `${constraint}-${index}`, className: 'ps-chip' }, constraint)),
                )
              : h('span', { className: 'ps-empty-inline' }, t('intentNone')),
          ),
        ),
        h(RevisionList, { t, revisions }),
        h(AmendBox, { t, onAmend: props.onAmend }),
      )
    }

    function CandidatesSection(props) {
      const t = props.t
      const record = props.record
      const selected = record.candidate && typeof record.candidate === 'object' ? record.candidate : null
      const candidates = Array.isArray(record.candidates) ? record.candidates.filter((item) => item && typeof item === 'object') : []
      const rows = candidates.length > 0 ? candidates : selected ? [selected] : []
      const body =
        rows.length === 0
          ? h('p', { className: 'ps-empty-inline' }, t('candEmpty'))
          : h(
              'div',
              { className: 'ps-table-wrap', role: 'region', 'aria-label': t('candCompare') },
              h(
                'table',
                { className: 'ps-table' },
                h(
                  'thead',
                  null,
                  h(
                    'tr',
                    null,
                    h('th', { scope: 'col' }, t('candName')),
                    h('th', { scope: 'col' }, t('candSource')),
                    h('th', { scope: 'col' }, t('candVersion')),
                    h('th', { scope: 'col', className: 'ps-num' }, t('candFit')),
                    h('th', { scope: 'col', className: 'ps-num' }, t('candQuality')),
                    h('th', { scope: 'col', className: 'ps-num' }, t('candMaintenance')),
                    h('th', { scope: 'col', className: 'ps-num' }, t('candRisk')),
                  ),
                ),
                h(
                  'tbody',
                  null,
                  rows.map((item, index) => {
                    const isSelected =
                      selected !== null &&
                      nonEmpty(item.name) &&
                      item.name === selected.name &&
                      (item.version || '') === (selected.version || '')
                    return h(
                      'tr',
                      { key: `${nonEmpty(item.name) ? item.name : 'candidate'}-${index}`, className: isSelected ? 'ps-row-selected' : undefined },
                      h(
                        'td',
                        null,
                        h('span', { className: 'ps-cand-name' }, nonEmpty(item.name) ? item.name : t('unknown')),
                        isSelected ? h(Chip, { tone: 'waiting', label: t('candSelected') }) : null,
                        nonEmpty(item.license)
                          ? h('div', { className: 'ps-cand-sub ps-mono' }, `${t('candLicense')} ${item.license}`)
                          : null,
                      ),
                      h('td', null, dictLabel(t, SOURCE_KEYS, item.source, 'unknown')),
                      h('td', { className: 'ps-mono' }, nonEmpty(item.version) ? item.version : t('unknown')),
                      h('td', { className: 'ps-num ps-mono' }, scoreCell(t, item.fitScore)),
                      h('td', { className: 'ps-num ps-mono' }, scoreCell(t, item.qualityScore)),
                      h('td', { className: 'ps-num ps-mono' }, scoreCell(t, item.maintenanceScore)),
                      h('td', { className: 'ps-num ps-mono' }, scoreCell(t, item.riskScore)),
                    )
                  }),
                ),
              ),
            )
      return h(
        Section,
        {
          index: '02',
          title: t('sectionCandidates'),
          aside: rows.length > 0 ? t('candidatesCount', { count: rows.length }) : null,
        },
        body,
      )
    }

    function AuditSection(props) {
      const t = props.t
      const record = props.record
      const audit = record.audit && typeof record.audit === 'object' ? record.audit : null
      if (!audit) {
        return h(Section, { index: '03', title: t('sectionAudit') }, h('p', { className: 'ps-empty-inline' }, t('auditEmpty')))
      }
      const verdict = nonEmpty(audit.verdict) ? audit.verdict : 'unknown'
      const verdictTone = VERDICT_TONES[verdict] || 'muted'
      const auditScope = nonEmpty(audit.scope) ? audit.scope : 'unknown'
      const percent = clampPercent(audit.score)
      const findings = Array.isArray(audit.findings) ? audit.findings.filter((finding) => finding && typeof finding === 'object') : []
      const permissions = audit.permissions && typeof audit.permissions === 'object' ? audit.permissions : null
      const stats = audit.stats && typeof audit.stats === 'object' ? audit.stats : null
      const sandbox = audit.sandbox && typeof audit.sandbox === 'object' ? audit.sandbox : null
      let statsLine = null
      if (stats) {
        const parts = {
          files: finite(stats.files) ? formatNumber(stats.files) : t('unknown'),
          bytes: formatBytes(t, stats.bytes),
          deps: finite(stats.dependencies) ? formatNumber(stats.dependencies) : t('unknown'),
        }
        statsLine = h('span', { className: 'ps-mono' }, t('auditStats', parts))
      }
      const permissionRows = permissions
        ? PERMISSION_DEFS.map((definition) => {
            const value = permissions[definition.key]
            const isNetwork = definition.kind === 'network'
            const active = isNetwork ? Array.isArray(value) && value.length > 0 : value === true
            let text
            if (isNetwork) {
              text = Array.isArray(value) && value.filter(nonEmpty).length > 0 ? value.filter(nonEmpty).join(', ') : t('permNo')
            } else if (value === true) {
              text = t('permYes')
            } else if (value === false) {
              text = t('permNo')
            } else {
              text = t('permNone')
            }
            const tone = active ? (definition.risky ? 'waiting' : 'info') : 'muted'
            return h(
              'div',
              { key: definition.key, className: `ps-perm ps-tone-${tone}` },
              h('span', { className: 'ps-perm-label' }, t(definition.labelKey)),
              h('span', { className: 'ps-perm-value' }, h('span', { className: 'ps-dot' }), text),
            )
          })
        : null
      const findingsBody =
        findings.length === 0
          ? h('p', { className: 'ps-empty-inline' }, t('auditNoFindings'))
          : h(
              'div',
              { className: 'ps-findings' },
              findings.map((finding, index) => {
                const severity = nonEmpty(finding.severity) ? finding.severity : 'info'
                const location = nonEmpty(finding.file)
                  ? `${finding.file}${finite(finding.line) ? `:${finding.line}` : ''}`
                  : null
                return h(
                  'div',
                  { key: nonEmpty(finding.id) ? finding.id : `finding-${index}`, className: 'ps-finding' },
                  h(
                    'div',
                    { className: 'ps-finding-head' },
                    h(
                      'span',
                      { className: `ps-badge ps-tone-${SEVERITY_TONES[severity] || 'muted'}` },
                      h('span', { className: 'ps-dot' }),
                      dictLabel(t, SEVERITY_KEYS, severity, 'severityInfo'),
                    ),
                    h('span', { className: 'ps-finding-title' }, nonEmpty(finding.title) ? finding.title : t('unknown')),
                    location ? h('span', { className: 'ps-finding-loc', title: location }, location) : null,
                  ),
                  nonEmpty(finding.detail) ? h('p', { className: 'ps-finding-detail' }, finding.detail) : null,
                  nonEmpty(finding.evidence) ? h('p', { className: 'ps-finding-detail' }, h('code', { className: 'ps-code' }, finding.evidence)) : null,
                )
              }),
            )
      return h(
        Section,
        {
          index: '03',
          title: t('sectionAudit'),
          aside: findings.length > 0 ? t('auditFindings', { count: findings.length }) : null,
        },
        h(
          'div',
          { className: 'ps-audit-top' },
          h(
            'span',
            { className: 'ps-audit-scorewrap' },
            h('span', { className: 'ps-score' }, scoreCell(t, audit.score)),
            h('span', { className: 'ps-score-out' }, t('scoreOutOf')),
          ),
          h(
            'div',
            { className: `ps-scorebar ps-tone-${verdictTone}`, role: 'progressbar', 'aria-label': t('auditScore'), 'aria-valuemin': 0, 'aria-valuemax': 100, 'aria-valuenow': percent === null ? undefined : Math.round(percent) },
            h('div', { className: 'ps-scorebar-fill', style: { width: `${percent === null ? 0 : Math.round(percent)}%` } }),
          ),
        ),
        h(
          'div',
          { className: 'ps-field-grid' },
          h('span', { className: 'ps-field-label' }, t('auditVerdict')),
          h('span', { className: 'ps-field-value' }, h(Chip, { tone: verdictTone, label: dictLabel(t, VERDICT_KEYS, verdict, 'verdictUnknown') })),
          h('span', { className: 'ps-field-label' }, t('auditEvidence')),
          h('span', { className: 'ps-field-value' }, dictLabel(t, EVIDENCE_KEYS, audit.evidenceLevel, 'evidenceNone')),
          h('span', { className: 'ps-field-label' }, t('auditScope')),
          h('span', { className: 'ps-field-value' }, dictLabel(t, SCOPE_KEYS, auditScope, 'unknown')),
          sandbox ? h('span', { className: 'ps-field-label' }, t('auditSandbox')) : null,
          sandbox ? h('span', { className: 'ps-field-value' }, t(sandboxStateKey(sandbox))) : null,
          h('span', { className: 'ps-field-label' }, t('auditTarget')),
          h('span', { className: 'ps-field-value ps-mono' }, nonEmpty(audit.target) ? audit.target : t('unknown')),
        ),
        auditScope === 'metadata' ? h('p', { className: 'ps-hint' }, t('auditScopeHint')) : null,
        sandbox ? h('p', { className: 'ps-hint' }, sandboxHintText(t, sandbox)) : null,
        statsLine ? h('p', { className: 'ps-hint ps-mono' }, statsLine) : null,
        permissionRows && permissionRows.length > 0
          ? h('div', null, h('p', { className: 'ps-subhead' }, t('auditPermissions')), h('div', { className: 'ps-perm-grid' }, permissionRows))
          : null,
        findingsBody,
      )
    }

    function BloodSection(props) {
      const t = props.t
      const record = props.record
      const blood = record.blood && typeof record.blood === 'object' ? record.blood : null
      if (!blood) {
        return h(Section, { index: '04', title: t('sectionBlood') }, h('p', { className: 'ps-empty-inline' }, t('bloodNoData')))
      }
      const label = nonEmpty(blood.label) ? blood.label : 'unknown'
      const gaps = Array.isArray(blood.gaps) ? blood.gaps.filter((gap) => gap && typeof gap === 'object') : []
      const round = finite(blood.round) ? Math.max(1, Math.round(blood.round)) : 1
      const stale = blood.stale === true
      let aside = t('gapRoundLabel', { round })
      if (round > 1) aside = `${aside} · ${t('gapRecheck')}`
      if (gaps.length > 0) aside = `${aside} · ${t('bloodGaps', { count: gaps.length })}`
      return h(
        Section,
        { index: '04', title: t('sectionBlood'), aside },
        stale ? h('p', { className: 'ps-hint ps-hint-warn' }, t('bloodStaleHint')) : null,
        h(
          'div',
          { className: 'ps-gap-meta' },
          h(BloodChip, { t, label, score: blood.score }),
          nonEmpty(blood.summary) ? h('span', { className: 'ps-field-value' }, blood.summary) : null,
          props.onRegap
            ? h(
                'button',
                {
                  type: 'button',
                  className: 'ps-btn ps-btn-sm',
                  disabled: props.pending === true,
                  onClick: props.onRegap,
                },
                props.running === true ? t('actionPending') : t('regapButton'),
              )
            : null,
        ),
        gaps.length === 0
          ? h('p', { className: 'ps-empty-inline' }, t('bloodNoGaps'))
          : h(
              'div',
              { className: 'ps-gaps' },
              gaps.map((gap, index) => {
                const kind = nonEmpty(gap.kind) ? gap.kind : 'unknown'
                const state = nonEmpty(gap.state) ? gap.state : 'missing'
                const effort = dictLabel(t, EFFORT_KEYS, gap.effort, 'unknown')
                const risk = dictLabel(t, RISK_KEYS, gap.risk, 'unknown')
                return h(
                  'div',
                  { key: nonEmpty(gap.id) ? gap.id : `gap-${index}`, className: `ps-gap ps-tone-${GAP_KIND_TONES[kind] || 'muted'}` },
                  h('span', { className: 'ps-gap-label' }, t('gapCapability')),
                  h('span', { className: 'ps-gap-title' }, nonEmpty(gap.capability) ? gap.capability : t('unknown')),
                  h(
                    'div',
                    { className: 'ps-gap-meta' },
                    h(Chip, { dot: false, label: t('gapKind'), value: dictLabel(t, GAP_KIND_KEYS, kind, 'kindUnknown') }),
                    h(Chip, { tone: GAP_STATE_TONES[state] || 'muted', label: dictLabel(t, GAP_STATE_KEYS, state, 'kindUnknown') }),
                    h(Chip, { dot: false, label: t('gapEffort'), value: effort }),
                    h(Chip, { tone: RISK_TONES[gap.risk] || 'muted', label: t('gapRisk'), value: risk }),
                  ),
                  nonEmpty(gap.evidence)
                    ? h('p', { className: 'ps-gap-line' }, h('span', { className: 'ps-gap-label' }, t('gapEvidence')), gap.evidence)
                    : null,
                  nonEmpty(gap.remedy)
                    ? h('p', { className: 'ps-gap-line' }, h('span', { className: 'ps-gap-label' }, t('gapRemedy')), gap.remedy)
                    : null,
                )
              }),
            ),
      )
    }

    function DecisionSection(props) {
      const t = props.t
      const record = props.record
      const decision = record.decision && typeof record.decision === 'object' ? record.decision : null
      const staleHint = props.stale === true ? h('p', { className: 'ps-hint ps-hint-warn' }, t('decisionStaleHint')) : null
      if (!decision) {
        return h(
          Section,
          { index: '05', title: t('sectionDecision') },
          staleHint,
          h('p', { className: 'ps-empty-inline' }, t('decisionEmpty')),
        )
      }
      const kind = nonEmpty(decision.kind) ? decision.kind : 'reject'
      const plan = decision.plan && typeof decision.plan === 'object' ? decision.plan : null
      const steps = plan && Array.isArray(plan.steps) ? plan.steps.filter(nonEmpty) : []
      const risks = plan && Array.isArray(plan.risks) ? plan.risks.filter(nonEmpty) : []
      const criteria = plan && Array.isArray(plan.acceptCriteria) ? plan.acceptCriteria.filter(nonEmpty) : []
      const upstream = plan && plan.upstream && typeof plan.upstream === 'object' ? plan.upstream : null
      return h(
        Section,
        { index: '05', title: t('sectionDecision') },
        staleHint,
        h(
          'div',
          { className: 'ps-field-grid' },
          h('span', { className: 'ps-field-label' }, t('decisionKind')),
          h(
            'span',
            { className: 'ps-field-value' },
            h(Chip, { tone: DECISION_KIND_TONES[kind] || 'muted', label: dictLabel(t, DECISION_KIND_KEYS, kind, 'decisionReject') }),
          ),
          h('span', { className: 'ps-field-label' }, t('decisionRationale')),
          h('span', { className: 'ps-field-value' }, nonEmpty(decision.rationale) ? decision.rationale : t('unknown')),
        ),
        plan === null
          ? h('p', { className: 'ps-empty-inline' }, t('decisionNoPlan'))
          : h(
              'div',
              null,
              h(
                'div',
                { className: 'ps-gap-meta' },
                h(Chip, { dot: false, label: t('decisionEffort'), value: dictLabel(t, EFFORT_KEYS, plan.effort, 'unknown') }),
              ),
              steps.length > 0
                ? h(
                    'div',
                    { className: 'ps-gap-line' },
                    h('p', { className: 'ps-subhead' }, t('decisionSteps')),
                    h('ol', { className: 'ps-ordered' }, steps.map((step, index) => h('li', { key: `step-${index}` }, step))),
                  )
                : null,
              risks.length > 0
                ? h(
                    'div',
                    { className: 'ps-gap-line' },
                    h('p', { className: 'ps-subhead' }, t('decisionRisks')),
                    h('ul', { className: 'ps-risks' }, risks.map((risk, index) => h('li', { key: `risk-${index}` }, risk))),
                  )
                : null,
              criteria.length > 0
                ? h(
                    'div',
                    { className: 'ps-gap-line' },
                    h('p', { className: 'ps-subhead' }, t('decisionAccept')),
                    h('ol', { className: 'ps-ordered' }, criteria.map((criterion, index) => h('li', { key: `criterion-${index}` }, criterion))),
                  )
                : null,
              upstream
                ? h(
                    'div',
                    { className: 'ps-field-grid' },
                    h('span', { className: 'ps-field-label' }, t('decisionUpstream')),
                    h('span', { className: 'ps-field-value ps-mono' }, nonEmpty(upstream.repo) ? upstream.repo : t('unknown')),
                    h('span', { className: 'ps-field-label' }, t('decisionFork')),
                    h('span', { className: 'ps-field-value' }, upstream.fork === true ? t('forkYes') : t('forkNo')),
                    h('span', { className: 'ps-field-label' }, t('decisionAttribution')),
                    h('span', { className: 'ps-field-value' }, nonEmpty(upstream.attribution) ? upstream.attribution : t('unknown')),
                    h('span', { className: 'ps-field-label' }, t('decisionLicenseNote')),
                    h('span', { className: 'ps-field-value' }, nonEmpty(upstream.licenseNote) ? upstream.licenseNote : t('unknown')),
                  )
                : null,
            ),
      )
    }

    function ExecutionSection(props) {
      const t = props.t
      const record = props.record
      const execution = record.execution && typeof record.execution === 'object' ? record.execution : null
      if (!execution) {
        return h(Section, { index: '06', title: t('sectionExecution') }, h('p', { className: 'ps-empty-inline' }, t('executionEmpty')))
      }
      const kind = nonEmpty(execution.kind) ? execution.kind : 'install'
      const steps = Array.isArray(execution.steps) ? execution.steps.filter((step) => step && typeof step === 'object') : []
      const sessionId =
        nonEmpty(execution.sessionId) ? execution.sessionId : record.links && Array.isArray(record.links.sessionIds) && nonEmpty(record.links.sessionIds[0]) ? record.links.sessionIds[0] : null
      return h(
        Section,
        { index: '06', title: t('sectionExecution') },
        h(
          'div',
          { className: 'ps-field-grid' },
          h('span', { className: 'ps-field-label' }, t('executionKind')),
          h('span', { className: 'ps-field-value' }, h(Chip, { tone: EXECUTION_KIND_TONES[kind] || 'muted', label: dictLabel(t, EXECUTION_KIND_KEYS, kind, 'execInstall') })),
          h('span', { className: 'ps-field-label' }, t('executionStarted')),
          h('span', { className: 'ps-field-value ps-mono' }, finite(execution.startedAt) ? dateTimeText(execution.startedAt) : t('unknown')),
          h('span', { className: 'ps-field-label' }, t('executionBundle')),
          h('span', { className: 'ps-field-value ps-mono' }, nonEmpty(execution.bundlePath) ? execution.bundlePath : t('unknown')),
        ),
        sessionId
          ? h(
              'div',
              { className: 'ps-gap-meta' },
              h(
                'button',
                { type: 'button', className: 'ps-btn ps-btn-sm', onClick: () => props.onOpenSession(sessionId) },
                t('executionOpenSession'),
              ),
              h('span', { className: 'ps-mono' }, sessionId),
            )
          : null,
        steps.length > 0
          ? h(
              'div',
              null,
              h('p', { className: 'ps-subhead' }, t('executionSteps')),
              h(
                'ol',
                { className: 'ps-steps' },
                steps.map((step, index) =>
                  h(
                    'li',
                    { key: `exec-step-${index}`, className: 'ps-step' },
                    h('span', { className: `ps-step-dot${step.done === true ? ' ps-step-dot-on' : ''}` }),
                    finite(step.at) ? h('span', { className: 'ps-step-time' }, clockText(step.at)) : null,
                    h('span', null, nonEmpty(step.text) ? step.text : t('unknown')),
                  ),
                ),
              ),
            )
          : null,
      )
    }

    function VerificationSection(props) {
      const t = props.t
      const record = props.record
      const verification = record.verification && typeof record.verification === 'object' ? record.verification : null
      if (!verification) {
        return h(Section, { index: '07', title: t('sectionVerification') }, h('p', { className: 'ps-empty-inline' }, t('verificationEmpty')))
      }
      const checks = Array.isArray(verification.checks) ? verification.checks.filter((check) => check && typeof check === 'object') : []
      return h(
        Section,
        { index: '07', title: t('sectionVerification') },
        h(
          'div',
          { className: 'ps-field-grid' },
          h('span', { className: 'ps-field-label' }, t('verificationResult')),
          h(
            'span',
            { className: 'ps-field-value' },
            h(Chip, {
              tone: verification.passed === true ? 'installed' : 'blocked',
              label: verification.passed === true ? t('verificationPassed') : t('verificationFailed'),
            }),
          ),
          h('span', { className: 'ps-field-label' }, t('verificationGate')),
          h('span', { className: 'ps-field-value ps-mono' }, nonEmpty(verification.gate) ? verification.gate : t('unknown')),
          h('span', { className: 'ps-field-label' }, t('verificationAt')),
          h('span', { className: 'ps-field-value ps-mono' }, finite(verification.at) ? dateTimeText(verification.at) : t('unknown')),
        ),
        checks.length > 0
          ? h(
              'div',
              { className: 'ps-table-wrap' },
              h(
                'table',
                { className: 'ps-table' },
                h(
                  'thead',
                  null,
                  h(
                    'tr',
                    null,
                    h('th', { scope: 'col' }, t('verificationGate')),
                    h('th', { scope: 'col' }, t('checkName')),
                    h('th', { scope: 'col' }, t('checkStatus')),
                    h('th', { scope: 'col' }, t('checkDetail')),
                  ),
                ),
                h(
                  'tbody',
                  null,
                  checks.map((check, index) => {
                    const status = nonEmpty(check.status) ? check.status : 'skip'
                    return h(
                      'tr',
                      { key: `check-${index}` },
                      h('td', { className: 'ps-mono' }, nonEmpty(check.level) ? check.level : t('unknown')),
                      h('td', null, nonEmpty(check.name) ? check.name : t('unknown')),
                      h('td', null, h(Chip, { tone: CHECK_TONES[status] || 'muted', label: dictLabel(t, CHECK_KEYS, status, 'checkSkip') })),
                      h('td', null, nonEmpty(check.detail) ? check.detail : t('unknown')),
                    )
                  }),
                ),
              ),
            )
          : null,
      )
    }

    function InstallSection(props) {
      const t = props.t
      const record = props.record
      const install = record.install && typeof record.install === 'object' ? record.install : null
      if (!install) {
        return h(Section, { index: '08', title: t('sectionInstall') }, h('p', { className: 'ps-empty-inline' }, t('installEmpty')))
      }
      const warnings = Array.isArray(install.warnings) ? install.warnings.filter(nonEmpty) : []
      return h(
        Section,
        { index: '08', title: t('sectionInstall') },
        h(
          'div',
          { className: 'ps-field-grid' },
          h('span', { className: 'ps-field-label' }, t('installApplication')),
          h(
            'span',
            { className: 'ps-field-value' },
            h(Chip, { tone: applicationTone(install.application), label: applicationLabel(t, install.application) }),
          ),
          h('span', { className: 'ps-field-label' }, t('installSpec')),
          h('span', { className: 'ps-field-value ps-mono' }, nonEmpty(install.spec) ? install.spec : t('unknown')),
          h('span', { className: 'ps-field-label' }, t('installVersion')),
          h('span', { className: 'ps-field-value ps-mono' }, nonEmpty(install.version) ? install.version : t('unknown')),
          h('span', { className: 'ps-field-label' }, t('installAt')),
          h('span', { className: 'ps-field-value ps-mono' }, finite(install.at) ? dateTimeText(install.at) : t('unknown')),
          h('span', { className: 'ps-field-label' }, t('installBundle')),
          h('span', { className: 'ps-field-value ps-mono' }, nonEmpty(install.bundle) ? install.bundle : t('unknown')),
          h('span', { className: 'ps-field-label' }, t('installRollback')),
          h(
            'span',
            { className: 'ps-field-value ps-mono' },
            install.rollback && nonEmpty(install.rollback.name)
              ? t('rollbackAvailable', { name: install.rollback.name })
              : t('rollbackNone'),
          ),
        ),
        warnings.length > 0
          ? h(
              'div',
              null,
              h('p', { className: 'ps-subhead' }, t('installWarnings')),
              h('ul', { className: 'ps-warnings' }, warnings.map((warning, index) => h('li', { key: `warning-${index}` }, warning))),
            )
          : null,
      )
    }

    function NotesSection(props) {
      const t = props.t
      const notes = Array.isArray(props.notes) ? props.notes.filter((note) => note && typeof note === 'object') : []
      const [text, setText] = React.useState('')
      const [pending, setPending] = React.useState(false)
      const [error, setError] = React.useState(null)
      const busyRef = React.useRef(false)

      const submit = React.useCallback(async () => {
        if (busyRef.current) return
        const value = text.trim()
        if (value.length === 0) {
          setError(t('noteEmptyError'))
          return
        }
        busyRef.current = true
        setPending(true)
        setError(null)
        try {
          const accepted = await props.onAddNote(value)
          if (accepted) setText('')
        } finally {
          busyRef.current = false
          setPending(false)
        }
      }, [props.onAddNote, t, text])

      const onKeyDown = (event) => {
        if (event.key === 'Enter' && (event.metaKey || event.ctrlKey)) {
          event.preventDefault()
          void submit()
        }
      }

      return h(
        Section,
        { index: '09', title: t('sectionNotes') },
        notes.length === 0
          ? h('p', { className: 'ps-empty-inline' }, t('notesEmpty'))
          : h(
              'div',
              { className: 'ps-notes' },
              notes.map((note, index) =>
                h(
                  'div',
                  { key: `note-${index}`, className: 'ps-note' },
                  h(
                    'div',
                    { className: 'ps-note-head' },
                    h('span', { className: 'ps-note-actor' }, dictLabel(t, NOTE_ACTOR_KEYS, note.actor, 'noteActorHost')),
                    h('span', null, finite(note.at) ? dateTimeText(note.at) : t('unknown')),
                  ),
                  h('p', { className: 'ps-note-text' }, nonEmpty(note.text) ? note.text : t('unknown')),
                ),
              ),
            ),
        h(
          'div',
          { className: 'ps-note-compose' },
          h('textarea', {
            className: 'ps-textarea ps-textarea-sm',
            value: text,
            rows: 2,
            spellCheck: false,
            placeholder: t('notePlaceholder'),
            'aria-label': t('notePlaceholder'),
            onChange: (event) => setText(event.target.value),
            onKeyDown,
          }),
          h(
            'div',
            { className: 'ps-intake-foot' },
            error ? h('p', { className: 'ps-form-error', role: 'alert' }, error) : h('span', { className: 'ps-hint' }, t('intakeHint')),
            h(
              'button',
              { type: 'button', className: 'ps-btn', onClick: () => void submit(), disabled: pending },
              pending ? t('noteAdding') : t('noteAdd'),
            ),
          ),
        ),
      )
    }

    function HistorySection(props) {
      const t = props.t
      const entries = Array.isArray(props.history) ? props.history.filter((entry) => entry && typeof entry === 'object') : []
      return h(
        Section,
        { index: '10', title: t('sectionHistory') },
        entries.length === 0
          ? h('p', { className: 'ps-empty-inline' }, t('historyEmpty'))
          : h(
              'ol',
              { className: 'ps-timeline' },
              entries.map((entry, index) =>
                h(
                  'li',
                  { key: `history-${index}`, className: 'ps-timeline-item' },
                  h('span', { className: 'ps-timeline-time' }, finite(entry.at) ? dateTimeText(entry.at) : t('unknown')),
                  h(
                    'span',
                    null,
                    nonEmpty(entry.kind) ? h('span', { className: 'ps-timeline-kind' }, entry.kind) : null,
                    nonEmpty(entry.detail) ? entry.detail : t('unknown'),
                  ),
                ),
              ),
            ),
      )
    }

    /* ------------------------------------------------------------------ */
    /* Detail view.                                                         */
    /* ------------------------------------------------------------------ */

    function RecordDetail(props) {
      const t = props.t
      const ctx = props.ctx
      const id = props.id
      const summary = props.summary || null
      const state = useKeeperRecord(id, props.revision, props.syncKey)
      const record = state.record
      const onMutated = props.onMutated
      const onBack = props.onBack
      const [pendingKey, setPendingKey] = React.useState(null)
      const [actionError, setActionError] = React.useState(null)
      const [actionNotice, setActionNotice] = React.useState(null)
      const [actionWarnings, setActionWarnings] = React.useState([])
      const pendingRef = React.useRef(null)

      React.useEffect(() => {
        pendingRef.current = null
        setPendingKey(null)
        setActionError(null)
        setActionNotice(null)
        setActionWarnings([])
      }, [id])

      const runAction = React.useCallback(
        async (key, body) => {
          if (pendingRef.current) return null
          pendingRef.current = key
          setPendingKey(key)
          setActionError(null)
          setActionNotice(null)
          setActionWarnings([])
          try {
            const result = await apiPost(body)
            return result
          } catch (error) {
            setActionError(t('actionFailed', { message: describeError(t, error) }))
            return null
          } finally {
            pendingRef.current = null
            setPendingKey(null)
            // The Host may have partially applied the action; always re-read.
            onMutated()
          }
        },
        [onMutated, t],
      )

      const runInstall = async () => {
        const result = await runAction('install', { action: 'install', id })
        if (!result) return
        const feedback = installFeedback(t, result)
        setActionNotice(feedback.message)
        setActionWarnings(feedback.warnings)
      }

      const runSession = async (kind) => {
        if (pendingRef.current) return
        pendingRef.current = kind
        setPendingKey(kind)
        setActionError(null)
        setActionNotice(null)
        setActionWarnings([])
        try {
          const result = await apiPost({ action: 'claim-session', id, kind })
          let brief = ''
          if (result && nonEmpty(result.brief)) brief = result.brief
          else if (nonEmpty(state.brief)) brief = state.brief
          if (!brief) throw keeperError('sessionBriefMissing')
          try {
            const launched = await startSessionWithBrief(ctx, brief)
            if (launched.mode === 'draft') setActionNotice(t('sessionDraftHint'))
            else if (launched.sessionId) setActionNotice(t('sessionOpened', { id: launched.sessionId }))
            else setActionNotice(t('sessionStarted'))
          } catch (launchError) {
            setActionError(t('sessionLaunchFailed', { message: describeError(t, launchError) }))
          }
        } catch (error) {
          setActionError(
            error && error.keeperKey === 'sessionBriefMissing'
              ? t('sessionBriefMissing')
              : t('actionFailed', { message: describeError(t, error) }),
          )
        } finally {
          pendingRef.current = null
          setPendingKey(null)
          onMutated()
        }
      }

      const runSimple = async (action) => {
        const result = await runAction(action, { action, id })
        if (result) setActionNotice(t('actionDone'))
      }

      /** Append a requirement revision; the Host invalidates the old decision + gap analysis. */
      const amendIntent = async (text) => {
        if (!nonEmpty(text)) throw keeperError('amendEmpty')
        await apiPost({ action: 'amend', id, text })
        onMutated()
      }

      const addNote = async (text) => {
        if (pendingRef.current) return false
        pendingRef.current = 'note'
        setPendingKey('note')
        setActionError(null)
        try {
          await apiPost({ action: 'note', id, text })
          onMutated()
          return true
        } catch (error) {
          setActionError(t('actionFailed', { message: describeError(t, error) }))
          return false
        } finally {
          pendingRef.current = null
          setPendingKey(null)
        }
      }

      const openSession = (sessionId) => {
        if (openSessionById(ctx, sessionId)) {
          setActionNotice(t('sessionOpened', { id: sessionId }))
        } else {
          setActionError(t('openSessionUnavailable'))
        }
      }

      const primaryAction = summary && nonEmpty(summary.primaryAction) ? summary.primaryAction : 'none'
      const primaryKey = PRIMARY_ACTION_KEYS[primaryAction]
      const secondaryActions = buildSecondaryActions(record, summary)

      const handlePrimary = () => {
        if (pendingRef.current) return
        if (primaryAction === 'install') {
          void runInstall()
          return
        }
        if (primaryAction === 'work' || primaryAction === 'complete' || primaryAction === 'build') {
          void runSession(primaryAction)
          return
        }
        if (primaryAction === 'review') focusSection('ps-section-candidates')
      }

      const handleSecondary = (action) => {
        if (pendingRef.current) return
        if (action === 'install') {
          void runInstall()
          return
        }
        if (action === 'work' || action === 'complete' || action === 'build' || action === 'gap') {
          void runSession(action)
          return
        }
        void runSimple(action)
      }

      const title = record && record.intent && nonEmpty(record.intent.title)
        ? record.intent.title
        : summaryTitle(t, summary)
      const status = recordStatus(record) !== 'unknown' ? recordStatus(record) : summary ? recordStatus(summary) : 'unknown'
      const bloodLabel = record && record.blood && typeof record.blood === 'object' && nonEmpty(record.blood.label)
        ? record.blood.label
        : summary && summary.bloodLabel
          ? summary.bloodLabel
          : null
      const bloodScore = record && record.blood && typeof record.blood === 'object' ? record.blood.score : summary ? summary.bloodScore : null
      const auditScore = record && record.audit && typeof record.audit === 'object' ? record.audit.score : summary ? summary.auditScore : null
      const createdAt = record && finite(record.createdAt) ? record.createdAt : summary ? summary.createdAt : null
      const updatedAt = record && finite(record.updatedAt) ? record.updatedAt : summary ? summary.updatedAt : null

      const head = h(
        'div',
        { className: 'ps-detail-head' },
        h(
          'button',
          { type: 'button', className: 'ps-back', onClick: onBack, 'aria-label': t('closeDetail') },
          h(BackIcon, null),
          h('span', null, t('detailBack')),
        ),
        h('h2', { className: 'ps-detail-title' }, title),
        h(
          'div',
          { className: 'ps-detail-meta' },
          h(StatusChip, { t, status }),
          bloodLabel ? h(BloodChip, { t, label: bloodLabel, score: bloodScore }) : null,
          finite(auditScore)
            ? h(Chip, { mono: true, dot: false, label: t('auditScoreLabel', { score: Math.round(auditScore) }) })
            : null,
          h('span', { className: 'ps-mono', title: id }, id),
          createdAt ? h('span', { className: 'ps-mono' }, t('createdAt', { time: dateTimeText(createdAt) })) : null,
          updatedAt ? h('span', { className: 'ps-mono' }, t('updated', { time: dateTimeText(updatedAt) })) : null,
          h('span', { className: 'ps-esc' }, t('escHint')),
        ),
        record && nonEmpty(record.statusReason) ? h('p', { className: 'ps-status-reason' }, record.statusReason) : null,
      )

      const body = record
        ? h(
            React.Fragment,
            null,
            h(IntentSection, {
              t,
              record,
              depthPending: pendingKey === 'set-depth',
              onSetDepth: (depth) => {
                void runAction('set-depth', { action: 'set-depth', id, depth })
              },
              onAmend: amendIntent,
            }),
            h(CandidatesSection, { t, record }),
            h(AuditSection, { t, record }),
            h(BloodSection, {
              t,
              record,
              pending: pendingKey !== null,
              running: pendingKey === 'gap',
              onRegap: () => {
                void runSession('gap')
              },
            }),
            h(DecisionSection, { t, record, stale: summary && summary.decisionStale === true }),
            h(ExecutionSection, { t, record, onOpenSession: openSession }),
            h(VerificationSection, { t, record }),
            h(InstallSection, { t, record }),
            h(NotesSection, { t, notes: record.notes, onAddNote: addNote }),
            h(HistorySection, { t, history: record.history }),
          )
        : null

      const actionBar = record
        ? h(
            'section',
            { className: 'ps-actionbar', 'aria-label': t('actionsLabel') },
            h(
              'div',
              { className: 'ps-actionbar-row' },
              primaryKey
                ? h(
                    'button',
                    { type: 'button', className: 'ps-btn ps-btn-primary', disabled: pendingKey !== null, onClick: handlePrimary },
                    pendingKey === primaryAction ? t('actionPending') : t(primaryKey),
                  )
                : h('span', { className: 'ps-action-hint' }, t('actNone')),
              secondaryActions.map((action) =>
                h(
                  'button',
                  {
                    key: action,
                    type: 'button',
                    className: `ps-btn${action === 'reject' ? ' ps-btn-danger' : ''}`,
                    disabled: pendingKey !== null,
                    onClick: () => handleSecondary(action),
                  },
                  pendingKey === action ? t('actionPending') : t(SECONDARY_ACTION_KEYS[action]),
                ),
              ),
            ),
            actionNotice ? h('p', { className: 'ps-action-notice', role: 'status' }, actionNotice) : null,
            actionError ? h('p', { className: 'ps-action-error', role: 'alert' }, actionError) : null,
            actionWarnings.length > 0
              ? h('ul', { className: 'ps-warnings' }, actionWarnings.map((warning, index) => h('li', { key: `warning-${index}` }, warning)))
              : null,
          )
        : null

      let pendingBody = null
      if (!record) {
        if (state.error) {
          pendingBody = h(ErrorBar, {
            message: t('detailError', { message: describeError(t, state.error) }),
            retryLabel: t('retry'),
            onRetry: onMutated,
          })
        } else if (state.loading) {
          pendingBody = h('div', { className: 'ps-state' }, t('detailLoading'))
        } else {
          pendingBody = h('div', { className: 'ps-empty' }, h('p', { className: 'ps-empty-title' }, t('detailMissing')))
        }
      }

      return h('div', { className: 'ps-detail' }, head, pendingBody, body, actionBar)
    }

    /* ------------------------------------------------------------------ */
    /* Master page.                                                         */
    /* ------------------------------------------------------------------ */

    function useFilteredRecords(records, filter) {
      if (filter === 'all') return records
      const statuses = FILTER_STATUSES[filter] || []
      return records.filter((record) => record && statuses.includes(record.status))
    }

    function countForFilter(records, filter) {
      if (filter === 'all') return records.length
      const statuses = FILTER_STATUSES[filter] || []
      let count = 0
      for (const record of records) {
        if (record && statuses.includes(record.status)) count += 1
      }
      return count
    }

    function statCounts(records, stats) {
      const computed = { total: records.length, working: 0, waiting: 0, installed: 0 }
      for (const record of records) {
        const status = recordStatus(record)
        if (WORKING_STATUSES.includes(status)) computed.working += 1
        else if (WAITING_STATUSES.includes(status)) computed.waiting += 1
        else if (status === 'installed') computed.installed += 1
      }
      const pick = (key) => (stats && finite(stats[key]) ? stats[key] : computed[key])
      return {
        total: pick('total'),
        working: pick('working'),
        waiting: pick('waiting'),
        installed: pick('installed'),
      }
    }

    function KeeperPanel(props) {
      const sourceT = props.sourceT
      const ctx = props.ctx
      const t = React.useMemo(() => createTranslator(sourceT), [sourceT])
      const keeper = useKeeperState()
      const payload = keeper.data && typeof keeper.data === 'object' ? keeper.data : null
      const rawRecords = payload && Array.isArray(payload.records) ? payload.records : []
      const records = React.useMemo(
        () =>
          rawRecords
            .filter((record) => record && typeof record === 'object' && nonEmpty(record.id))
            .slice()
            .sort((left, right) => {
              const leftAt = timestampOf(left.updatedAt) || timestampOf(left.createdAt)
              const rightAt = timestampOf(right.updatedAt) || timestampOf(right.createdAt)
              return rightAt - leftAt
            }),
        [rawRecords],
      )
      const ledgerEntries = payload && Array.isArray(payload.history) ? payload.history : []
      const stats = payload && payload.stats && typeof payload.stats === 'object' ? payload.stats : null
      const counts = statCounts(records, stats)
      const [filter, setFilter] = React.useState('all')
      const [selectedId, setSelectedId] = React.useState(null)
      const [detailRevision, setDetailRevision] = React.useState(0)
      const [listFeedback, setListFeedback] = React.useState(null)
      const [pendingCard, setPendingCard] = React.useState(null)
      const pendingCardRef = React.useRef(null)
      const pageRef = React.useRef(null)
      const detailRef = React.useRef(null)
      const load = keeper.reload

      const refreshAll = React.useCallback(() => {
        void load(false)
        setDetailRevision((value) => value + 1)
      }, [load])

      const handleCreated = React.useCallback(() => {
        refreshAll()
      }, [refreshAll])

      const handleOpen = React.useCallback((recordId) => {
        if (!nonEmpty(recordId)) return
        setSelectedId(recordId)
      }, [])

      const handleBack = React.useCallback(() => {
        setSelectedId(null)
      }, [])

      React.useEffect(() => {
        if (!nonEmpty(selectedId)) return undefined
        const onKeyDown = (event) => {
          if (event.key !== 'Escape') return
          event.preventDefault()
          setSelectedId(null)
        }
        window.addEventListener('keydown', onKeyDown)
        return () => {
          window.removeEventListener('keydown', onKeyDown)
        }
      }, [selectedId])

      React.useEffect(() => {
        const node = pageRef.current
        if (!nonEmpty(selectedId) || !node) return
        try {
          if (typeof node.scrollTo === 'function') node.scrollTo({ top: 0, behavior: 'auto' })
          else node.scrollTop = 0
        } catch (error) {
          node.scrollTop = 0
        }
      }, [selectedId])

      React.useEffect(() => {
        const node = detailRef.current
        if (!nonEmpty(selectedId) || !node || typeof node.focus !== 'function') return
        node.focus()
      }, [selectedId])

      const handleCardPrimary = React.useCallback(
        async (summary) => {
          if (!summary || !nonEmpty(summary.id) || pendingCardRef.current) return
          const action = nonEmpty(summary.primaryAction) ? summary.primaryAction : 'none'
          if (action === 'none') return
          if (action === 'review') {
            setSelectedId(summary.id)
            return
          }
          pendingCardRef.current = summary.id
          setPendingCard({ id: summary.id, action })
          setListFeedback(null)
          try {
            if (action === 'install') {
              const result = await apiPost({ action: 'install', id: summary.id })
              const feedback = installFeedback(t, result)
              setListFeedback({ tone: 'ok', message: feedback.message, warnings: feedback.warnings })
            } else if (action === 'work' || action === 'complete' || action === 'build') {
              const launched = await claimAndLaunch(ctx, summary.id, action)
              setListFeedback({
                tone: 'ok',
                message: launched.mode === 'draft' ? t('sessionDraftHint') : t('sessionStarted'),
                warnings: [],
              })
            }
          } catch (error) {
            setListFeedback({
              tone: 'error',
              message: t('actionFailed', { message: describeError(t, error) }),
              warnings: [],
            })
          } finally {
            pendingCardRef.current = null
            setPendingCard(null)
            // Even a failed card action may have changed the record on the Host.
            refreshAll()
          }
        },
        [ctx, refreshAll, t],
      )

      const detailOpen = nonEmpty(selectedId)
      const selectedSummary = detailOpen ? records.find((record) => record.id === selectedId) || null : null
      const syncKey = selectedSummary ? timestampOf(selectedSummary.updatedAt) : 0
      const visible = useFilteredRecords(records, filter)
      const filteredEmpty = visible.length === 0
      const showOnboardingEmpty = filteredEmpty && records.length === 0

      const detail = detailOpen
        ? h(
            'div',
            {
              className: 'ps-detail-wrap',
              ref: detailRef,
              tabIndex: -1,
            },
            h(RecordDetail, {
              t,
              ctx,
              id: selectedId,
              summary: selectedSummary,
              revision: detailRevision,
              syncKey,
              onMutated: refreshAll,
              onBack: handleBack,
            }),
          )
        : null

      const listArea = h(
        'section',
        { className: 'ps-list-section' },
        h(
          'div',
          { className: 'ps-tabs', role: 'tablist', 'aria-label': t('tabsLabel') },
          FILTER_ORDER.map((key) =>
            h(
              'button',
              {
                key,
                type: 'button',
                role: 'tab',
                'aria-selected': filter === key,
                className: `ps-tab${filter === key ? ' ps-tab-on' : ''}`,
                onClick: () => setFilter(key),
              },
              t(FILTER_KEYS[key]),
              h('span', { className: 'ps-tab-count' }, String(countForFilter(records, key))),
            ),
          ),
        ),
        listFeedback
          ? h(
              'div',
              { className: `ps-feedback${listFeedback.tone === 'error' ? ' ps-feedback-error' : ''}`, role: listFeedback.tone === 'error' ? 'alert' : 'status' },
              h('span', { className: 'ps-feedback-text' }, listFeedback.message),
              listFeedback.warnings && listFeedback.warnings.length > 0
                ? h('ul', { className: 'ps-warnings' }, listFeedback.warnings.map((warning, index) => h('li', { key: `card-warning-${index}` }, warning)))
                : null,
            )
          : null,
        filteredEmpty
          ? h(EmptyState, { t, filtered: !showOnboardingEmpty, showGlyph: showOnboardingEmpty })
          : h(
              'div',
              { className: 'ps-list' },
              visible.map((summary) =>
                h(RecordCard, {
                  key: summary.id,
                  t,
                  summary,
                  pending: pendingCard !== null && pendingCard.id === summary.id,
                  onOpen: handleOpen,
                  onPrimary: handleCardPrimary,
                }),
              ),
            ),
      )

      return h(
        'div',
        { className: 'ps-page', ref: pageRef },
        h('style', null, STYLES),
        h(
          'div',
          { className: 'ps-shell' },
          h(PageHeader, {
            t,
            updatedAt: keeper.updatedAt,
            busy: keeper.busy,
            onRefresh: () => {
              void load(true)
            },
          }),
          h('div', { className: 'ps-head-accent', 'aria-hidden': true }),
          detailOpen ? null : h(StatsRow, { t, counts }),
          detailOpen ? null : h(IntakeCard, { t, onCreated: handleCreated }),
          keeper.error
            ? h(ErrorBar, {
                message: t('errorLoad', { message: describeError(t, keeper.error) }),
                retryLabel: t('retry'),
                onRetry: () => {
                  void load(true)
                },
              })
            : null,
          !payload && keeper.loading ? h('div', { className: 'ps-state' }, t('loading')) : detailOpen ? detail : listArea,
          !detailOpen && payload ? h(Ledger, { t, entries: ledgerEntries }) : null,
        ),
      )
    }

    return {
      /** Client services this plugin needs before it may activate. */
      inject: ['slots', 'locale'],
      apply(ctx) {
        ctx.effect(() => ctx.locale.register(NS, DICTIONARIES), 'dsh-plugin-keeper: dictionaries')
        const t = createTranslator(ctx.locale.bind(NS))

        ctx.slots.inject('sidebar.panellist', () =>
          ctx.slots.register(
            {
              name: 'sidebar.panellist',
              id: PANEL_ID,
              order: 30,
              label: () => t('panel'),
              locale: NS,
            },
            KeeperIcon,
          ),
        )

        ctx.slots.inject('main', () =>
          ctx.slots.register(
            {
              name: 'main',
              key: PANEL_ID,
              locale: NS,
            },
            // `t` is bound once here (stable identity) so poll ticks never
            // re-render the memoized intake card.
            () => h(KeeperPanel, { sourceT: t, ctx }),
          ),
        )

        // Second entrance: a tab on the shipped Plugins page, rendering the same
        // panel component as the main slot.
        ctx.slots.inject('plugins.tab', () =>
          ctx.slots.register(
            {
              name: 'plugins.tab',
              id: `${PANEL_ID}-tab`,
              order: 20,
              label: () => t('pluginsTab'),
              locale: NS,
            },
            (slotProps) =>
              h(KeeperPanel, {
                sourceT: slotProps && typeof slotProps.t === 'function' ? slotProps.t : t,
                ctx,
              }),
          ),
        )
      },
    }
  },
})
