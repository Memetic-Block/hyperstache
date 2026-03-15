import { mkdir, writeFile } from 'node:fs/promises'
import { resolve, dirname } from 'node:path'
import type { ResolvedConfig, ResolvedProcessConfig } from '../config.js'
import { resolveModules } from './resolver.js'
import { collectTemplates } from './templates.js'
import { emitBundle, emitModule } from './emit.js'
import { renderTemplates } from './vite-render.js'
import { generateRuntimeSource } from './runtime.js'
import { ensureAosRepo, copyAosProcessFiles, injectRequire } from './aos.js'

export { resolveModules, collectTemplates, emitBundle, emitModule, renderTemplates, generateRuntimeSource }
export { ensureAosRepo, copyAosProcessFiles, injectRequire } from './aos.js'
export type { LuaModule, ResolveResult } from './resolver.js'
export type { TemplateEntry } from './templates.js'
export type { EscapeResult } from './vite-render.js'

export interface BundleResult {
  /** Process name from config */
  processName: string
  /** The bundled Lua source */
  output: string
  /** Path the bundle was written to */
  outPath: string
  /** Module names that could not be resolved */
  unresolved: string[]
  /** Number of Lua modules included */
  moduleCount: number
  /** Number of templates inlined */
  templateCount: number
  /** Whether templates were processed through Vite */
  viteProcessed: boolean
  /** Whether the hyperstache runtime module is included */
  runtimeIncluded: boolean
  /** Whether this was built as an aos module */
  aosModule: boolean
  /** Files copied from the aos repo (when aosModule is true) */
  aosCopiedFiles: string[]
}

interface AosOpts {
  enabled: boolean
  commit: string
}

/**
 * Run the full bundling pipeline for a single process: resolve → collect templates → emit.
 */
export async function bundleProcess(
  process: ResolvedProcessConfig,
  aos: AosOpts = { enabled: false, commit: '' },
): Promise<BundleResult> {
  // 1. Resolve Lua modules
  const { modules, unresolved } = await resolveModules(process)

  // 2. Collect templates
  const { entries, luaSource: templatesLua } = await collectTemplates(process)

  // 3. Process templates through Vite if enabled
  const viteEnabled = !!process.templates.vite
  let templatesSource: string | null = null

  if (entries.length > 0) {
    if (viteEnabled) {
      const processed = await renderTemplates(entries, process)
      // Re-generate Lua source from Vite-processed entries
      const { toLuaLongString } = await import('./templates.js')
      const lines: string[] = ['local _templates = {}']
      for (const entry of processed) {
        lines.push(`_templates["${entry.key}"] = ${toLuaLongString(entry.content)}`)
      }
      lines.push('return _templates')
      templatesSource = lines.join('\n')
    } else {
      templatesSource = templatesLua
    }
  }

  // 4. Generate runtime module if enabled
  let runtimeSource: string | null = null
  if (process.runtime.enabled) {
    runtimeSource = await generateRuntimeSource({ handlers: process.runtime.handlers })
  }

  // 5. Emit bundle
  const output = aos.enabled
    ? emitModule(modules, templatesSource, runtimeSource, process.runtime.handlers)
    : emitBundle(modules, templatesSource, runtimeSource, process.runtime.handlers)

  // 6. Determine output paths
  // When aos is enabled with multiple processes, nest under processName subdir
  const processOutDir = aos.enabled ? resolve(process.outDir, process.name) : process.outDir
  const outFile = aos.enabled ? `${process.name}.lua` : process.outFile
  const outPath = resolve(processOutDir, outFile)
  await mkdir(dirname(outPath), { recursive: true })
  await writeFile(outPath, output, 'utf-8')

  // 7. Handle aos module output: clone repo, copy files, inject require
  let aosCopiedFiles: string[] = []
  if (aos.enabled) {
    const repoPath = await ensureAosRepo(aos.commit, process.root)
    aosCopiedFiles = await copyAosProcessFiles(repoPath, processOutDir)
    const aosProcessLua = resolve(processOutDir, 'process.lua')
    await injectRequire(aosProcessLua, process.name)
  }

  return {
    processName: process.name,
    output,
    outPath,
    unresolved,
    moduleCount: modules.length,
    templateCount: entries.length,
    viteProcessed: viteEnabled && entries.length > 0,
    runtimeIncluded: process.runtime.enabled,
    aosModule: aos.enabled,
    aosCopiedFiles,
  }
}

/**
 * Run the full bundling pipeline for all processes in parallel.
 */
export async function bundle(config: ResolvedConfig): Promise<BundleResult[]> {
  return Promise.all(config.processes.map(p => bundleProcess(p, config.aos)))
}
