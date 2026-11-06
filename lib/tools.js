/**
 * `plugin_scout` — the agent-facing half of the keeper.
 *
 * One tool, many actions. A separate tool per stage would bloat every prompt and
 * hide the order that makes the flow safe; one tool with a small action enum
 * keeps the manual in the description and lets the model write each stage's
 * evidence back in the same place the panel reads it.
 *
 * The tool cannot install on its own: `install` delegates to the Host service,
 * which answers `requiresUserConfirmation` until the user has clicked install in
 * the panel. That is deliberate.
 */

import { recommendationOf } from './pipeline.js'
import { nextStepOf } from './service.js'
import { asArray, truncate } from './util.js'

const DESCRIPTION = [
  'Plugin Keeper: turn a plugin need into an audited, gap-closed, tested installation record.',
  '',
  'Use this whenever the user wants a plugin, a capability, or an upgrade to an existing plugin. One record carries the whole story;',
  'the panel (sidebar 「插件管家」) shows the same record, so never keep findings only in chat.',
  '',
  'Workflow — write each stage back before moving on:',
  '1. intake: create the record from the user requirement (text), and split the requirement into capabilities/constraints.',
  '2. candidates: search the plugin market, npm, GitHub and community signals; record at least 2–3 candidates with fit/quality/maintenance/risk scores.',
  '3. audit: pass path for a local package directory (static supply-chain scan) or package_name for a registry package. For registry packages',
  '   the tool downloads the published tarball and scans its source (source-level static audit; pass source:false to stay metadata-only).',
  '   With sandbox:true (or depth=deep) it also materializes the package in a throwaway directory with lifecycle scripts disabled and proves the',
  '   resulting digest matches the audited tarball, then deletes it — isolated trial install, no profile change, no package code executed.',
  '   Unsafe candidates (verdict=unsafe, or score<60) must be dropped, not installed.',
  '4. blood: judge every required capability present/partial/missing and list gaps. kind=cut means the package is intentionally cut down',
  '   (paid tier, removed feature); incomplete means half-built; stale means broken compatibility; integration means it misses a channel; ux means unusable.',
  '   A cut-down or incomplete package MUST NOT be installed as-is: decide complete-then-install or build.',
  '5. decide: kind=install (full-blood + safe), complete-then-install (safe but has gaps), build (nothing usable), reject (evidence says stop).',
  '6. verify: pass path for a local bundle to run the automated L0 gate (manifest, patch, JS syntax) and optional L1 tests;',
  '   append L3+ checks with concrete evidence. A failed gate blocks the install.',
  '7. install: only after the user clicked install in the panel; the host inspects, installs, confirms L2 load, and writes the ledger.',
  '8. amend: when the user adds or changes a requirement on an existing record, call amend({id, text}); it appends a revision,',
  '   invalidates the old decision, marks the gap analysis stale, and moves the record back to decision. Then call blood with',
  '   next_round:true against the new requirement and decide again. Never decide or install on a stale gap analysis.',
  '',
  'Hard rules: never install without an audit; never install a record whose blood label is thin/cut; keep upstream attribution and license when',
  'forking or completing a package; the install action is user-gated and returns requiresUserConfirmation until the panel click happens.',
].join('\n')

const OUTPUT = {
  schema: { type: 'object', additionalProperties: true },
  render: (_args, value) => [{ type: 'text', text: JSON.stringify(value) }],
}

const ACTIONS = [
  'intake',
  'get',
  'amend',
  'update',
  'candidates',
  'audit',
  'blood',
  'decide',
  'verify',
  'install',
  'rollback',
  'history',
  'claim_session',
]

export function createScoutTool(service) {
  return {
    name: 'plugin_scout',
    description: DESCRIPTION,
    parameters: {
      type: 'object',
      properties: {
        action: { type: 'string', enum: ACTIONS, description: 'Stage to run.' },
        id: { type: 'string', description: 'Record id (sc-…). Required except for intake/get-all/history.' },
        text: { type: 'string', description: 'intake: the user requirement in their own words.' },
        depth: { type: 'string', enum: ['quick', 'standard', 'deep'], description: 'intake: how deep to search.' },
        patch: {
          type: 'object',
          description: 'update: partial fields, e.g. {intent:{capabilities:[…],constraints:[…]}} or {status:"scouting",statusReason:"…",bundlePath:"…"}.',
          additionalProperties: true,
        },
        candidates: {
          type: 'array',
          description: 'candidates: [{name, version?, spec?, source, repository?, homepage?, license?, description?, fitScore?, qualityScore?, maintenanceScore?, riskScore?, notes?}]',
          items: { type: 'object', additionalProperties: true },
        },
        select: { type: 'string', description: 'candidates: name of the candidate to select (default: the first one).' },
        path: { type: 'string', description: 'audit/verify: local package or bundle directory (absolute, or relative to the session cwd).' },
        package_name: { type: 'string', description: 'audit: registry package name to audit from metadata.' },
        registry: { type: 'string', description: 'audit: npm registry URL (optional).' },
        max_files: { type: 'integer', description: 'audit: file scan cap (default 600).' },
        gaps: {
          type: 'array',
          description: 'blood: [{capability, state:"partial"|"missing", kind:"cut"|"incomplete"|"stale"|"integration"|"ux"|"unknown", evidence, remedy, effort:"S"|"M"|"L", risk:"low"|"medium"|"high"}]',
          items: { type: 'object', additionalProperties: true },
        },
        next_round: {
          type: 'boolean',
          description: 'blood: record this as a NEW gap-analysis round after a requirement amendment (round+1); omit to refine the current round.',
        },
        note: { type: 'string', description: 'amend: optional short note explaining the addition.' },
        score: { type: 'integer', description: 'blood: explicit 0–100 score; omitted means derived from gaps.' },
        label: { type: 'string', enum: ['full', 'thin', 'cut'], description: 'blood: explicit label; evidence may only downgrade it.' },
        summary: { type: 'string', description: 'blood: one-paragraph verdict for the panel.' },
        kind: {
          type: 'string',
          enum: ['install', 'complete-then-install', 'build', 'reject'],
          description: 'decide: recommended decision already computed in the result.',
        },
        rationale: { type: 'string', description: 'decide: why this decision follows from the evidence (required).' },
        plan: {
          type: 'object',
          description: 'decide: {steps:[…], effort, risks:[…], acceptCriteria:[…], upstream:{repo, fork, attribution, licenseNote}}',
          additionalProperties: true,
        },
        force: { type: 'boolean', description: 'Override a soft gate; the override is recorded. Never use it to install a thin/cut candidate.' },
        source: {
          type: 'boolean',
          description: 'audit: also download the published tarball and statically scan its source (default true for registry candidates; nothing is installed or executed).',
        },
        sandbox: {
          type: 'boolean',
          description:
            'audit: also materialize the candidate in a throwaway directory with lifecycle scripts disabled, prove its digest matches the audited tarball, then delete it (isolated trial install; never touches the profile). Auto-on for depth=deep.',
        },
        run_tests: { type: 'boolean', description: 'verify: also run the bundle’s own test suite (L1).' },
        checks: {
          type: 'array',
          description: 'verify: extra evidence checks [{level:"L3"|"L4"|"L5", name, status:"pass"|"fail"|"skip", detail}]',
          items: { type: 'object', additionalProperties: true },
        },
        session_id: { type: 'string', description: 'claim_session: session id working on this record.' },
        limit: { type: 'integer', description: 'get/history: max rows (default 20).' },
      },
      required: ['action'],
      additionalProperties: false,
    },
    output: OUTPUT,
    execute: async (args, exec) => {
      try {
        return await run(service, args ?? {}, exec)
      } catch (error) {
        return { ok: false, error: error instanceof Error ? error.message : String(error), recommended: error?.recommended ?? null }
      }
    },
  }
}

async function run(service, args, exec) {
  const action = String(args.action ?? '')
  const id = typeof args.id === 'string' ? args.id : ''
  switch (action) {
    case 'intake': {
      const result = await service.intake(args.text, {
        depth: args.depth,
        sessionId: sessionIdOf(exec),
      })
      return {
        ok: true,
        record: compact(result.record),
        next: 'Split this requirement into capabilities, then call action=candidates with at least 2–3 candidates.',
      }
    }
    case 'get': {
      if (id) {
        const result = await service.detail(id)
        return {
          ok: true,
          record: compact(result.record),
          brief: result.brief,
          recommendation: recommendationOf(result.record),
          next: nextStepOf(result.record),
        }
      }
      const state = await service.state()
      return {
        ok: true,
        dataDir: state.dataDir,
        stats: state.stats,
        records: state.records.slice(0, args.limit ?? 20),
      }
    }
    case 'amend': {
      const result = await service.amend(id, args.text, {
        note: args.note,
        actor: 'agent',
      })
      const record = result.record
      return {
        ok: true,
        record: compact(record),
        revision: result.revision,
        needsRegap: result.needsRegap === true,
        next:
          'The requirement revision invalidated the old decision. Run action=blood with next_round:true against the new requirement, then decide again.',
      }
    }
    case 'update': {
      const result = await service.update(id, args.patch ?? {})
      return { ok: true, record: compact(result.record), recommendation: result.recommendation, next: nextStepOf(result.record) }
    }
    case 'candidates': {
      const result = await service.upsertCandidates(id, args.candidates, { select: args.select })
      return {
        ok: true,
        record: compact(result.record),
        selected: result.candidate,
        recommendation: result.recommendation,
        next: 'Audit the selected candidate: action=audit with path (local) or package_name (registry).',
      }
    }
    case 'audit': {
      const result = await service.audit(id, {
        path: args.path,
        packageName: args.package_name,
        registry: args.registry,
        maxFiles: args.max_files,
        source: args.source,
        sandbox: args.sandbox,
      })
      return {
        ok: true,
        audit: result.audit,
        auditScope: result.auditScope,
        evidenceLevel: result.audit?.evidenceLevel ?? null,
        package: result.evidencePackage,
        community: result.community,
        recommendation: result.recommendation,
        next: result.audit?.verdict === 'unsafe' ? 'Drop this candidate; audit another one or decide build.' : 'Run action=blood with per-capability evidence.',
      }
    }
    case 'blood': {
      const result = await service.blood(id, {
        gaps: args.gaps,
        score: args.score,
        label: args.label,
        summary: args.summary,
        nextRound: args.next_round === true,
      })
      return {
        ok: true,
        blood: result.record.blood,
        recommendation: result.recommendation,
        next: 'Call action=decide with the recommendation as the starting point, or justify a different kind.',
      }
    }
    case 'decide': {
      const result = await service.decide(id, {
        kind: args.kind,
        rationale: args.rationale,
        plan: args.plan,
        force: args.force === true,
      })
      return {
        ok: true,
        decision: result.record.decision,
        status: result.record.status,
        warnings: result.warnings,
        recommendation: result.recommendation,
        next: result.record.decision?.kind === 'install'
          ? 'Ask the user to click install in the panel (install is user-gated), or verify a local bundle first.'
          : 'Start the working session (claim_session) or hand the plan back to the user.',
      }
    }
    case 'verify': {
      const result = await service.verify(id, {
        path: args.path,
        runTests: args.run_tests === true,
        checks: args.checks,
      })
      return {
        ok: true,
        verification: result.verification,
        status: result.record.status,
        next: result.verification.passed
          ? 'Passed. For a completed/forked bundle call decide again with kind=install so the record enters the install review.'
          : 'Fix the failed checks, then verify again. Do not install.',
      }
    }
    case 'install': {
      const result = await service.install(id, { via: 'tool' })
      return {
        ok: result.ok,
        requiresUserConfirmation: result.requiresUserConfirmation === true,
        record: result.record ? compact(result.record) : null,
        application: result.application ?? null,
        warnings: result.warnings ?? [],
        error: result.error ?? null,
        next: result.requiresUserConfirmation
          ? 'Tell the user: open 「插件管家」 and click install on this record. Then the host installs and records L2.'
          : result.ok ? 'Installed and confirmed. Report the outcome with the record id.' : 'Inspect the error and fix the gate before retrying.',
      }
    }
    case 'rollback': {
      const result = await service.rollback(id)
      return { ok: result.ok, record: compact(result.record), error: result.error ?? null }
    }
    case 'history': {
      const result = await service.history()
      return { ok: true, entries: result.entries.slice(0, args.limit ?? 20) }
    }
    case 'claim_session': {
      const result = await service.claimSession(id, args.patch?.kind ?? 'work', args.session_id)
      return { ok: true, record: compact(result.record), brief: result.brief }
    }
    default:
      return { ok: false, error: `Unknown action: ${action}. Use one of: ${ACTIONS.join(', ')}` }
  }
}

function compact(record) {
  if (!record) return null
  return {
    id: record.id,
    title: record.intent.title,
    status: record.status,
    statusReason: record.statusReason,
    depth: record.intent.depth,
    intent: {
      text: truncate(record.intent.text, 1600),
      capabilities: record.intent.capabilities,
      constraints: record.intent.constraints,
      rev: record.intent.rev,
      revisions: asArray(record.intent.revisions).slice(-6).map((revision) => ({
        rev: revision.rev,
        at: revision.at,
        source: revision.source,
        text: truncate(revision.text, 500),
        note: revision.note ?? null,
      })),
    },
    gapRound: record.blood?.round ?? 0,
    bloodRounds: asArray(record.bloodRounds).slice(-4),
    candidate: record.candidate
      ? {
          name: record.candidate.name,
          version: record.candidate.version,
          spec: record.candidate.spec,
          source: record.candidate.source,
          license: record.candidate.license,
          repository: record.candidate.repository,
          fitScore: record.candidate.fitScore,
          qualityScore: record.candidate.qualityScore,
          maintenanceScore: record.candidate.maintenanceScore,
          riskScore: record.candidate.riskScore,
          notes: truncate(record.candidate.notes ?? '', 600),
        }
      : null,
    candidateCount: asArray(record.candidates).length,
    candidates: asArray(record.candidates).slice(0, 10).map((candidate) => ({
      name: candidate.name,
      version: candidate.version,
      source: candidate.source,
      fitScore: candidate.fitScore,
      qualityScore: candidate.qualityScore,
      maintenanceScore: candidate.maintenanceScore,
      riskScore: candidate.riskScore,
      license: candidate.license,
    })),
    audit: record.audit
      ? {
          score: record.audit.score,
          verdict: record.audit.verdict,
          evidenceLevel: record.audit.evidenceLevel,
          target: record.audit.target,
          permissions: record.audit.permissions,
          findings: record.audit.findings.slice(0, 20).map((finding) => ({
            severity: finding.severity,
            kind: finding.kind,
            title: finding.title,
            file: finding.file ?? null,
            line: finding.line ?? null,
            detail: truncate(finding.detail, 300),
          })),
          community: record.audit.community ?? null,
        }
      : null,
    blood: record.blood,
    decision: record.decision,
    execution: record.execution
      ? {
          kind: record.execution.kind,
          bundlePath: record.execution.bundlePath,
          sessionId: record.execution.sessionId,
          steps: record.execution.steps.slice(-10),
        }
      : null,
    verification: record.verification
      ? {
          passed: record.verification.passed,
          gate: record.verification.gate,
          checks: record.verification.checks.map((check) => ({
            level: check.level,
            name: check.name,
            status: check.status,
            detail: truncate(check.detail, 300),
          })),
        }
      : null,
    install: record.install,
    approval: record.approval,
    recommendation: recommendationOf(record),
    next: nextStepOf(record),
    history: asArray(record.history).slice(-12),
    notes: asArray(record.notes).slice(-8),
  }
}

function sessionIdOf(exec) {
  try {
    const id = exec?.agent?.id ?? exec?.sessionId ?? exec?.agentId
    return typeof id === 'string' ? id : undefined
  } catch {
    return undefined
  }
}
