import { mkdir, writeFile } from 'node:fs/promises'
import { resolve, dirname } from 'node:path'
import type { ResolvedConfig, ResolvedProcessConfig } from '../config.js'
import { resolveModules } from './resolver.js'
import { collectTemplates } from './templates.js'
import { emitBundle, emitModule } from './emit.js'
import { renderTemplates } from './vite-render.js'
import { generateRuntimeSource } from './runtime.js'
import { ensureAosRepo, copyAosProcessFiles, injectRequire, writeAosYaml } from './aos.js'

export { resolveModules, collectTemplates, emitBundle, emitModule, renderTemplates, generateRuntimeSource }
export { ensureAosRepo, copyAosProcessFiles, injectRequire, generateAosYaml, writeAosYaml } from './aos.js'
export type { AosYamlOptions } from './aos.js'
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
  /** Artifact type: 'process' or 'module' */
  type: 'process' | 'module'
  /** Whether this was built as an aos module */
  aosModule: boolean
  /** Files copied from the aos repo (when aosModule is true) */
  aosCopiedFiles: string[]
  /** Path to the generated YAML config file (when aosModule is true) */
  aosYamlPath: string | null
}

interface AosOpts {
  enabled: boolean
  commit: string
  stack_size: number
  initial_memory: number
  maximum_memory: number
  target: 32 | 64
  compute_limit: string
  module_format: string
}

/**
 * Run the full bundling pipeline for a single process: resolve → collect templates → emit.
 */
export async function bundleProcess(
  process: ResolvedProcessConfig,
  aos: AosOpts = { enabled: false, commit: '', stack_size: 3_145_728, initial_memory: 4_194_304, maximum_memory: 1_073_741_824, target: 32, compute_limit: '9000000000000', module_format: 'wasm32-unknown-emscripten-metering' },
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
  // Modules always use raw emitBundle (no _init wrapper), even when aos is enabled
  const isModule = process.type === 'module'
  const useAos = aos.enabled && !isModule
  const output = useAos
    ? emitModule(modules, templatesSource, runtimeSource, process.runtime.handlers)
    : emitBundle(modules, templatesSource, runtimeSource, process.runtime.handlers)

  // 6. Determine output paths
  // When aos is enabled (for processes only), nest under processName subdir
  const processOutDir = useAos ? resolve(process.outDir, process.name) : process.outDir
  const outFile = useAos ? `${process.name}.lua` : process.outFile
  const outPath = resolve(processOutDir, outFile)
  await mkdir(dirname(outPath), { recursive: true })
  await writeFile(outPath, output, 'utf-8')

  // 7. Handle aos module output: clone repo, copy files, inject require, write YAML (processes only)
  let aosCopiedFiles: string[] = []
  let aosYamlPath: string | null = null
  if (useAos) {
    const repoPath = await ensureAosRepo(aos.commit, process.root)
    aosCopiedFiles = await copyAosProcessFiles(repoPath, processOutDir)
    const aosProcessLua = resolve(processOutDir, 'process.lua')
    await injectRequire(aosProcessLua, process.name)
    aosYamlPath = await writeAosYaml(processOutDir, {
      stack_size: aos.stack_size,
      initial_memory: aos.initial_memory,
      maximum_memory: aos.maximum_memory,
      target: aos.target,
      aos_git_hash: aos.commit,
      compute_limit: aos.compute_limit,
      module_format: aos.module_format,
    })
  }

  return {
    processName: process.name,
    type: process.type,
    output,
    outPath,
    unresolved,
    moduleCount: modules.length,
    templateCount: entries.length,
    viteProcessed: viteEnabled && entries.length > 0,
    runtimeIncluded: process.runtime.enabled,
    aosModule: useAos,
    aosCopiedFiles,
    aosYamlPath,
  }
}

/**
 * Run the full bundling pipeline for all processes in parallel.
 */
export async function bundle(config: ResolvedConfig): Promise<BundleResult[]> {
  return Promise.all(config.processes.map(p => bundleProcess(p, config.aos)))
}
