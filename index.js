/**
 * dsh-plugin-keeper — Host entry.
 *
 * A demand-driven plugin keeper for Harness. The Host half owns:
 *   - the durable demand ledger (`lib/store.js`, schema in `lib/records.js`)
 *   - the static audit engine used for local packages (`lib/audit.js`)
 *   - registry evidence for not-yet-installed candidates (`lib/npm.js`)
 *   - the blood / gap analysis and the decision gates (`lib/blood.js`,
 *     `lib/pipeline.js`)
 *   - the acceptance gate (`lib/verify.js`) and the only install path
 *     (`lib/install.js`)
 *   - one model-facing tool, `plugin_scout` (`lib/tools.js`)
 *   - one loopback JSON route for the panel (`lib/panel.js`)
 *
 * The Client half (`client.js`) renders the same records and calls the same
 * service methods through that route; there is no second source of truth.
 */

import { homedir } from 'node:os'
import { join } from 'node:path'
import { registerPanel } from './lib/panel.js'
import { createKeeperService, createStore } from './lib/service.js'
import { createScoutTool } from './lib/tools.js'
import { errorMessage } from './lib/util.js'

/** `tools` is required; `webServer`/`pluginManager` are optional at the package level. */
export const inject = ['tools']

const PROMPT_SECTION = [
  'Plugin Keeper is active: the `plugin_scout` tool turns a plugin need into one durable, reviewable record',
  '(intake → candidates → audit → blood → decide → verify → install). The user sees the same record in the',
  'sidebar panel 「插件管家」. Use the tool for any plugin search, audit, gap-closing, or install request;',
  'write each stage back before moving on, and never install a candidate whose blood label is thin/cut.',
].join(' ')

export function apply(ctx, config) {
  const log = {
    info: (message) => write(ctx, 'info', message),
    warn: (message) => write(ctx, 'warn', message),
  }

  const dataDir = resolveDataDir(config)
  const store = createStore({ dir: dataDir, log })
  const service = createKeeperService({ ctx, store, log })

  // Model-facing tool. Failure must not stop the panel from mounting.
  try {
    ctx.effect(() => ctx.tools.register(createScoutTool(service)), 'dsh-plugin-keeper: plugin_scout tool')
  } catch (error) {
    log.warn(`could not register plugin_scout: ${errorMessage(error)}`)
  }

  // One short prompt section so the tool is discoverable without a skill.
  try {
    if (typeof ctx.systemPrompt?.section === 'function') {
      ctx.effect(
        () =>
          ctx.systemPrompt.section({
            name: 'dsh-plugin-keeper',
            order: 9100,
            interpolate: false,
            text: () => PROMPT_SECTION,
          }),
        'dsh-plugin-keeper: prompt section',
      )
    }
  } catch (error) {
    log.warn(`could not register the prompt section: ${errorMessage(error)}`)
  }

  // Web panel route; headless profiles have no webServer and stay valid.
  try {
    registerPanel(ctx, { service, log })
  } catch (error) {
    log.warn(`could not register the panel route: ${errorMessage(error)}`)
  }

  log.info(`active: ledger at ${dataDir}`)
}

function resolveDataDir(config) {
  if (typeof config?.dataDir === 'string' && config.dataDir.trim().length > 0) return config.dataDir.trim()
  const home = process.env.DSH_HOME || join(homedir(), '.dsh')
  return join(home, 'plugin-keeper')
}

function write(ctx, level, message) {
  try {
    const logger = ctx.logger
    if (typeof logger?.[level] === 'function') logger[level](`[dsh-plugin-keeper] ${message}`)
  } catch {
    /* logging must never break a turn */
  }
}
