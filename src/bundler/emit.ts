import type { LuaModule } from './resolver.js'

export interface EmitOptions {
  /** Resolved Lua modules (entry module last) */
  modules: LuaModule[]
  /** Generated Lua source for the templates module, or null */
  templatesLuaSource: string | null
  /** Generated Lua source for the hyperstache runtime module, or null */
  runtimeLuaSource?: string | null
  /** Whether to auto-require the runtime module in the entry point */
  autoRequireRuntime?: boolean
}

/**
 * Emit a single bundled Lua file from resolved modules and a templates module.
 *
 * The output wraps each module in a function inside a package loader,
 * so `require("module.name")` works within the AO runtime.
 */
export function emitBundle(
  modules: LuaModule[],
  templatesLuaSource: string | null,
  runtimeLuaSource?: string | null,
  autoRequireRuntime?: boolean,
  adminLuaSource?: string | null,
  autoRequireAdmin?: boolean,
): string {
  const lines: string[] = []

  // Module loader preamble
  lines.push('-- Bundled by hyperstache')
  lines.push('local _modules = {}')
  lines.push('local _loaded = {}')
  lines.push('local _original_require = require')
  lines.push('')
  lines.push('local function _require(name)')
  lines.push('  if _loaded[name] then return _loaded[name] end')
  lines.push('  if _modules[name] then')
  lines.push('    _loaded[name] = _modules[name]()')
  lines.push('    return _loaded[name]')
  lines.push('  end')
  lines.push('  return _original_require(name)')
  lines.push('end')
  lines.push('require = _require')
  lines.push('')

  // Templates module (if any)
  if (templatesLuaSource) {
    lines.push('_modules["templates"] = function()')
    for (const line of templatesLuaSource.split('\n')) {
      lines.push(`  ${line}`)
    }
    lines.push('end')
    lines.push('')
  }

  // Runtime module (if any) — registered after templates so require('templates') resolves
  if (runtimeLuaSource) {
    lines.push('_modules["hyperstache"] = function()')
    for (const line of runtimeLuaSource.split('\n')) {
      lines.push(`  ${line}`)
    }
    lines.push('end')
    lines.push('')
  }

  // Admin module (if any) — registered after runtime so require('hyperstache') resolves
  if (adminLuaSource) {
    lines.push('_modules["hyperstache-admin"] = function()')
    for (const line of adminLuaSource.split('\n')) {
      lines.push(`  ${line}`)
    }
    lines.push('end')
    lines.push('')
  }

  // Find the entry module (last one in the array by convention)
  const entryModule = modules[modules.length - 1]
  const depModules = modules.slice(0, -1)

  // Register dependency modules
  for (const mod of depModules) {
    lines.push(`_modules["${mod.name}"] = function()`)
    for (const line of mod.source.split('\n')) {
      lines.push(`  ${line}`)
    }
    lines.push('end')
    lines.push('')
  }

  // Entry module runs directly (not wrapped)
  lines.push('-- Entry point')
  if (autoRequireRuntime && runtimeLuaSource) {
    lines.push('require("hyperstache")')
  }
  if (autoRequireAdmin && adminLuaSource) {
    lines.push('require("hyperstache-admin")')
  }
  lines.push(entryModule.source)

  return lines.join('\n')
}

/**
 * Emit a bundled Lua file wrapped as a module.
 *
 * The output is identical to `emitBundle` but wrapped so that all side effects
 * (handler registration, etc.) execute when the module is `require()`'d,
 * and an empty table is returned to satisfy the Lua module contract.
 */
export function emitModule(
  modules: LuaModule[],
  templatesLuaSource: string | null,
  runtimeLuaSource?: string | null,
  autoRequireRuntime?: boolean,
  adminLuaSource?: string | null,
  autoRequireAdmin?: boolean,
): string {
  const inner = emitBundle(modules, templatesLuaSource, runtimeLuaSource, autoRequireRuntime, adminLuaSource, autoRequireAdmin)
  const lines: string[] = []
  lines.push('local function _init()')
  for (const line of inner.split('\n')) {
    lines.push(`  ${line}`)
  }
  lines.push('end')
  lines.push('')
  lines.push('_init()')
  lines.push('return {}')
  return lines.join('\n')
}
