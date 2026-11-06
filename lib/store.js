/**
 * Durable demand ledger.
 *
 * One JSON document holds every record; a second holds the append-only install
 * history. Both are written atomically (temp file + rename) and serialized per
 * path, so a crash mid-write cannot destroy the previous generation. The store
 * is intentionally dumb: schema and transitions live in `records.js` and
 * `pipeline.js`, so a compromised or partial record can never bypass a gate by
 * being loaded from disk.
 */

import { join } from 'node:path'
import { asArray, ensureDir, errorMessage, nowMs, readJsonFile, writeJsonAtomic } from './util.js'

/** Upper bound on retained records; archived ones are pruned first. */
const MAX_RECORDS = 500
/** Upper bound on retained install-history entries. */
const MAX_HISTORY = 300

export class KeeperStore {
  #dir
  #recordsFile
  #historyFile
  #records = []
  #history = []
  #loaded = false
  #log

  constructor({ dir, log } = {}) {
    this.#dir = dir
    this.#recordsFile = join(dir, 'records.json')
    this.#historyFile = join(dir, 'history.json')
    this.#log = log
  }

  get dir() {
    return this.#dir
  }

  /** Load both documents; a corrupt file is reported and replaced in memory only. */
  async init() {
    await ensureDir(this.#dir)
    const recordsDoc = await readJsonFile(this.#recordsFile, null)
    if (recordsDoc === null) {
      this.#records = []
    } else if (Array.isArray(recordsDoc?.records)) {
      this.#records = recordsDoc.records
    } else {
      this.#warn('records.json has an unexpected shape; starting from an empty ledger')
      this.#records = []
    }
    const historyDoc = await readJsonFile(this.#historyFile, null)
    this.#history = Array.isArray(historyDoc?.entries) ? historyDoc.entries : []
    this.#loaded = true
  }

  get loaded() {
    return this.#loaded
  }

  /** Newest-first copy of every record. */
  listRecords() {
    return this.#records.slice()
  }

  getRecord(id) {
    if (typeof id !== 'string' || id.length === 0) return null
    return this.#records.find((record) => record?.id === id) ?? null
  }

  /** Newest-first copy of the install history. */
  listHistory() {
    return this.#history.slice()
  }

  /** Insert or replace one record and persist. */
  async saveRecord(record) {
    if (!record || typeof record !== 'object' || typeof record.id !== 'string') {
      throw new Error('saveRecord requires a record with an id')
    }
    const index = this.#records.findIndex((entry) => entry?.id === record.id)
    if (index >= 0) this.#records[index] = record
    else this.#records.unshift(record)
    this.#pruneRecords()
    await this.#flushRecords()
    return record
  }

  /** Append one install-history entry and persist. */
  async addHistory(entry) {
    this.#history.unshift({ ...entry, at: entry?.at ?? nowMs() })
    if (this.#history.length > MAX_HISTORY) this.#history.length = MAX_HISTORY
    await writeJsonAtomic(this.#historyFile, { version: 1, entries: this.#history })
    return this.#history[0]
  }

  #pruneRecords() {
    if (this.#records.length <= MAX_RECORDS) return
    // Drop the oldest archived records first; never drop live work.
    const kept = []
    let overflow = this.#records.length - MAX_RECORDS
    for (let index = this.#records.length - 1; index >= 0; index -= 1) {
      const record = this.#records[index]
      if (overflow > 0 && (record?.status === 'archived' || record?.status === 'rejected')) {
        overflow -= 1
        continue
      }
      kept.unshift(record)
    }
    this.#records = kept.slice(0, MAX_RECORDS)
    this.#warn(`pruned ${MAX_RECORDS - this.#records.length} old record(s)`)
  }

  async #flushRecords() {
    try {
      await writeJsonAtomic(this.#recordsFile, { version: 1, records: this.#records })
    } catch (error) {
      this.#warn(`could not persist records: ${errorMessage(error)}`)
    }
  }

  #warn(message) {
    try {
      this.#log?.warn?.(message)
    } catch {
      /* logging must never break a demand */
    }
  }
}

/** Coerce a persisted document into a plain array of records (defensive read). */
export function recordsFromDocument(document) {
  return Array.isArray(document?.records) ? asArray(document.records) : []
}
