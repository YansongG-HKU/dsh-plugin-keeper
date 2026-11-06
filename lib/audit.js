/**
 * Static supply-chain audit engine for Plugin Keeper.
 *
 * The engine answers one question before a third-party bundle is allowed near
 * the Harness: what can this package do once it is installed, judging only the
 * bytes that ship with it? Inspected code is never executed, symlinks are never
 * followed, and unreadable input never throws: missing directories, unreadable
 * files and binary files are skipped. `evidenceLevel` is therefore always
 * `'static'`.
 *
 * Precision policy (a wrong medium finding erodes trust in the panel):
 * - runtime source (`index.js`, `lib/…`, `src/…`) is scored in full;
 * - non-runtime paths (`test/`, `fixtures/`, `docs/`, `scripts/`, `verify/`,
 *   `tools/`, examples, `*.test.*`, `*.spec.*`, …) are recorded as `info`
 *   evidence only: such files are not loaded by the Host;
 * - keyword scans ignore JS comments;
 * - network hosts are only extracted from code literals actually passed to a
 *   network primitive (`fetch(`, `http.request`, `WebSocket(`, …); README,
 *   locale JSON and prose URLs are not capability evidence;
 * - credentials flag only explicit secret access plus one aggregated
 *   `process.env`-read info finding, never every occurrence of "token"/"key".
 *
 * Design constraints:
 * - dependency-free: Node builtins only (`node:fs/promises`, `node:path`);
 * - bounded: at most `maxFiles` files, each at most `maxBytes`, with `.git`,
 *   `node_modules` and `.pnpm` skipped;
 * - deterministic: paths are sorted, findings are sorted by severity/kind/file,
 *   and finding ids are assigned from that sort (identical input => identical
 *   output except `stats.scannedAt`);
 * - the return value is the frozen V1 `Audit` contract in docs/PANEL-API.md.
 */

import { readdir, readFile, stat } from 'node:fs/promises'
import { join, resolve } from 'node:path'

/** Fixed severity vocabulary, safest-to-worst source order for sorting. */
export const SEVERITY_ORDER = ['critical', 'high', 'medium', 'low', 'info']

/** Score weight of one finding, before the per-severity contribution cap. */
export const SEVERITY_WEIGHT = { critical: 45, high: 20, medium: 8, low: 3, info: 0 }

/** Maximum score deduction a whole severity band can contribute. */
const SEVERITY_CAP = { critical: 50, high: 30, medium: 16, low: 6, info: 0 }

const SEVERITY_RANK = new Map(SEVERITY_ORDER.map((severity, index) => [severity, index]))

const DEFAULT_MAX_FILES = 600
const DEFAULT_MAX_BYTES = 4 * 1024 * 1024
const EVIDENCE_LIMIT = 240
const BINARY_SNIFF_BYTES = 8192
const MAX_MATCHES_PER_PATTERN = 500
const MAX_FILES_PER_READDIR = 64
const MAX_LISTED_FILES = 8

const SKIP_DIRECTORIES = new Set(['.git', 'node_modules', '.pnpm'])

const CODE_EXTENSIONS = new Set([
  '.js', '.mjs', '.cjs', '.jsx', '.ts', '.mts', '.cts', '.tsx',
  '.py', '.rb', '.php', '.sh', '.bash', '.zsh', '.ps1',
  '.go', '.rs', '.java', '.kt', '.kts', '.cs', '.c', '.h', '.cc', '.cpp',
  '.lua', '.pl', '.swift',
])

const CONFIG_EXTENSIONS = new Set(['.json', '.yml', '.yaml', '.toml', '.ini', '.cfg', '.conf', '.env'])

/** Directories whose content is shipped/debug material, not Host runtime code. */
const NON_RUNTIME_SEGMENTS = new Set([
  'test', 'tests', '__tests__', 'spec', 'specs', 'fixtures', 'fixture',
  'docs', 'doc', 'examples', 'example', 'scripts', 'verify', 'tools',
  'benchmarks', 'benchmark', 'bench', 'demo', 'demos',
])

const INSTALL_HOOKS = [
  { hook: 'preinstall', severity: 'high' },
  { hook: 'install', severity: 'high' },
  { hook: 'postinstall', severity: 'high' },
  { hook: 'prepare', severity: 'medium' },
]

/** Install script that pipes remote content straight into an interpreter. */
const REMOTE_PIPE = /(?:curl|wget)\b[\s\S]{0,300}?\|\s*(?:sudo\s+)?(?:sh|bash|zsh|dash|node|python[0-9.]*|perl|ruby)\b/i

const LONG_LINE_LIMIT = 2000

const EVAL_PATTERNS = [
  /(?<![\w.$])eval\s*\(/g,
  /\bnew\s+Function\s*\(/g,
  /\b(?:vm\.)?runInNewContext\s*\(/g,
  /\b(?:vm\.)?runInThisContext\s*\(/g,
  /\bvm\.runInContext\s*\(/g,
]

/**
 * Child-process risk = an actual import of the module or a real call. A bare
 * `child_process` word (docs, rule tables, regex literals) is not execution.
 */
const CHILD_PROCESS_IMPORT_PATTERNS = [
  /\bfrom\s*['"](?:node:)?child_process['"]/g,
  /\brequire\s*\(\s*['"](?:node:)?child_process['"]\s*\)/g,
  /\bimport\s*\(\s*['"](?:node:)?child_process['"]\s*\)/g,
]

/**
 * Real child-process calls. `obj.exec(...)` / `regex.exec(...)` are method
 * calls, not process execution, so a preceding dot/identifier is excluded
 * (an imported `child_process.exec(...)` is caught by the import pattern).
 */
const CHILD_PROCESS_CALL_PATTERNS = [
  /(?<![.\w$])exec\s*\(/g,
  /(?<![.\w$])execSync\s*\(/g,
  /(?<![.\w$])execFile\s*\(/g,
  /(?<![.\w$])execFileSync\s*\(/g,
  /(?<![.\w$])spawn\s*\(/g,
  /(?<![.\w$])spawnSync\s*\(/g,
  /(?<![.\w$])fork\s*\(/g,
]

const FILE_WRITE_PATTERNS = [
  /\bwriteFile(?:Sync)?\s*\(/g,
  /\bappendFile(?:Sync)?\s*\(/g,
  /\bcreateWriteStream\s*\(/g,
  /\brm(?:Sync)?\s*\(/g,
  /\bunlink(?:Sync)?\s*\(/g,
  /\bchmod(?:Sync)?\s*\(/g,
  /\brmdir(?:Sync)?\s*\(/g,
]

/** Real telemetry wiring, not the prose words "telemetry"/"analytics". */
const TELEMETRY_PATTERNS = [
  /\bposthog\b/gi,
  /\bmixpanel\b/gi,
  /@sentry\//g,
  /\bSentry\s*\.\s*(?:init|captureException|captureMessage|captureEvent)\s*\(/g,
  /\banalytics\s*\.\s*(?:track|identify|page|ready|load)\s*\(/g,
  /(?<![\w.$])track\s*\(/g,
]

const NETWORK_CAPABILITIES = [
  { name: 'fetch(', pattern: /\bfetch\s*\(/g },
  { name: 'XMLHttpRequest', pattern: /\bXMLHttpRequest\b/g },
  { name: 'http.request', pattern: /\bhttps?\.(?:request|get)\s*\(/g },
  { name: 'net.connect', pattern: /\bnet\.(?:connect|createConnection)\s*\(/g },
  { name: 'WebSocket(', pattern: /\bWebSocket\s*\(/g },
  { name: 'dns.', pattern: /\bdns\.(?:lookup|resolve|resolve4|resolve6|reverse|lookupService)\s*\(/g },
]

/** Quoted absolute URL literal: group 1 quote, group 2 url. */
const URL_LITERAL = /(['"`])((?:https?:\/\/|wss?:\/\/)[^'"`\s]+)\1/g

/** `const API = 'https://…'`: group 1 identifier, group 3 url. */
const CONST_URL = /\b(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s*=\s*(['"`])((?:https?:\/\/|wss?:\/\/)[^'"`\s]+)\2/g

/** Env names that denote actual secret material (segment match). */
const SECRET_ENV_NAME = /(?:^|[_-])(?:SECRET|TOKENS?|PASSWORDS?|PASSWD|PASS|CREDENTIALS?|CREDS|API[_-]?KEY|PRIVATE[_-]?KEY|ACCESS[_-]?KEY|KEYS?|AUTH|AUTHORIZATION)(?:$|[_-])/i

/**
 * Credential rules. Each rule declares which mask it scans:
 * - `codeMask`: comments blanked, string contents visible (needed for import
 *   specifiers and quoted credential paths);
 * - `tokenMask`: comments AND string contents blanked (property access and
 *   identifier calls only), so a label such as `'.credentials'` inside a rule
 *   table or a template literal can never be mistaken for behaviour.
 * Matches on rule-definition lines are always discarded.
 */
const CREDENTIAL_RULES = [
  { label: 'process.env.<secret>', pattern: /process\.env\s*\.\s*([A-Za-z_$][\w$]*)/g, mask: 'codeMask', envName: true },
  { label: 'process.env[<secret>]', pattern: /process\.env\s*\[\s*['"`]([^'"`]+)['"`]\s*\]/g, mask: 'codeMask', envName: true },
  { label: '.credentials', pattern: /\.credentials\b/g, mask: 'tokenMask' },
  { label: 'credentials path', pattern: /['"`][^'"`\n]{0,160}\.credentials(?:\.(?:json|ya?ml|toml))?['"`]/gi, mask: 'codeMask', accessContext: true },
  { label: 'auth.json', pattern: /\bauth\.json\b/g, mask: 'codeMask', accessContext: true },
  { label: 'keychain/keytar', pattern: /\b(?:keychain|keytar)\b/gi, mask: 'tokenMask' },
  { label: 'keytar import', pattern: /(?:from|require\s*\()\s*['"](?:keytar|keychain)['"]/g, mask: 'codeMask' },
  { label: 'Authorization header', pattern: /\bAuthorization\b\s*[:=]/g, mask: 'tokenMask' },
]

/** `permissions.credentials` is a boolean flag, never secret material. */
const CREDENTIAL_FLAG_RECEIVER = /\b(?:permissions?|audit|audits|flags?|capabilities|capability|findings?|summary|records?|panel)\s*\.\s*credentials\b/

/** A quoted credential path only counts when a file/require API uses it. */
const ACCESS_CONTEXT_PATTERN = /\b(?:readFile|readFileSync|writeFile|writeFileSync|appendFile|appendFileSync|createReadStream|createWriteStream|open|openSync|existsSync|access|accessSync|join|resolve|dirname|basename|require|import|load|parse|stat|statSync|readdir|readdirSync|homedir|tmpdir)\b/

const ENV_READ_PATTERN = /process\.env\b/g

const NATIVE_TOOLING_DEPS = new Set([
  'node-gyp', 'bindings', 'nan', 'node-addon-api', 'node-pre-gyp', 'prebuild-install',
])

const PATCH_SECTION_KEYS = new Set(['insert', 'override', 'disable', 'disabled', 'replace', 'remove'])

/* ------------------------------------------------------------------ *
 * Small deterministic helpers
 * ------------------------------------------------------------------ */

function compareStrings(a, b) {
  if (a === b) return 0
  return a < b ? -1 : 1
}

function compareRelativePaths(a, b) {
  if (a === 'package.json') return b === 'package.json' ? 0 : -1
  if (b === 'package.json') return 1
  return compareStrings(a, b)
}

function severityRank(severity) {
  return SEVERITY_RANK.has(severity) ? SEVERITY_RANK.get(severity) : SEVERITY_ORDER.length
}

function normalizeLimit(value, fallback) {
  const number = Number(value)
  if (!Number.isFinite(number) || number <= 0) return fallback
  return Math.max(1, Math.trunc(number))
}

function truncateText(value, limit) {
  const text = String(value ?? '')
  return text.length > limit ? `${text.slice(0, limit - 1)}…` : text
}

function fitEvidence(value) {
  if (value === undefined || value === null) return ''
  const flat = String(value).replace(/\s+/g, ' ').trim()
  if (flat.length === 0) return ''
  return truncateText(flat, EVIDENCE_LIMIT)
}

function normalizeRelPath(value) {
  return String(value ?? '')
    .replace(/\\/g, '/')
    .replace(/^\.\//, '')
    .replace(/^\/+/, '')
}

function extensionOf(filePath) {
  const name = filePath.slice(filePath.lastIndexOf('/') + 1)
  const dot = name.lastIndexOf('.')
  return dot < 0 ? '' : name.slice(dot).toLowerCase()
}

function isCodeFile(filePath) {
  return CODE_EXTENSIONS.has(extensionOf(filePath))
}

function isConfigFile(filePath) {
  return CONFIG_EXTENSIONS.has(extensionOf(filePath))
}

/** Files that can carry a network primitive (JS/TS family only). */
function isNetworkCodeFile(filePath) {
  return /\.(?:m?js|cjs|m?ts|jsx|tsx)$/i.test(filePath)
}

/** True for paths that are shipped for development, tests or documentation. */
function isNonRuntimePath(filePath) {
  const segments = filePath.split('/')
  const base = segments[segments.length - 1]
  if (/\.(?:test|spec|bench)\.(?:[cm]?[jt]sx?)$/i.test(base)) return true
  if (/^(?:test|spec|bench)-/i.test(base)) return true
  for (let index = 0; index < segments.length - 1; index += 1) {
    if (NON_RUNTIME_SEGMENTS.has(segments[index].toLowerCase())) return true
  }
  return false
}

/** Findings in non-runtime paths are evidence, never risk (info = no score hit). */
function pathSafeSeverity(severity, filePath) {
  return isNonRuntimePath(filePath) ? 'info' : severity
}

/** Blank out JS comments while preserving string contents and offsets. */
function maskComments(text) {
  const chars = text.split('')
  let mode = 'code'
  for (let index = 0; index < chars.length; index += 1) {
    const char = text[index]
    if (mode === 'code') {
      if (char === '/' && text[index + 1] === '/') {
        chars[index] = ' '
        chars[index + 1] = ' '
        index += 1
        mode = 'line'
      } else if (char === '/' && text[index + 1] === '*') {
        chars[index] = ' '
        chars[index + 1] = ' '
        index += 1
        mode = 'block'
      } else if (char === "'") {
        mode = 'single'
      } else if (char === '"') {
        mode = 'double'
      } else if (char === '`') {
        mode = 'template'
      }
    } else if (mode === 'line') {
      if (char === '\n') mode = 'code'
      else chars[index] = ' '
    } else if (mode === 'block') {
      if (char === '*' && text[index + 1] === '/') {
        chars[index] = ' '
        chars[index + 1] = ' '
        index += 1
        mode = 'code'
      } else if (char !== '\n' && char !== '\r') {
        chars[index] = ' '
      }
    } else if (mode === 'single' || mode === 'double' || mode === 'template') {
      const closing = mode === 'single' ? "'" : mode === 'double' ? '"' : '`'
      if (char === '\\') index += 1
      else if (char === closing) mode = 'code'
    }
  }
  return chars.join('')
}

/**
 * Blank comments AND the contents of string/template literals while keeping
 * the delimiters and every offset. Used when a token only counts as behaviour
 * in code position, e.g. `atob(` in a call rather than in a rule label.
 */
function maskStringsAndComments(text) {
  const chars = maskComments(text).split('')
  let mode = 'code'
  for (let index = 0; index < chars.length; index += 1) {
    const char = chars[index]
    if (mode === 'code') {
      if (char === "'") mode = 'single'
      else if (char === '"') mode = 'double'
      else if (char === '`') mode = 'template'
      continue
    }
    const closing = mode === 'single' ? "'" : mode === 'double' ? '"' : '`'
    if (char === '\\') index += 1
    else if (char === closing) mode = 'code'
    else if (char !== '\n' && char !== '\r') chars[index] = ' '
  }
  return chars.join('')
}

/**
 * True when a line is a rule/pattern table entry rather than behaviour: an
 * object literal with `pattern:`, a regex-literal assignment, or an array
 * element that ends in a regex literal. This is how the audit engine stops
 * matching its own rule table when it audits itself.
 */
function isRuleDefinitionLine(lineText) {
  const trimmed = String(lineText ?? '').trim()
  if (trimmed.length === 0) return false
  if (/\bpattern\s*:/.test(trimmed)) return true
  if (/^(?:const|let|var)\s+[A-Za-z_$][\w$]*\s*=\s*\//.test(trimmed)) return true
  if (/\/[^/\n]*\\[^/\n]*\/[a-z]*\s*[,)\]]?\s*$/.test(trimmed)) return true
  return false
}

function lineIsRuleDefinition(originalText, starts, index) {
  return isRuleDefinitionLine(lineTextAt(originalText, starts, lineNumberAt(starts, index)))
}

function buildLineStarts(text) {
  const starts = [0]
  for (let index = 0; index < text.length; index += 1) {
    if (text.charCodeAt(index) === 10) starts.push(index + 1)
  }
  return starts
}

function lineNumberAt(starts, index) {
  let low = 0
  let high = starts.length - 1
  while (low < high) {
    const middle = (low + high + 1) >> 1
    if (starts[middle] <= index) low = middle
    else high = middle - 1
  }
  return low + 1
}

function lineTextAt(text, starts, line) {
  const start = starts[line - 1] ?? 0
  const newline = text.indexOf('\n', start)
  const end = newline === -1 ? text.length : newline
  return text.slice(start, end).replace(/\r$/, '')
}

function locateNeedle(text, starts, needle) {
  if (typeof needle !== 'string' || needle.length === 0) return undefined
  const index = text.indexOf(needle)
  return index < 0 ? undefined : lineNumberAt(starts, index)
}

/** Collect every match of one regex (bounded per pattern, never infinite). */
function findPatternMatches(text, pattern) {
  const flags = pattern.flags.includes('g') ? pattern.flags : `${pattern.flags}g`
  const regex = new RegExp(pattern.source, flags)
  const matches = []
  let match = regex.exec(text)
  while (match !== null) {
    matches.push(match)
    if (matches.length >= MAX_MATCHES_PER_PATTERN) break
    if (match.index === regex.lastIndex) regex.lastIndex += 1
    match = regex.exec(text)
  }
  return matches
}

/** Every match, minus matches that merely sit on a rule-definition line. */
function findFilteredMatches(scanText, originalText, starts, pattern) {
  return findPatternMatches(scanText, pattern).filter(
    (match) => !lineIsRuleDefinition(originalText, starts, match.index),
  )
}

/** First match across a group of patterns, with line + excerpt + labels. */
function gatherMatches(scanText, originalText, starts, patterns, accept) {
  let count = 0
  let first = null
  for (const entry of patterns) {
    const pattern = Array.isArray(entry) ? entry[0] : entry
    const matches = findFilteredMatches(scanText, originalText, starts, pattern)
      .filter((match) => typeof accept !== 'function' || accept(match))
    if (matches.length === 0) continue
    count += matches.length
    const match = matches[0]
    if (first === null || match.index < first.index) {
      const line = lineNumberAt(starts, match.index)
      first = {
        index: match.index,
        line,
        excerpt: truncateText(lineTextAt(originalText, starts, line).trim(), 300),
      }
    }
  }
  if (first === null) return null
  return { count, first }
}

/** Merge two gathered results, keeping the earliest anchor. */
function mergeGathered(a, b) {
  if (a === null) return b
  if (b === null) return a
  return {
    count: a.count + b.count,
    first: a.first.index <= b.first.index ? a.first : b.first,
  }
}

function uniqueStrings(values) {
  return [...new Set(values)].sort(compareStrings)
}

function joinFileList(files) {
  const unique = uniqueStrings(files)
  if (unique.length <= MAX_LISTED_FILES) return unique.join(', ')
  return `${unique.slice(0, MAX_LISTED_FILES).join(', ')} … (+${unique.length - MAX_LISTED_FILES} more)`
}

function unquoteYaml(value) {
  const text = String(value ?? '').trim()
  if (text.length >= 2) {
    const first = text[0]
    const last = text[text.length - 1]
    if ((first === '"' && last === '"') || (first === "'" && last === "'")) return text.slice(1, -1)
  }
  return text
}

function secretEnvName(name) {
  return SECRET_ENV_NAME.test(String(name ?? ''))
}

/* ------------------------------------------------------------------ *
 * Findings
 * ------------------------------------------------------------------ */

function makeFinding(input) {
  const severity = SEVERITY_RANK.has(input.severity) ? input.severity : 'info'
  const finding = {
    severity,
    kind: String(input.kind ?? 'unknown'),
    title: String(input.title ?? ''),
    detail: String(input.detail ?? ''),
  }
  if (typeof input.file === 'string' && input.file.length > 0) finding.file = input.file
  if (Number.isFinite(input.line) && input.line > 0) finding.line = Math.trunc(input.line)
  const evidence = fitEvidence(input.evidence)
  if (evidence.length > 0) finding.evidence = evidence
  return finding
}

function compareFindings(a, b) {
  return (
    severityRank(a.severity) - severityRank(b.severity) ||
    compareStrings(a.kind, b.kind) ||
    compareStrings(a.file ?? '', b.file ?? '') ||
    (a.line ?? 0) - (b.line ?? 0) ||
    compareStrings(a.title, b.title) ||
    compareStrings(a.detail, b.detail)
  )
}

/** Deduplicate, sort and stamp deterministic ids on a raw finding list. */
function finalizeFindings(rawFindings) {
  const unique = new Map()
  for (const raw of Array.isArray(rawFindings) ? rawFindings : []) {
    if (!raw || !SEVERITY_RANK.has(raw.severity)) continue
    const key = `${raw.severity}|${raw.kind}|${raw.file ?? ''}|${raw.line ?? 0}|${raw.title}`
    if (!unique.has(key)) unique.set(key, raw)
  }
  const sorted = [...unique.values()].sort(compareFindings)
  return sorted.map((raw, index) => {
    const id = `f-${String(index + 1).padStart(3, '0')}`
    const finding = {
      id,
      severity: raw.severity,
      kind: raw.kind,
      title: raw.title,
      detail: raw.detail,
    }
    if (raw.file !== undefined) finding.file = raw.file
    if (raw.line !== undefined) finding.line = raw.line
    const evidence = fitEvidence(raw.evidence)
    if (evidence.length > 0) finding.evidence = evidence
    return finding
  })
}

/* ------------------------------------------------------------------ *
 * Filesystem scan (bounded, symlink-safe, deterministic)
 * ------------------------------------------------------------------ */

function looksBinary(buffer) {
  if (buffer.length === 0) return false
  const sample = buffer.subarray(0, Math.min(buffer.length, BINARY_SNIFF_BYTES))
  let controls = 0
  for (const byte of sample) {
    if (byte === 0) return true
    if (byte < 32 && byte !== 9 && byte !== 10 && byte !== 11 && byte !== 12 && byte !== 13) controls += 1
  }
  return controls / sample.length > 0.1
}

async function collectFiles(root, maxFiles) {
  const collected = []
  const pending = [{ dir: root, rel: '' }]
  let readRoot = false
  let overflow = false
  const hardLimit = Math.max(maxFiles * 8, MAX_FILES_PER_READDIR)

  while (pending.length > 0 && !overflow) {
    const current = pending.shift()
    let entries
    try {
      entries = await readdir(current.dir, { withFileTypes: true })
      if (current.rel === '') readRoot = true
    } catch {
      continue
    }
    entries.sort((a, b) => compareStrings(a.name, b.name))
    for (const entry of entries) {
      // Symlinks are never followed: a link that leaves `root` can never be read.
      if (entry.isSymbolicLink()) continue
      const rel = current.rel.length > 0 ? `${current.rel}/${entry.name}` : entry.name
      if (entry.isDirectory()) {
        if (!SKIP_DIRECTORIES.has(entry.name)) pending.push({ dir: join(current.dir, entry.name), rel })
        continue
      }
      if (!entry.isFile()) continue
      let info
      try {
        info = await stat(join(current.dir, entry.name))
      } catch {
        continue
      }
      if (!info.isFile()) continue
      collected.push({ rel, size: info.size })
      if (collected.length >= hardLimit) {
        overflow = true
        break
      }
    }
  }

  collected.sort((a, b) => compareRelativePaths(a.rel, b.rel))
  return { files: collected.slice(0, maxFiles), readRoot }
}

function nativeAddonPathFinding(filePath) {
  return makeFinding({
    severity: pathSafeSeverity('medium', filePath),
    kind: 'nativeAddons',
    title: 'Prebuilt native addon shipped',
    detail: 'A `.node` binary is loaded directly into the Host process; its behaviour cannot be reviewed statically and prebuilt addons are platform-specific.',
    file: filePath,
    line: 1,
  })
}

/* ------------------------------------------------------------------ *
 * Source heuristics
 * ------------------------------------------------------------------ */

/** True when the call whose `(` follows `matchIndex` takes a quoted literal. */
function hasQuotedArgument(text, matchIndex) {
  const open = text.indexOf('(', matchIndex)
  if (open === -1) return false
  let index = open + 1
  while (index < text.length && /\s/.test(text[index])) index += 1
  return /['"`]/.test(text[index] ?? '')
}

/** True when `index` falls inside string/template content (not code). */
function isMaskedStringContent(tokenMask, index) {
  return index < tokenMask.length && tokenMask[index] === ' '
}

function analyzeCodeFile(file, starts, state) {
  const text = file.text
  const codeMask = maskComments(text)
  const tokenMask = maskStringsAndComments(text)

  // Calls and identifiers are read from code position only: a token repeated
  // inside a string, template literal or rule table is not behaviour.
  const evalHits = gatherMatches(tokenMask, text, starts, EVAL_PATTERNS)
  if (evalHits) {
    state.findings.push(makeFinding({
      severity: pathSafeSeverity('high', file.path),
      kind: 'eval',
      title: 'Dynamic code evaluation',
      detail: `${evalHits.count} dynamic-evaluation call(s) detected; evaluated strings run with the Host process privileges.`,
      file: file.path,
      line: evalHits.first.line,
      evidence: evalHits.first.excerpt,
    }))
  }

  // A bare `child_process` word is not execution: imports are matched inside
  // string specifiers (codeMask), calls only in code position (tokenMask).
  // An import quoted inside a larger string (test fixtures, this very table)
  // is documentation, not an import statement.
  const processHits = mergeGathered(
    gatherMatches(
      codeMask,
      text,
      starts,
      CHILD_PROCESS_IMPORT_PATTERNS,
      (match) => !isMaskedStringContent(tokenMask, match.index),
    ),
    gatherMatches(tokenMask, text, starts, CHILD_PROCESS_CALL_PATTERNS),
  )
  if (processHits) {
    state.findings.push(makeFinding({
      severity: pathSafeSeverity('high', file.path),
      kind: 'childProcess',
      title: 'Child process execution',
      detail: `${processHits.count} child-process call(s) detected; the package can run arbitrary commands on this machine.`,
      file: file.path,
      line: processHits.first.line,
      evidence: processHits.first.excerpt,
    }))
  }

  const writeHits = gatherMatches(tokenMask, text, starts, FILE_WRITE_PATTERNS)
  if (writeHits) {
    state.findings.push(makeFinding({
      severity: pathSafeSeverity('medium', file.path),
      kind: 'filesystemWrite',
      title: 'Filesystem writes',
      detail: `${writeHits.count} filesystem mutation call(s) detected; the package can create, modify or delete files.`,
      file: file.path,
      line: writeHits.first.line,
      evidence: writeHits.first.excerpt,
    }))
  }

  const telemetryHits = gatherMatches(codeMask, text, starts, TELEMETRY_PATTERNS)
  if (telemetryHits) {
    state.findings.push(makeFinding({
      severity: pathSafeSeverity('low', file.path),
      kind: 'telemetry',
      title: 'Telemetry / analytics wiring',
      detail: `${telemetryHits.count} telemetry SDK or analytics call(s) detected; usage data may leave this machine.`,
      file: file.path,
      line: telemetryHits.first.line,
      evidence: telemetryHits.first.excerpt,
    }))
  }

  analyzeObfuscation(file, starts, codeMask, tokenMask, state, Boolean(evalHits), Boolean(processHits))
}

function analyzeObfuscation(file, starts, codeMask, tokenMask, state, hasEval, hasChildProcess) {
  const text = file.text

  // atob only counts as a call in code position AND with a quoted payload;
  // the token appearing in a template/rule string is prose, not decoding.
  const atob = findFilteredMatches(tokenMask, text, starts, /(?<!function\s)\batob\s*\(/g)
    .filter((match) => hasQuotedArgument(text, match.index))
  const bufferBase64 = findFilteredMatches(
    codeMask,
    text,
    starts,
    /Buffer\.from\s*\(\s*['"`][A-Za-z0-9+/=\s]{40,}['"`]\s*,\s*['"`]base64['"`]\s*,?\s*\)/g,
  )
  const base64Literal = findFilteredMatches(codeMask, text, starts, /['"`][A-Za-z0-9+/]{160,}={0,2}['"`]/g)
  const hexEscapes = findFilteredMatches(codeMask, text, starts, HEX_ESCAPE_PATTERN)

  const lineCount = starts.length
  let longLine = null
  for (let index = 0; index < lineCount; index += 1) {
    const start = starts[index]
    const end = index + 1 < lineCount ? starts[index + 1] - 1 : text.length
    if (end - start > LONG_LINE_LIMIT) {
      longLine = index + 1
      break
    }
  }

  const signals = []
  if (atob.length > 0) signals.push(`${atob.length}x atob(`)
  if (bufferBase64.length > 0) signals.push(`${bufferBase64.length}x Buffer.from(...,'base64')`)
  if (base64Literal.length > 0) signals.push(`${base64Literal.length}x long base64 literal`)
  const denseHex = hexEscapes.length >= 20 && hexEscapes.length * 60 >= text.length
  if (denseHex) signals.push(`${hexEscapes.length}x hex escape (dense)`)
  if (longLine !== null) signals.push(`single line > ${LONG_LINE_LIMIT} chars at line ${longLine}`)

  if (signals.length === 0) return

  const escalated = (atob.length > 0 || bufferBase64.length > 0 || base64Literal.length > 0) && (hasEval || hasChildProcess)
  let firstIndex = null
  if (atob.length > 0) firstIndex = atob[0].index
  else if (bufferBase64.length > 0) firstIndex = bufferBase64[0].index
  else if (base64Literal.length > 0) firstIndex = base64Literal[0].index
  else if (hexEscapes.length > 0) firstIndex = hexEscapes[0].index
  const anchorLine = firstIndex !== null ? lineNumberAt(starts, firstIndex) : longLine ?? 1
  const evidence = truncateText(lineTextAt(text, starts, anchorLine).trim(), 300)

  state.findings.push(makeFinding({
    severity: pathSafeSeverity(escalated ? 'high' : 'medium', file.path),
    kind: 'obfuscation',
    title: escalated ? 'Obfuscated payload paired with dynamic execution' : 'Obfuscation indicators',
    detail: `Encoded or machine-generated payload markers: ${signals.join('; ')}.${escalated ? ' Decoding is paired with dynamic execution in the same file.' : ''}`,
    file: file.path,
    line: anchorLine,
    evidence,
  }))
}

const HEX_ESCAPE_PATTERN = /\\(?:x[0-9a-fA-F]{2}|u[0-9a-fA-F]{4})/g

/* ------------------------------------------------------------------ *
 * Credentials (aggregated, secrets only)
 * ------------------------------------------------------------------ */

function scanCredentialsFile(file, starts, state) {
  const text = file.text
  const codeMask = maskComments(text)
  const tokenMask = maskStringsAndComments(text)

  if (isCodeFile(file.path)) {
    for (const match of findFilteredMatches(codeMask, text, starts, ENV_READ_PATTERN)) {
      const line = lineNumberAt(starts, match.index)
      state.envReads.push({ file: file.path, line, excerpt: truncateText(lineTextAt(text, starts, line).trim(), 300) })
    }
  }

  for (const entry of CREDENTIAL_RULES) {
    const scanText = entry.mask === 'tokenMask' ? tokenMask : codeMask
    for (const match of findFilteredMatches(scanText, text, starts, entry.pattern)) {
      if (entry.envName && !secretEnvName(match[1])) continue
      // Environment reads and import statements must sit in code, not inside
      // a larger quoted test/documentation string.
      if ((entry.envName || entry.label === 'keytar import') && isMaskedStringContent(tokenMask, match.index)) continue
      const line = lineNumberAt(starts, match.index)
      const lineText = lineTextAt(text, starts, line)
      // A quoted label only counts when a file-access call consumes it.
      if (entry.accessContext && !ACCESS_CONTEXT_PATTERN.test(lineText)) continue
      // `permissions.credentials` is a boolean capability flag, not a secret.
      if (entry.label === '.credentials' && CREDENTIAL_FLAG_RECEIVER.test(lineText)) continue
      state.credentialHits.push({
        file: file.path,
        line,
        label: entry.label,
        excerpt: truncateText(lineText.trim(), 300),
      })
    }
  }
}

function buildCredentialsFinding(state) {
  const explicit = state.credentialHits
  if (explicit.length > 0) {
    const production = explicit.filter((hit) => !isNonRuntimePath(hit.file))
    const anchor = production[0] ?? explicit[0]
    const files = uniqueStrings(explicit.map((hit) => hit.file))
    const labels = uniqueStrings(explicit.map((hit) => hit.label))
    const envNote = state.envReads.length > 0 ? ` ${state.envReads.length} process.env read(s) also found.` : ''
    const severity = production.length > 0 ? 'medium' : 'info'
    return makeFinding({
      severity,
      kind: 'credentials',
      title: production.length > 0 ? 'Explicit secret material access' : 'Secret references in non-runtime files',
      detail: `${explicit.length} explicit credential-access site(s) [${labels.join(', ')}] across ${files.length} file(s): ${joinFileList(files)}.${envNote}`,
      file: anchor.file,
      line: anchor.line,
      evidence: anchor.excerpt,
    })
  }
  if (state.envReads.length > 0) {
    const files = uniqueStrings(state.envReads.map((read) => read.file))
    const anchor = state.envReads[0]
    return makeFinding({
      severity: 'info',
      kind: 'credentials',
      title: 'Environment variable reads',
      detail: `${state.envReads.length} process.env read(s) across ${files.length} file(s): ${joinFileList(files)}; no secret-named variable access detected.`,
      file: anchor.file,
      line: anchor.line,
      evidence: anchor.excerpt,
    })
  }
  return null
}

/* ------------------------------------------------------------------ *
 * Network (capability constructs + literals passed to them only)
 * ------------------------------------------------------------------ */

function trimUrl(rawUrl) {
  return String(rawUrl).replace(/[.,;:!?)\]}>'"]+$/g, '')
}

function hostOf(rawUrl) {
  try {
    const parsed = new URL(rawUrl)
    return parsed.hostname.length > 0 ? parsed.hostname.toLowerCase() : null
  } catch {
    const match = /^https?:\/\/([^/?#]+)/i.exec(rawUrl)
    if (!match) return null
    return match[1].replace(/:\d+$/, '').toLowerCase()
  }
}

function normalizeHostLiteral(value) {
  const text = String(value ?? '').trim().toLowerCase()
  if (text.length === 0) return null
  const withoutPort = text.replace(/^\[|\]$/g, '').split(':')[0]
  return withoutPort.length > 0 ? withoutPort : null
}

/** Text of the first argument list of a call starting at `startIndex`. */
function firstArgumentSlice(originalText, maskedText, startIndex, limit = 400) {
  const open = maskedText.indexOf('(', startIndex)
  if (open === -1) {
    const hardEnd = Math.min(originalText.length, startIndex + limit)
    return originalText.slice(startIndex, hardEnd)
  }
  let depth = 0
  let quote = null
  const hardEnd = Math.min(maskedText.length, open + limit)
  for (let index = open; index < hardEnd; index += 1) {
    const char = maskedText[index]
    if (quote !== null) {
      if (char === '\\') index += 1
      else if (char === quote) quote = null
      continue
    }
    if (char === "'" || char === '"' || char === '`') {
      quote = char
      continue
    }
    if (char === '(' || char === '[' || char === '{') depth += 1
    else if (char === ')' || char === ']' || char === '}') {
      depth -= 1
      if (depth === 0) return originalText.slice(open, index + 1)
    }
  }
  return originalText.slice(open, hardEnd)
}

/** Resolve the host literal actually passed to one network primitive call. */
function resolveCapabilityHost(originalText, maskedText, capability, urlMap) {
  const argument = firstArgumentSlice(originalText, maskedText, capability.index)

  const direct = findPatternMatches(argument, URL_LITERAL)[0]
  if (direct) {
    const host = hostOf(trimUrl(direct[2]))
    if (host !== null) return { host }
  }
  const option = /\b(?:hostname|host)\s*:\s*['"]([^'"`\s]+)['"]/.exec(argument)
  if (option) {
    const host = normalizeHostLiteral(option[1])
    if (host !== null) return { host }
  }
  const identifier = /^\(\s*([A-Za-z_$][\w$]*)/.exec(argument)
  if (identifier && urlMap.has(identifier[1])) {
    const host = hostOf(trimUrl(urlMap.get(identifier[1])))
    if (host !== null) return { host }
  }
  const template = /`[^`]*\$\{\s*([A-Za-z_$][\w$]*)/.exec(argument)
  if (template && urlMap.has(template[1])) {
    const host = hostOf(trimUrl(urlMap.get(template[1])))
    if (host !== null) return { host }
  }
  return { host: null }
}

function scanNetworkFile(file, starts, state) {
  if (!isNetworkCodeFile(file.path)) return
  const originalText = file.text
  const codeMask = maskComments(originalText)
  const tokenMask = maskStringsAndComments(originalText)

  // Capability calls only count in code position: `'fetch('` labels and
  // template prose are not network behaviour.
  const capabilities = []
  for (const entry of NETWORK_CAPABILITIES) {
    for (const match of findFilteredMatches(tokenMask, originalText, starts, entry.pattern)) {
      capabilities.push({ name: entry.name, index: match.index })
    }
  }
  if (capabilities.length === 0) return
  capabilities.sort((a, b) => a.index - b.index || compareStrings(a.name, b.name))

  const urlMap = new Map()
  for (const match of findFilteredMatches(codeMask, originalText, starts, CONST_URL)) urlMap.set(match[1], match[3])

  for (const capability of capabilities) {
    // Arguments are read from the string-visible mask so literals survive.
    const resolved = resolveCapabilityHost(originalText, codeMask, capability, urlMap)
    const line = lineNumberAt(starts, capability.index)
    state.networkCapabilities.push({
      file: file.path,
      line,
      name: capability.name,
      host: resolved.host,
      excerpt: truncateText(lineTextAt(originalText, starts, line).trim(), 300),
      index: capability.index,
    })
    if (resolved.host !== null) state.hosts.add(resolved.host)
  }
}

function buildNetworkFinding(state) {
  const capabilities = state.networkCapabilities
  if (capabilities.length === 0) return null
  const production = capabilities.filter((hit) => !isNonRuntimePath(hit.file))
  const anchor = production[0] ?? capabilities[0]
  const names = uniqueStrings(capabilities.map((hit) => hit.name))
  const productionFiles = uniqueStrings(production.map((hit) => hit.file))
  // Hosts are runtime evidence; a fixture/test literal must not pollute the
  // install-facing permission list.
  const runtimeHosts = uniqueStrings(production.filter((hit) => hit.host !== null).map((hit) => hit.host))
  const allHosts = uniqueStrings(capabilities.filter((hit) => hit.host !== null).map((hit) => hit.host))
  const hosts = runtimeHosts.length > 0 ? runtimeHosts : production.length === 0 ? allHosts : []
  const severity = production.length > 0 ? 'low' : 'info'

  const detailParts = []
  if (production.length > 0) {
    detailParts.push(`${production.length} network primitive call(s) in runtime source: ${names.join(', ')} (${joinFileList(productionFiles)})`)
  } else {
    const files = uniqueStrings(capabilities.map((hit) => hit.file))
    detailParts.push(`network primitives only in non-runtime files: ${names.join(', ')} (${joinFileList(files)})`)
  }
  if (hosts.length > 0) detailParts.push(`host literals passed to those calls: ${hosts.join(', ')}`)
  else detailParts.push('no absolute host literal detected (relative or dynamically built endpoints)')

  return makeFinding({
    severity,
    kind: 'network',
    title: severity === 'low' ? 'Network access capability' : 'Network capability in non-runtime files',
    detail: detailParts.join('; '),
    file: anchor.file,
    line: anchor.line,
    evidence: hosts.length > 0 ? hosts.join(', ') : anchor.excerpt,
  })
}

/* ------------------------------------------------------------------ *
 * Manifest (package.json) heuristics
 * ------------------------------------------------------------------ */

function asObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value) ? value : null
}

function hasProvenanceField(value) {
  if (typeof value === 'string') return value.trim().length > 0
  const object = asObject(value)
  return object !== null && typeof object.url === 'string' && object.url.trim().length > 0
}

function analyzeManifest(manifest, manifestText, state) {
  const findings = state.findings
  const starts = buildLineStarts(manifestText)

  const scripts = asObject(manifest.scripts) ?? {}
  for (const { hook, severity } of INSTALL_HOOKS) {
    const script = scripts[hook]
    if (typeof script !== 'string' || script.trim().length === 0) continue
    const remote = REMOTE_PIPE.test(script)
    findings.push(makeFinding({
      severity: remote ? 'critical' : severity,
      kind: 'installScripts',
      title: remote ? `Install-time remote code execution (${hook})` : `Lifecycle install script: ${hook}`,
      detail: remote
        ? `package.json scripts.${hook} downloads remote content and pipes it into an interpreter during install: arbitrary code executes with the installer's privileges.`
        : `package.json scripts.${hook} runs automatically during install and can execute arbitrary commands.`,
      file: 'package.json',
      line: locateNeedle(manifestText, starts, `"${hook}"`),
      evidence: `${hook}: ${script}`,
    }))
  }

  const shippedCode = state.codeFiles.length > 0
  const hasRepository = hasProvenanceField(manifest.repository)
  const hasHomepage = hasProvenanceField(manifest.homepage)
  if (shippedCode && !hasRepository && !hasHomepage) {
    findings.push(makeFinding({
      severity: 'low',
      kind: 'sparseSource',
      title: 'Missing repository/homepage',
      detail: 'package.json declares neither repository nor homepage although the package ships executable source; provenance cannot be verified statically.',
      file: 'package.json',
      line: 1,
    }))
  }
  const hasLicense = typeof manifest.license === 'string' && manifest.license.trim().length > 0
  if (manifest.private !== true && !hasLicense) {
    findings.push(makeFinding({
      severity: 'low',
      kind: 'sparseSource',
      title: 'No license or private flag',
      detail: 'package.json is neither `private: true` nor licensed, so the package declares no distribution boundary or usage terms.',
      file: 'package.json',
      line: 1,
    }))
  }

  const dependencies = asObject(manifest.dependencies) ?? {}
  const dependencyNames = Object.keys(dependencies)
  state.dependencies = dependencyNames.length
  if (dependencyNames.length > 25) {
    findings.push(makeFinding({
      severity: 'low',
      kind: 'heavyDeps',
      title: 'Large production dependency tree',
      detail: `${dependencyNames.length} production dependencies ship with the package; each one expands the trusted surface.`,
      file: 'package.json',
      line: locateNeedle(manifestText, starts, '"dependencies"'),
      evidence: dependencyNames.slice(0, 24).join(', '),
    }))
  }

  const riskySpecs = []
  const nativeDeps = []
  for (const sectionName of ['dependencies', 'optionalDependencies', 'peerDependencies', 'devDependencies']) {
    const section = asObject(manifest[sectionName])
    if (!section) continue
    for (const [name, spec] of Object.entries(section)) {
      if (typeof spec !== 'string') continue
      const trimmed = spec.trim()
      if (/^(?:file:|git(?:\+|:))/i.test(trimmed)) riskySpecs.push({ name, spec: trimmed })
      if (NATIVE_TOOLING_DEPS.has(name)) nativeDeps.push({ name, spec: trimmed })
    }
  }
  if (riskySpecs.length > 0) {
    findings.push(makeFinding({
      severity: 'medium',
      kind: 'heavyDeps',
      title: 'Dependency pinned to a local path or git spec',
      detail: `${riskySpecs.length} dependency spec(s) resolve outside the public registry, so the installed bytes cannot be matched against a published tarball.`,
      file: 'package.json',
      line: locateNeedle(manifestText, starts, riskySpecs[0].spec),
      evidence: riskySpecs.map((entry) => `${entry.name}@${entry.spec}`).join(', '),
    }))
  }
  if (nativeDeps.length > 0) {
    findings.push(makeFinding({
      severity: 'medium',
      kind: 'nativeAddons',
      title: 'Native addon tooling dependency',
      detail: 'The package depends on native-addon build/load tooling (`node-gyp` / `bindings` family), which compiles or loads unmanaged binaries.',
      file: 'package.json',
      line: locateNeedle(manifestText, starts, nativeDeps[0].name),
      evidence: nativeDeps.map((entry) => `${entry.name}@${entry.spec}`).join(', '),
    }))
  }
}

/* ------------------------------------------------------------------ *
 * Cordis patch heuristics
 * ------------------------------------------------------------------ */

/** Minimal line-oriented parser for the Loader patch dialect. */
function parsePatch(text) {
  const result = { inserts: [], overrides: [], disables: [] }
  let section = null
  const push = (value) => {
    const id = unquoteYaml(value)
    if (id.length === 0) return
    if (section === 'insert') result.inserts.push(id)
    else if (section === 'override') result.overrides.push(id)
    else if (section === 'disable') result.disables.push(id)
  }

  for (const raw of String(text).split(/\r?\n/)) {
    const line = raw.replace(/(^|\s)#.*$/, '').replace(/\s+$/, '')
    const trimmed = line.trim()
    if (trimmed.length === 0) continue

    const inline = /^(?:-\s*)?([A-Za-z_][A-Za-z0-9_-]*):\s*\[(.*)\]\s*$/.exec(trimmed)
    if (inline && PATCH_SECTION_KEYS.has(inline[1])) {
      section = inline[1] === 'disabled' ? 'disable' : inline[1]
      for (const part of inline[2].split(',')) push(part)
      continue
    }
    const header = /^(?:-\s*)?([A-Za-z_][A-Za-z0-9_-]*):\s*$/.exec(trimmed)
    if (header && PATCH_SECTION_KEYS.has(header[1])) {
      section = header[1] === 'disabled' ? 'disable' : header[1]
      continue
    }
    const row = /^-\s*(?:id|name):\s*(.+)$/.exec(trimmed)
    if (row && section !== null) {
      push(row[1])
      continue
    }
    const bare = /^-\s+([A-Za-z0-9@._/:-]+)$/.exec(trimmed)
    if (bare && section !== null) push(bare[1])
  }
  return result
}

function analyzePatch(patchText, manifest, state) {
  const parsed = parsePatch(patchText)
  const packageName = typeof manifest?.name === 'string' ? manifest.name : ''
  const owned = new Set(parsed.inserts)
  if (packageName.length > 0) owned.add(packageName)

  const riskyOverrides = parsed.overrides.filter((id) => !owned.has(id))
  const riskyDisables = parsed.disables.filter((id) => !owned.has(id))
  const starts = buildLineStarts(patchText)

  if (riskyOverrides.length > 0) {
    state.findings.push(makeFinding({
      severity: 'medium',
      kind: 'patchesShippedRows',
      title: 'Patch overrides rows owned by the host',
      detail: `cordis.patch.yml overrides ${riskyOverrides.length} row(s) the package does not own: ${riskyOverrides.join(', ')}. This changes shipped behaviour outside the package's own rows.`,
      file: 'cordis.patch.yml',
      line: locateNeedle(patchText, starts, riskyOverrides[0]),
      evidence: riskyOverrides.join(', '),
    }))
  }
  if (riskyDisables.length > 0) {
    state.findings.push(makeFinding({
      severity: 'medium',
      kind: 'patchesShippedRows',
      title: 'Patch disables shipped rows',
      detail: `cordis.patch.yml disables ${riskyDisables.length} row(s): ${riskyDisables.join(', ')}. Disabling shipped rows silently removes host capabilities.`,
      file: 'cordis.patch.yml',
      line: locateNeedle(patchText, starts, riskyDisables[0]),
      evidence: riskyDisables.join(', '),
    }))
  }
  if (parsed.inserts.length > 0) {
    state.findings.push(makeFinding({
      severity: 'info',
      kind: 'patchesShippedRows',
      title: 'Patch inserts plugin rows',
      detail: `cordis.patch.yml inserts the package's own row(s): ${parsed.inserts.join(', ')}.`,
      file: 'cordis.patch.yml',
      line: locateNeedle(patchText, starts, parsed.inserts[0]),
      evidence: parsed.inserts.join(', '),
    }))
  }
}

/* ------------------------------------------------------------------ *
 * Package analysis
 * ------------------------------------------------------------------ */

/**
 * Run every heuristic over an in-memory file list. Root-level `package.json`
 * and `cordis.patch.yml` are treated as the package manifest and bundle layer.
 *
 * @param {Array<{path: string, text: string}>} files
 * @returns {{
 *   findings: object[], hosts: Set<string>, dependencies: number, hasManifest: boolean
 * }}
 */
function analyzePackage(files) {
  const list = (Array.isArray(files) ? files : [])
    .filter((file) => file && typeof file.path === 'string' && typeof file.text === 'string')
    .map((file) => ({ path: normalizeRelPath(file.path), text: file.text }))
    .sort((a, b) => compareStrings(a.path, b.path))

  const state = {
    findings: [],
    hosts: new Set(),
    networkCapabilities: [],
    credentialHits: [],
    envReads: [],
    codeFiles: [],
    dependencies: 0,
    jsMetrics: [],
  }

  let manifest = null
  let hasManifest = false
  let patchText = null

  for (const file of list) {
    const code = isCodeFile(file.path)
    if (code) state.codeFiles.push(file.path)

    if (file.path === 'package.json') {
      hasManifest = true
      try {
        manifest = asObject(JSON.parse(file.text))
      } catch {
        manifest = null
      }
      if (manifest === null) {
        state.findings.push(makeFinding({
          severity: 'low',
          kind: 'sparseSource',
          title: 'Package manifest unreadable',
          detail: 'package.json is not a JSON object, so lifecycle scripts, dependencies and provenance cannot be audited.',
          file: 'package.json',
          line: 1,
        }))
      }
      continue
    }
    if (file.path === 'cordis.patch.yml') {
      patchText = file.text
      continue
    }

    const starts = buildLineStarts(file.text)
    if (code) {
      if (/\.(?:m?js|cjs)$/i.test(file.path) && !isNonRuntimePath(file.path)) {
        let maxLine = 0
        for (let index = 0; index < starts.length; index += 1) {
          const start = starts[index]
          const end = index + 1 < starts.length ? starts[index + 1] - 1 : file.text.length
          if (end - start > maxLine) maxLine = end - start
        }
        state.jsMetrics.push({ path: file.path, lineCount: starts.length, maxLine })
      }
      analyzeCodeFile(file, starts, state)
    }
    if (code || isConfigFile(file.path)) scanCredentialsFile(file, starts, state)
    if (isNetworkCodeFile(file.path)) scanNetworkFile(file, starts, state)
    if (file.path.toLowerCase().endsWith('.node')) {
      state.findings.push(nativeAddonPathFinding(file.path))
    }
  }

  if (manifest !== null) analyzeManifest(manifest, findManifestText(list), state)
  if (patchText !== null) analyzePatch(patchText, manifest, state)

  // A package built only from minified runtime JavaScript has no reviewable source.
  if (state.jsMetrics.length > 0) {
    const minified = state.jsMetrics.filter((metric) => metric.maxLine > 500 && metric.lineCount <= 20)
    const readable = state.jsMetrics.filter((metric) => metric.lineCount >= 8 && metric.maxLine <= 500)
    if (minified.length > 0 && readable.length === 0) {
      state.findings.push(makeFinding({
        severity: pathSafeSeverity('high', minified[0].path),
        kind: 'obfuscation',
        title: 'Minified-only source',
        detail: 'Every runtime JavaScript file is minified and no readable source ships with the package; the installed behaviour cannot be reviewed statically.',
        file: minified[0].path,
        line: 1,
        evidence: `${minified[0].path}: ${minified[0].lineCount} line(s), longest ${minified[0].maxLine} chars`,
      }))
    }
  }

  const credentialsFinding = buildCredentialsFinding(state)
  if (credentialsFinding !== null) state.findings.push(credentialsFinding)
  const networkFinding = buildNetworkFinding(state)
  if (networkFinding !== null) state.findings.push(networkFinding)

  return {
    findings: state.findings,
    hosts: state.hosts,
    networkCapabilities: state.networkCapabilities,
    dependencies: state.dependencies,
    hasManifest,
  }
}

/** The root package.json text, if it was part of the scanned list. */
function findManifestText(list) {
  const manifestFile = list.find((file) => file.path === 'package.json')
  return manifestFile?.text ?? '{}'
}

/* ------------------------------------------------------------------ *
 * Permissions summary
 * ------------------------------------------------------------------ */

function buildPermissions(findings, analysis) {
  const has = (kind) => findings.some((finding) => finding.kind === kind)
  const runtimeHosts = new Set()
  if (Array.isArray(analysis.networkCapabilities)) {
    for (const capability of analysis.networkCapabilities) {
      if (capability.host !== null && !isNonRuntimePath(capability.file)) runtimeHosts.add(capability.host)
    }
  }
  return {
    installScripts: has('installScripts'),
    network: [...runtimeHosts].sort(compareStrings),
    childProcess: has('childProcess'),
    eval: has('eval'),
    filesystemWrite: has('filesystemWrite'),
    credentials: findings.some((finding) => finding.kind === 'credentials' && finding.severity !== 'info'),
    obfuscated: has('obfuscation'),
    nativeAddons: has('nativeAddons'),
    patchesShippedRows: findings.some((finding) => finding.kind === 'patchesShippedRows' && finding.severity !== 'info'),
    sparseSource: has('sparseSource'),
  }
}

/* ------------------------------------------------------------------ *
 * Scoring
 * ------------------------------------------------------------------ */

/**
 * Score a finding list on a 0-100 scale (higher is safer).
 *
 * Start at 100 and subtract `SEVERITY_WEIGHT` per finding, capping each
 * severity's total contribution. Any `critical` finding forces `unsafe` and a
 * score of at most 39. `>= 80` is safe, `>= 60` caution, otherwise unsafe.
 *
 * @param {object[]} findings
 * @param {object} [permissions] accepted for API symmetry; scoring is findings-driven
 * @returns {{ score: number, verdict: 'safe'|'caution'|'unsafe' }}
 */
export function scoreFindings(findings, permissions) {
  void permissions
  const totals = { critical: 0, high: 0, medium: 0, low: 0, info: 0 }
  for (const finding of Array.isArray(findings) ? findings : []) {
    const severity = finding?.severity
    if (!Object.hasOwn(SEVERITY_WEIGHT, severity)) continue
    totals[severity] += SEVERITY_WEIGHT[severity]
  }
  let score = 100
  for (const severity of SEVERITY_ORDER) {
    score -= Math.min(totals[severity], SEVERITY_CAP[severity])
  }
  score = Math.max(0, Math.min(100, Math.round(score)))
  if (totals.critical > 0) return { score: Math.min(score, 39), verdict: 'unsafe' }
  const verdict = score >= 80 ? 'safe' : score >= 60 ? 'caution' : 'unsafe'
  return { score, verdict }
}

/* ------------------------------------------------------------------ *
 * Public API
 * ------------------------------------------------------------------ */

/**
 * Audit every file under `dir` with the static heuristic table.
 *
 * @param {string} dir absolute or cwd-relative package directory
 * @param {{ maxFiles?: number, maxBytes?: number }} [options]
 * @returns {Promise<{
 *   score: number, verdict: 'safe'|'caution'|'unsafe'|'unknown',
 *   evidenceLevel: 'static', target: string, findings: object[],
 *   permissions: object,
 *   stats: { files: number, bytes: number, dependencies: number, scannedAt: number }
 * }>}
 */
export async function auditDirectory(dir, options = {}) {
  const startedAt = Date.now()
  const target = resolve(typeof dir === 'string' && dir.length > 0 ? dir : '.')
  const maxFiles = normalizeLimit(options?.maxFiles, DEFAULT_MAX_FILES)
  const maxBytes = normalizeLimit(options?.maxBytes, DEFAULT_MAX_BYTES)

  const scan = await collectFiles(target, maxFiles)
  if (!scan.readRoot) {
    const finalized = finalizeFindings([
      makeFinding({
        severity: 'info',
        kind: 'sparseSource',
        title: 'Audit target unreadable',
        detail: 'The audit target could not be listed, so nothing was inspected.',
      }),
    ])
    return {
      score: 0,
      verdict: 'unknown',
      evidenceLevel: 'static',
      target,
      findings: finalized,
      permissions: buildPermissions(finalized, { hosts: new Set() }),
      stats: { files: 0, bytes: 0, dependencies: 0, scannedAt: startedAt },
    }
  }

  const nativeAddonPaths = scan.files
    .filter((file) => file.rel.toLowerCase().endsWith('.node'))
    .map((file) => file.rel)
  const sources = []
  let bytes = 0
  for (const file of scan.files) {
    if (file.size > maxBytes) continue
    let buffer
    try {
      buffer = await readFile(join(target, file.rel))
    } catch {
      continue
    }
    if (buffer.length > maxBytes) continue
    if (looksBinary(buffer)) continue
    sources.push({ path: file.rel, text: buffer.toString('utf8') })
    bytes += buffer.length
  }

  const analysis = analyzePackage(sources)
  const findings = [...analysis.findings]

  for (const rel of nativeAddonPaths) {
    if (!findings.some((finding) => finding.kind === 'nativeAddons' && finding.file === rel)) {
      findings.push(nativeAddonPathFinding(rel))
    }
  }
  if (!analysis.hasManifest) {
    findings.push(makeFinding({
      severity: 'info',
      kind: 'sparseSource',
      title: 'Package manifest missing',
      detail: 'No package.json was shipped with the package, so lifecycle scripts, dependencies and provenance cannot be audited.',
    }))
  }

  const finalized = finalizeFindings(findings)
  const permissions = buildPermissions(finalized, analysis)
  const scoring = scoreFindings(finalized, permissions)
  const noEvidence = sources.length === 0 && nativeAddonPaths.length === 0
  const verdict = noEvidence ? 'unknown' : scoring.verdict

  return {
    score: scoring.score,
    verdict,
    evidenceLevel: 'static',
    target,
    findings: finalized,
    permissions,
    stats: {
      files: sources.length,
      bytes,
      dependencies: analysis.dependencies,
      scannedAt: startedAt,
    },
  }
}

/**
 * Run the source heuristics over an in-memory file list and return the
 * finalized findings (ids included). Root-level `package.json` and
 * `cordis.patch.yml` entries are interpreted as the package manifest and bundle
 * patch; everything else is treated as package content.
 *
 * @param {Array<{path: string, text: string}>} files
 * @returns {object[]} Finding[]
 */
export function analyzeSources(files) {
  return finalizeFindings(analyzePackage(files).findings)
}
