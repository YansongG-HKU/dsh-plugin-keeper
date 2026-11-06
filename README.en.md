# Plugin Smith · dsh-plugin-smith

Turn one sentence of plugin need into one **reviewable installation record**: scout candidates → audit them → judge full-blood / thin / cut-down → close the gaps → test → let the user press install.

It is not a plugin store. A store is for browsing; the Smith is procurement + inspection + completion + acceptance. You say what you need; it finds, inspects, completes, or forges; the only decision left to you is whether to press install.

```
need ──▶ intake ──▶ scout ──▶ audit ──▶ blood/gaps ──▶ decide ──▶ execute ──▶ verify ──▶ install
          │          │         │            │             │          │          │          │
          └──────────┴─────────┴────────────┴─────────────┴──────────┴──────────┴──────────┘
                        one record, one evidence chain — live in the panel
```

## What it does

- **Scout**: plugin market indexes, npm, GitHub, and community signals (downloads, stars, last commit, maintainers), scored on fit / quality / maintenance / risk.
- **Audit**: local packages get a static supply-chain audit (install scripts, `eval`, child processes, network egress, filesystem writes, credential access, obfuscation, dependency surface, patch overrides of shipped rows). Registry packages get a metadata audit first (deprecation, install scripts, staleness, repository, license, adoption), then the published tarball is downloaded to a temporary directory, extracted, statically scanned at source level, and deleted — so a pre-install recommendation is no longer limited to metadata. If the download or extraction fails, the audit degrades to metadata level and says so in the record. Unsafe candidates are dropped.
- **Trial install** (sandbox evidence, automatic at depth=deep or with `sandbox:true`): the candidate is materialized in a throwaway directory by the profile's own pnpm with `--ignore-scripts`, its sha256 content digest is compared with the audited tarball, and the directory is deleted. The user's profile is never touched and no package script runs; the evidence level moves from `static` to `sandbox`.
- **Judge**: every required capability becomes present / partial / missing, with gaps classified as **cut** (paid tier, removed feature), **incomplete**, **stale**, **integration**, or **ux**, and a 0–100 blood score.
- **Complete**: a thin or cut-down package **may not be installed as-is**. The decision becomes `complete-then-install`: close the gap list, keep upstream attribution and license, re-verify, then enter install review.
- **Forge**: when nothing usable exists, `build` a DSH bundle from scratch, through the same gate.
- **Test**: L0 manifest/patch/JS syntax → L1 bundled tests → L2 real profile load confirmation → L3–L5 behavior / integrity / rollback evidence. Any failed level blocks installation.
- **Install**: only the user can press it. The Host inspects the spec, re-runs L0 for local bundles, confirms L2 from the profile's own inventory, and writes install history plus a rollback handle.
- **Record**: each need is one JSON record carrying candidates, findings (file/line/evidence), gaps, rationale, verification rows, install result, rollback, and the linked session.

## Two entry points, one record

1. **Panel**: sidebar “Plugin Smith” → type the need → intake. Progress, decisions, verification and install all live here.
2. **Session**: just ask “find me a plugin that can do X”. The model calls the `plugin_scout` tool, which creates the same record and runs the same pipeline; the panel reflects it live.

Both call the same Host service. There is no second implementation.

## Install

```bash
dsh plugin install <absolute path to this directory>
```

or let the Harness `plugin_manager` install it with `install_bundle`. Data lives in `$DSH_HOME/plugin-smith/` (`records.json`, `history.json`), overridable with `apply(ctx, { dataDir })`.

## The panel

Need box with three depths (quick / standard / deep); four stat chips; record cards with status, blood chip and score, audit score, candidate count, revision/gap-round badges and the primary action; a detail view with requirement and capability breakdown (plus a revision list and an 「补充需求」 box), candidate comparison, audit findings with evidence locations and a capability surface, blood gaps with remedies/effort/risk and a 「复查缺口」 button, decision and plan, execution progress, the L0–L5 verification table, install history and rollback, notes and timeline.

Install is a **user-only action**: the model calling `install` receives `requiresUserConfirmation` until the user clicks in the panel.

## Requirements evolve: amend and re-check

A record follows the requirement instead of freezing it:

1. At any stage you can 「补充需求」 in the detail view → the record moves to `rev N`, snapshotting the capability/constraint set; every addition stays in the history.
2. An amendment immediately invalidates the old decision and marks the gap analysis stale: `decision` is cleared, `blood.stale = true`, status returns to decision. The install gate refuses a decision made for an older revision and refuses a stale gap analysis.
3. 「复查缺口」 opens a session with a gap brief: re-judge every capability against the latest requirement, record round N+1 with `blood({next_round:true})`, then decide again — install when full-blood, complete-then-install when gaps remain, build when the shape is wrong.
4. Each round (score, label, gap count) is kept in `bloodRounds`, and the panel shows 「第 N 轮 · 复查」 so the growth of the requirement and every completion round stay reviewable.

## The `plugin_scout` tool

One tool, thirteen actions, with the operating manual in the description: `intake` · `get` · `amend` · `update` · `candidates` · `audit` · `blood` · `decide` · `verify` · `install` · `rollback` · `history` · `claim_session`.

## Hard rules (enforced in code)

1. No audit record → no install-type decision.
2. Audit `unsafe` or score < 60 → the Host refuses to install.
3. Blood label not `full` → `install` is refused; only `complete-then-install` or `build`.
4. Verification not passed → the Host refuses to install.
5. Install requires the user's panel click; a model cannot press it.
6. What gets installed must be what was audited: local bundles re-run L0, registry specs are inspected first, and after install the Host compares a sha256 content digest of the audited source with a fresh digest of the installed directory (L4); a mismatch fails the install and asks for a rollback.
7. **A requirement change invalidates evidence**: after `rev` moves, a decision made for an older revision (`decision.intentRev`) and a stale gap analysis (`blood.stale`) cannot be used; a new gap round and a new decision are required, and the Host enforces the same gate.
8. Every action is appended to the record history, including forced overrides and their reason.

## Tests

```bash
node --test "test/*.test.mjs"
```

Record model and projections, blood scoring, decision gates, state machine, persistence, audit engine, acceptance gate, registry source-level audit (local registry + real tarball extract/scan/cleanup), isolated trial install (local directory and HTTP tarball, scripts disabled, digest parity, temp cleanup), requirement amendments and multi-round gap re-checks (revision history, invalidated decisions, stale gates, `bloodRounds`, gap brief), the panel HTTP surface (mounts `apply()` and drives the real route with fake requests, including amend and `claim-session` with `kind:'gap'`), and the **full install chain L0→L2→L4→rollback L5** (equivalent profile directory plus a fake pluginManager, including tamper rejection and "the model cannot press install"). The per-requirement acceptance matrix is in [docs/ACCEPTANCE.md](docs/ACCEPTANCE.md).

## Known limits

- Static auditing proves “no obvious malicious pattern found”, not “safe”. The panel shows the evidence level (static / sandbox / behavioral) and the audit scope (source / metadata) and does not overclaim.
- Source-level audit covers npm-published tarballs; GitHub specs and private registries still use metadata or a local directory path. Tarballs over 30 MB, download failures, or extraction failures degrade to metadata level and record the reason.
- Sandbox evidence covers "materialized with lifecycle scripts disabled + digest parity"; it does not execute the candidate's code and does not boot a Harness. Runtime behavioral observation arrives in a later version.
- GitHub/npm data depends on network and rate limits; failures degrade the audit instead of failing the demand.

## License

MIT. Third-party licenses and attribution must be preserved when completing or forking a candidate; the record's `plan.upstream` requires them.
