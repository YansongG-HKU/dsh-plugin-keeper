# Plugin Keeper — frozen panel contract (V1)

This file is the contract between the Host half (`index.js`, `lib/*`) and the Client half
(`client.js`). The Host half implements it; the Client half consumes it. Keys below are frozen
for V1: do not rename, and tolerate missing optional fields.

## Identity

| thing | value |
|---|---|
| package name / module id | `dsh-plugin-keeper` |
| panel id (sidebar + main key) | `dsh-plugin-keeper` |
| route prefix | `/plugin-keeper` |
| request header the client must send | `x-plugin-keeper: 1` |
| locale namespace (client) | `dshPluginKeeper` |
| accent | amber `#e08a2e` / `#f7b955` |

## Endpoints

All are same-origin loopback only. The client sends `x-plugin-keeper: 1` on every request; the host
answers 403 without it. JSON in, JSON out.

### `GET /plugin-keeper/api/state`

```json
{
  "ok": true,
  "generatedAt": 1762300000000,
  "dataDir": "C:\\Users\\<user>\\.dsh\\plugin-keeper",
  "stats": { "total": 3, "working": 1, "waiting": 1, "installed": 1, "blocked": 0, "archived": 0 },
  "records": [Summary],
  "history": [InstallHistoryEntry]
}
```

`Summary`:

```ts
{
  id: string                  // "sc-20261105-153012-ab12"
  title: string               // short display title (host-truncated from intent)
  intent: string              // the raw user requirement
  status: Status
  bloodLabel: 'full'|'thin'|'cut'|'unknown'|null
  bloodScore: number|null     // 0..100
  auditScore: number|null     // 0..100, higher = safer
  auditVerdict: 'safe'|'caution'|'unsafe'|'unknown'|null
  evidenceLevel: string|null
  candidateName: string|null
  candidateCount: number
  createdAt: number
  updatedAt: number
  sessionId: string|null
  installable: boolean        // host allows the install action now
  primaryAction: 'work'|'review'|'install'|'complete'|'build'|'none'
  intentRev: number           // requirement revision (starts at 1)
  revisionCount: number       // number of requirement revisions
  gapRound: number            // 1-based gap-analysis round
  bloodStale: boolean         // requirement changed after the last gap analysis
  decisionStale: boolean      // decision was made for an older revision / stale gaps
}
```

`InstallHistoryEntry`:

```ts
{ recordId, title, at, spec, application, version, bundle, rollbackName }
```

### `GET /plugin-keeper/api/record?id=<recordId>`

```json
{ "ok": true, "record": Record, "brief": "markdown brief for a new working session" }
```

`Record` (all optional fields may be `null`):

```ts
{
  id: string, createdAt: number, updatedAt: number,
  intent: {
    text: string, title: string, capabilities: string[], constraints: string[],
    depth: 'quick'|'standard'|'deep',
    rev: number,                                   // current requirement revision
    revisions: Array<{                             // append-only requirement history
      rev: number, at: number, text: string, source: 'user'|'agent',
      capabilities: string[], constraints: string[],
      note?: string|null
    }>
  },
  status: Status, statusReason: string|null,
  candidate: Candidate|null, candidates: Candidate[],
  audit: Audit|null, blood: Blood|null, bloodRounds: Array<{ round: number, at: number, score: number|null, label: string, gapCount: number }>, decision: Decision|null,
  execution: Execution|null, verification: Verification|null, install: InstallRecord|null,
  approval: { via: 'panel'|'tool', at: number }|null,
  links: { sessionIds: string[] },
  notes: Array<{ at: number, text: string, actor: 'user'|'agent'|'host' }>,
  history: Array<{ at: number, kind: string, detail: string }>
}
```

`Status` = `intake | scouting | auditing | decision | awaiting-approval | executing | verifying | ready | installed | blocked | rejected | archived`

`Candidate`:

```ts
{
  name: string, version?: string, spec?: string,
  source: 'market'|'npm'|'github'|'local'|'manual',
  repository?: string, homepage?: string, license?: string, description?: string,
  capabilities: Array<{ id: string, state: 'present'|'partial'|'missing'|'unknown', evidence?: string }>,
  fitScore?: number, qualityScore?: number, maintenanceScore?: number, riskScore?: number,
  notes?: string, addedAt: number
}
```

`Audit`:

```ts
{
  score: number, verdict: 'safe'|'caution'|'unsafe'|'unknown',
  evidenceLevel: 'static'|'sandbox'|'behavioral'|'none',
  scope: 'source'|'metadata'|null,
  target: string, findings: Finding[],
  permissions: {
    installScripts: boolean, network: string[], childProcess: boolean, eval: boolean,
    filesystemWrite: boolean, credentials: boolean, obfuscated: boolean,
    nativeAddons: boolean, patchesShippedRows: boolean, sparseSource: boolean
  },
  stats: { files: number, bytes: number, dependencies: number, scannedAt: number },
  // Present when the audit produced a content digest of what it inspected.
  // The Host compares it with the installed package after install (L4).
  digest?: string, digestFiles?: number, digestTruncated?: true,
  // Present when an isolated trial install ran (sandbox evidence level).
  sandbox?: {
    ok: boolean, scriptsDisabled: boolean, digestMatch: boolean|null,
    packageName: string|null, version: string|null, files: number|null, ms: number|null,
    error?: string
  }
}
```

`Finding`:

```ts
{ id: string, severity: 'critical'|'high'|'medium'|'low'|'info', kind: string,
  title: string, detail: string, file?: string, line?: number, evidence?: string }
```

`Blood` (满血 / 残血 / 阉割):

```ts
{
  score: number, label: 'full'|'thin'|'cut'|'unknown', summary: string,
  round: number,       // 1-based gap-analysis round
  stale: boolean,      // requirement changed after this analysis
  gaps: Array<{
    id: string, capability: string, state: 'partial'|'missing',
    kind: 'cut'|'incomplete'|'stale'|'integration'|'ux'|'unknown',
    evidence: string, remedy: string, effort: 'S'|'M'|'L', risk: 'low'|'medium'|'high'
  }>
}
```

`Decision`:

```ts
{
  kind: 'install'|'complete-then-install'|'build'|'reject', rationale: string, at: number,
  intentRev: number,   // the requirement revision this decision was made for
  plan: null | {
    steps: string[], effort: 'S'|'M'|'L', risks: string[],
    upstream?: { repo?: string, fork: boolean, attribution: string, licenseNote: string },
    acceptCriteria: string[]
  }
}
```

`Execution`:

```ts
{ kind: 'install'|'complete'|'build'|'gap', startedAt: number, bundlePath: string|null,
  sessionId: string|null, steps: Array<{ at: number, text: string, done: boolean }> }
```

`Verification`:

```ts
{ passed: boolean, gate: 'L0'|'L1'|'L2'|'L3'|'L4'|'L5'|'none', at: number,
  checks: Array<{ level: 'L0'|'L1'|'L2'|'L3'|'L4'|'L5', name: string,
                  status: 'pass'|'fail'|'skip', detail: string, at: number }> }
```

`InstallRecord`:

```ts
{ spec: string, at: number, application: 'applied'|'restart-required'|'overridden'|'failed'|'cancelled',
  version?: string, bundle?: string, warnings: string[], evidenceHash?: string,
  rollback: { kind: 'remove-bundle', name: string }|null }
```

### `POST /plugin-keeper/api/action`

Body: `{ action, ...args }`. Always answers `{ "ok": true, ... }` or `{ "ok": false, "error": "..." }`.

| action | args | result |
|---|---|---|
| `intake` | `text`, `depth?` (`quick\|standard\|deep`, default `standard`) | `{ ok, record }` — used by the intake box |
| `install` | `id` | `{ ok, record, application, warnings }` — host runs the real bundle install |
| `rollback` | `id` | `{ ok, record }` |
| `archive` | `id` | `{ ok, record }` |
| `reopen` | `id` | `{ ok, record }` |
| `reject` | `id`, `reason?` | `{ ok, record }` |
| `note` | `id`, `text` | `{ ok, record }` |
| `set-depth` | `id`, `depth` | `{ ok, record }` |
| `amend` | `id`, `text`, `note?` | `{ ok, record }` — append a requirement revision; invalidates the old decision and marks the gap analysis stale |
| `claim-session` | `id`, `kind` (`work\|complete\|build\|gap`), `sessionId?` | `{ ok, record, brief }` — host marks `execution` and returns the brief to send |

The client must call `claim-session` before it opens a session, then send the returned `brief` as
the first prompt.

`Summary.installable` is the authoritative visibility rule for the install control: a record with
`blood.label !== 'full'`, an `unsafe` audit, a failed verification, or no `spec` is not installable.
`approval` is written only by the panel's install action; the Host refuses an agent-driven install
until `approval.via === 'panel'` exists (the model receives `requiresUserConfirmation`).

## Client UI requirements

- Register `sidebar.panellist` entry `dsh-plugin-keeper` (order 30, label from locale, amber anvil/hammer glyph)
  and the `main` panel keyed `dsh-plugin-keeper`.
- One page, master–detail. Header: title 「插件管家」/“Plugin Keeper”, subtitle, four stat chips
  (总记录 / 进行中 / 待你拍板 / 已安装), refresh button, “每 3 秒自动刷新”.
- Intake card at the top: textarea, depth segmented control (`快筛` / `标准` / `深挖`), submit button.
  Enter with Ctrl/Cmd submits; plain Enter inserts a newline.
- Filter tabs: `全部 / 进行中 / 待你拍板 / 已安装 / 已拦截 / 已归档`, each with a count.
- Record cards: title, intent excerpt, status chip, blood chip (满血/残血/阉割 with score),
  audit score, candidate count, updated time, primary action button. Clicking the card body opens detail.
- Detail view: back button, title, record id, status chip; sections in this order:
  1. 需求 (raw text, capability chips, constraint chips, depth, revision badge `rev N`, revision list,
     an「补充需求」textarea + button that POSTs `amend`)
  2. 候选 (comparison table; the selected one marked)
  3. 审计 (score bar, verdict, evidence level, permission grid, findings list with severity badges)
  4. 血量与缺口 (round label `第 N 轮`, score, label, stale hint when `blood.stale`, gap cards,
     a「复查缺口」button that calls `claim-session` with `kind:'gap'`)
  5. 决策 (kind, rationale, plan steps, risks, accept criteria; a stale hint when `decisionStale`)
  6. 执行 (steps with done state, bundle path, “打开会话” when sessionId exists)
  7. 验收 (L0–L5 check rows + overall pass/fail)
  8. 安装记录 + 回滚
  9. 备注 (list + add note), 历史时间线
  10. Action bar: primary action from `primaryAction`, plus secondary buttons.
- Actions:
  - `install` → POST install, show returned `application` + warnings inline, refresh.
  - `work` / `complete` / `build` → POST `claim-session`, then start a session with the brief:
    try `ctx.sessions.create` if it exists, retain, `session.prompt([{type:'text',text:brief}], 'queue')`,
    then `ctx.uiWorkspace.openSession(id)`; otherwise fall back to
    `ctx.uiWorkspace.startSession(undefined, { prompt: brief, whenDraftExists: 'append' })`.
    Always show a hint when the brief lands as a draft.
  - `rollback` / `archive` / `reopen` / `reject` / `note` map straight to POST actions.
- Language: all visible text through the client locale dictionaries (`zh`, `en`), no hard-coded strings.
- Styling: only host theme tokens with neutral fallbacks; amber accent for the keeper identity;
  monospace (`ui-monospace, SFMono-Regular, Menlo, monospace`) for ids/scores/times; status colors:
  blue = working, amber = needs you, green = installed, red = blocked/rejected, gray = archived.
- States: loading, empty (with a short explanation of how the keeper works),
  error (show message + retry), and per-action pending/disabled states.
- Accessibility: focus-visible rings, `aria-label` on icon-only controls, Esc closes detail,
  `prefers-reduced-motion` respected, no layout jump on refresh.
- No JSX, no build step, no npm imports: `window.__ModuleLoader__.load({ id: 'dsh-plugin-keeper', factory(require) { … } })`,
  React via `require('react')`, `React.createElement`.
