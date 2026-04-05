import { readFile } from 'node:fs/promises'
import { resolve, dirname, extname, relative, sep } from 'node:path'
import type { ResolvedProcessConfig } from '../config.js'

export interface LuaModule {
  /** Module name used in require(), e.g. "handlers.home" */
  name: string
  /** Absolute file path */
  path: string
  /** Raw Lua source */
  source: string
  /** Module names this module requires */
  dependencies: string[]
}

/**
 * Extract require() calls from Lua source code.
 * Handles: require("mod"), require('mod'), require "mod", require 'mod'
 */
export function extractRequires(source: string): string[] {
  const requires: string[] = []
  // Match require("...") or require('...') or require "..." or require '...'
  const pattern = /require\s*[\(]?\s*["']([^"']+)["']\s*[\)]?/g
  let match: RegExpExecArray | null
  while ((match = pattern.exec(source)) !== null) {
    requires.push(match[1])
  }
  return requires
}

/**
 * Convert a module name (dot-separated) to possible file paths.
 * e.g. "handlers.home" -> ["handlers/home.lua", "handlers/home/init.lua"]
 */
function moduleNameToPaths(moduleName: string): string[] {
  const parts = moduleName.replace(/\./g, '/')
  return [`${parts}.lua`, `${parts}/init.lua`]
}

/**
 * Convert a file path relative to a base dir to a Lua module name.
 * e.g. "handlers/home.lua" -> "handlers.home"
 */
export function pathToModuleName(filePath: string, baseDir: string): string {
  let rel = relative(baseDir, filePath)
  // Normalize separators
  rel = rel.split(sep).join('.')
  // Remove .lua extension
  if (rel.endsWith('.lua')) {
    rel = rel.slice(0, -4)
  }
  // Remove trailing .init for init.lua files
  if (rel.endsWith('.init')) {
    rel = rel.slice(0, -5)
  }
  return rel
}

export interface ResolveResult {
  /** All resolved modules in dependency order */
  modules: LuaModule[]
  /** Module names that could not be resolved (external deps like "lustache") */
  unresolved: string[]
}

/**
 * Resolve all Lua modules starting from the entry point.
 * Searches in the entry directory and optionally lua_modules/.
 */
export async function resolveModules(
  config: ResolvedProcessConfig,
  extraDependencies: string[] = [],
): Promise<ResolveResult> {
  const entryDir = dirname(config.entry)
  const searchPaths = [
    entryDir,
    resolve(config.root, 'lua_modules/share/lua', config.luarocks.luaVersion),
  ]

  // When adminInterface.dir is outside the entry directory, add its parent
  // so the "admin" module (admin/init.lua) can be found.
  if (config.adminInterface?.enabled) {
    const adminParent = dirname(config.adminInterface.dir)
    if (!searchPaths.includes(adminParent)) {
      searchPaths.push(adminParent)
    }
  }

  const resolved = new Map<string, LuaModule>()
  const unresolved = new Set<string>()
  const visiting = new Set<string>()

  async function tryResolve(moduleName: string): Promise<string | null> {
    const candidates = moduleNameToPaths(moduleName)
    for (const searchPath of searchPaths) {
      for (const candidate of candidates) {
        const fullPath = resolve(searchPath, candidate)
        try {
          await readFile(fullPath, 'utf-8')
          return fullPath
        } catch {
          // not found, try next
        }
      }
    }
    return null
  }

  async function visit(moduleName: string): Promise<void> {
    if (resolved.has(moduleName) || unresolved.has(moduleName)) return

    if (visiting.has(moduleName)) {
      // Circular dependency — allow it but don't recurse further
      return
    }

    const filePath = await tryResolve(moduleName)
    if (!filePath) {
      if (moduleName !== 'templates' && moduleName !== 'hyperengine' && moduleName !== 'hyperengine-admin'
        && moduleName !== 'lustache' && moduleName !== 'lustache.context'
        && moduleName !== 'lustache.renderer' && moduleName !== 'lustache.scanner') {
        // Only mark as unresolved if it's not an auto-generated module
        unresolved.add(moduleName)
      }

      return
    }

    visiting.add(moduleName)

    const source = await readFile(filePath, 'utf-8')
    const dependencies = extractRequires(source)

    // Recurse into dependencies
    for (const dep of dependencies) {
      await visit(dep)
    }

    visiting.delete(moduleName)

    resolved.set(moduleName, {
      name: moduleName,
      path: filePath,
      source,
      dependencies,
    })
  }

  // Start from entry point — read it directly
  const entrySource = await readFile(config.entry, 'utf-8')
  const entryName = pathToModuleName(config.entry, entryDir)
  const entryDeps = extractRequires(entrySource)

  for (const dep of entryDeps) {
    await visit(dep)
  }

  // Visit extra dependencies (e.g. admin module) that may not be require()'d in entry
  for (const dep of extraDependencies) {
    await visit(dep)
  }

  // Entry module itself
  const entryModule: LuaModule = {
    name: entryName,
    path: config.entry,
    source: entrySource,
    dependencies: entryDeps,
  }

  // Build ordered list: dependencies first, entry last
  const modules = [...resolved.values(), entryModule]

  return { modules, unresolved: [...unresolved] }
}
