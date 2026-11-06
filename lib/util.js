/**
 * Small shared helpers for the Plugin Keeper Host half.
 *
 * Everything here is dependency-free: Node builtins only, no npm imports, no
 * side effects at module load. The plugin runs inside the Harness Host process,
 * so `node:fs`, `node:crypto`, and `node:child_process` are available.
 */

import { createHash, randomBytes } from 'node:crypto'
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises'
import { dirname } from 'node:path'

/** Message of any thrown value, without leaking a stack into records. */
export function errorMessage(error) {
  if (error instanceof Error) return error.message
  return String(error)
}

/** Current time in epoch milliseconds. */
export function nowMs() {
  return Date.now()
}

/** `sc-20261105-153012-a1b2`: sortable, human-scannable demand id. */
export function newRecordId(date = new Date()) {
  const pad = (value, width = 2) => String(value).padStart(width, '0')
  const stamp =
    `${date.getFullYear()}${pad(date.getMonth() + 1)}${pad(date.getDate())}` +
    `-${pad(date.getHours())}${pad(date.getMinutes())}${pad(date.getSeconds())}`
  return `sc-${stamp}-${randomBytes(2).toString('hex')}`
}

/** One-line display title derived from the raw requirement. */
export function titleFrom(text, max = 46) {
  const flat = String(text ?? '')
    .replace(/\s+/g, ' ')
    .trim()
  if (flat.length === 0) return '未命名需求'
  return flat.length > max ? `${flat.slice(0, max)}…` : flat
}

/** Truncate any text for evidence fields and record display. */
export function truncate(value, max) {
  const text = String(value ?? '')
  return text.length > max ? `${text.slice(0, max)}…` : text
}

/** Finite integer clamped into [min, max], else the fallback. */
export function clampInt(value, min, max, fallback) {
  const number = Number(value)
  if (!Number.isFinite(number)) return fallback
  return Math.min(max, Math.max(min, Math.trunc(number)))
}

/** Hex sha256, optionally truncated. */
export function sha256(text, length = 64) {
  return createHash('sha256').update(String(text)).digest('hex').slice(0, length)
}

/** Plain object (not null, not array). */
export function isPlainObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}

/** Array or empty array. */
export function asArray(value) {
  return Array.isArray(value) ? value : []
}

/** String or fallback. */
export function asString(value, fallback = '') {
  return typeof value === 'string' ? value : fallback
}

/** Shallow-copy an object, dropping undefined values. */
export function withoutEmpty(value) {
  const out = {}
  for (const [key, entry] of Object.entries(value ?? {})) {
    if (entry !== undefined) out[key] = entry
  }
  return out
}

/** Structured clone that tolerates functions/undefined by JSON round-trip fallback. */
export function cloneJson(value) {
  try {
    return structuredClone(value)
  } catch {
    return JSON.parse(JSON.stringify(value))
  }
}

/** mkdir -p that never throws when the directory already exists. */
export async function ensureDir(dir) {
  if (!dir) return
  await mkdir(dir, { recursive: true })
}

/** Read and parse JSON, returning `fallback` for a missing/corrupt file. */
export async function readJsonFile(file, fallback) {
  try {
    const text = await readFile(file, 'utf8')
    return JSON.parse(text)
  } catch {
    return fallback
  }
}

const writeQueues = new Map()

/**
 * Atomic JSON write: serialize per path, write a temp sibling, then rename.
 * A crash leaves the previous file intact instead of a truncated one.
 */
export function writeJsonAtomic(file, value) {
  const previous = writeQueues.get(file) ?? Promise.resolve()
  const next = previous
    .catch(() => {})
    .then(async () => {
      await ensureDir(dirname(file))
      const temp = `${file}.tmp-${process.pid}-${randomBytes(3).toString('hex')}`
      await writeFile(temp, `${JSON.stringify(value, null, 2)}\n`, 'utf8')
      await rename(temp, file)
    })
  writeQueues.set(file, next)
  return next.finally(() => {
    if (writeQueues.get(file) === next) writeQueues.delete(file)
  })
}

/** Format an epoch millisecond value for a brief; `—` when absent. */
export function formatTime(value) {
  if (typeof value !== 'number' || !Number.isFinite(value)) return '—'
  const date = new Date(value)
  const pad = (entry) => String(entry).padStart(2, '0')
  return (
    `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ` +
    `${pad(date.getHours())}:${pad(date.getMinutes())}`
  )
}
