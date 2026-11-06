/**
 * Content digest for "what gets installed must be what was audited".
 *
 * A registry candidate is audited by downloading and extracting its published
 * tarball. To prove the installed package is the same artifact, both sides are
 * digested with the same deterministic recipe:
 *
 *   sha256 over sorted `<relative path>\0<size>\0<sha256(content)>` lines
 *
 * Only regular files are read; `node_modules` and `.git` are skipped (pnpm
 * creates them, npm tarballs never contain them). The walk is bounded, and a
 * truncated digest never claims a full match.
 */

import { createHash } from 'node:crypto'
import { readdir, readFile, lstat } from 'node:fs/promises'
import { join, relative, sep } from 'node:path'

const DEFAULT_MAX_FILES = 1200
const DEFAULT_MAX_BYTES = 64 * 1024 * 1024
const MAX_DEPTH = 8

/**
 * @param {string} dir absolute directory
 * @param {{maxFiles?: number, maxBytes?: number}} [options]
 * @returns {Promise<{hash: string, files: number, bytes: number, truncated: boolean}>}
 */
export async function digestDirectory(dir, options = {}) {
  const maxFiles = options.maxFiles ?? DEFAULT_MAX_FILES
  const maxBytes = options.maxBytes ?? DEFAULT_MAX_BYTES
  const entries = []
  let bytes = 0
  let truncated = false

  const walk = async (current, depth) => {
    if (truncated) return
    if (depth > MAX_DEPTH) return
    let list
    try {
      list = await readdir(current, { withFileTypes: true })
    } catch {
      return
    }
    list.sort((left, right) => left.name.localeCompare(right.name))
    for (const entry of list) {
      if (truncated) return
      if (entry.name === 'node_modules' || entry.name === '.git') continue
      const full = join(current, entry.name)
      let info
      try {
        info = await lstat(full)
      } catch {
        continue
      }
      if (info.isDirectory()) {
        await walk(full, depth + 1)
        continue
      }
      if (!info.isFile()) continue
      if (entries.length >= maxFiles) {
        truncated = true
        return
      }
      if (bytes + info.size > maxBytes) {
        truncated = true
        return
      }
      let content
      try {
        content = await readFile(full)
      } catch {
        continue
      }
      bytes += content.byteLength
      entries.push({
        path: relative(dir, full).split(sep).join('/'),
        size: content.byteLength,
        hash: createHash('sha256').update(content).digest('hex'),
      })
    }
  }

  await walk(dir, 0)
  const digest = createHash('sha256')
  for (const entry of entries) digest.update(`${entry.path}\u0000${entry.size}\u0000${entry.hash}\n`)
  return { hash: digest.digest('hex'), files: entries.length, bytes, truncated }
}
