import { readFile } from 'node:fs/promises'
import { resolve, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = dirname(fileURLToPath(import.meta.url))

export interface RuntimeOptions {
  handlers: boolean
  /** Top-level key for patch@1.0 publishing (default: "ui") */
  patchKey: string
  /** Key under which hyperengine_templates and hyperengine_acl are synced to patch@1.0 (default: "hyperengine_state") */
  stateKey: string
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
 * Generate the Lua source for the `hyperengine` runtime module.
 *
 * Reads the Lua source from `src/lua/runtime.lua` and optionally
 * appends the auto-handler registration snippet.
 *
 * The module provides CRUD operations and lustache rendering for templates
 * at runtime inside a deployed AO process.
 *
 * - Persists state in the lowercase global `hyperengine_templates` (AO
 *   auto-persists lowercase globals across process reloads).
 * - Seeds from the bundled `templates` module on first load, merging
 *   without overwriting existing (runtime-modified) keys.
 * - Mutation handlers are guarded by `msg.From == Owner`.
 */
export async function generateRuntimeSource(options: RuntimeOptions): Promise<string> {
  let source = await readFile(luaPath('runtime.lua'), 'utf-8')

  // Inject the configured patch key
  source = source.replace(
    'local _patch_key = "ui"',
    `local _patch_key = "${options.patchKey}"`,
  )

  // Inject the configured state key
  source = source.replace(
    'local _state_key = "hyperengine_state"',
    `local _state_key = "${options.stateKey}"`,
  )

  if (options.handlers) {
    // Insert the auto-call just before the final `return hyperengine`
    source = source.replace(
      /\nreturn hyperengine\s*$/,
      '\nhyperengine.handlers()\n\nreturn hyperengine\n',
    )
  }

  return source
}

export interface LustacheModule {
  name: string
  source: string
}

/**
 * Read the bundled lustache Lua source files and return them as
 * module entries in dependency order (leaf deps first).
 *
 * These are registered as `_modules["lustache.*"]` in the emitted
 * bundle so that `require("lustache")` resolves without luarocks.
 */
export async function generateLustacheModules(): Promise<LustacheModule[]> {
  const [scanner, context, renderer, main] = await Promise.all([
    readFile(luaPath('lustache/scanner.lua'), 'utf-8'),
    readFile(luaPath('lustache/context.lua'), 'utf-8'),
    readFile(luaPath('lustache/renderer.lua'), 'utf-8'),
    readFile(luaPath('lustache.lua'), 'utf-8'),
  ])

  return [
    { name: 'lustache.scanner', source: scanner },
    { name: 'lustache.context', source: context },
    { name: 'lustache.renderer', source: renderer },
    { name: 'lustache', source: main },
  ]
}
