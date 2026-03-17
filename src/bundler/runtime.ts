import { readFile } from 'node:fs/promises'
import { resolve, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = dirname(fileURLToPath(import.meta.url))

export interface RuntimeOptions {
  handlers: boolean
}

/**
 * Resolve the path to a bundled Lua runtime file.
 *
 * In source: src/bundler/runtime.ts → ../../src/lua/<name>
 * In dist (with splitting): dist/chunk-xxx.js → ./lua/<name>
 *
 * We detect which layout we're in by checking whether __dirname
 * ends with `src/bundler` (running from source / ts-node) or not
 * (running from the flat dist output produced by tsup with splitting).
 */
function luaPath(name: string): string {
  if (__dirname.endsWith('src/bundler') || __dirname.endsWith('src\\bundler')) {
    // Running from source
    return resolve(__dirname, '..', 'lua', name)
  }
  // Running from dist/ (flat chunk alongside dist/lua/)
  return resolve(__dirname, 'lua', name)
}

/**
 * Generate the Lua source for the `hyperstache` runtime module.
 *
 * Reads the Lua source from `src/lua/runtime.lua` and optionally
 * appends the auto-handler registration snippet.
 *
 * The module provides CRUD operations and lustache rendering for templates
 * at runtime inside a deployed AO process.
 *
 * - Persists state in the lowercase global `hyperstache_templates` (AO
 *   auto-persists lowercase globals across process reloads).
 * - Seeds from the bundled `templates` module on first load, merging
 *   without overwriting existing (runtime-modified) keys.
 * - Mutation handlers are guarded by `msg.From == Owner`.
 */
export async function generateRuntimeSource(options: RuntimeOptions): Promise<string> {
  let source = await readFile(luaPath('runtime.lua'), 'utf-8')

  if (options.handlers) {
    // Insert the auto-call just before the final `return hyperstache`
    source = source.replace(
      /\nreturn hyperstache\s*$/,
      '\nhyperstache.handlers()\n\nreturn hyperstache\n',
    )
  }

  return source
}
