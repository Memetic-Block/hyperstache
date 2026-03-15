import type { Plugin, ResolvedConfig as ViteResolvedConfig } from 'vite'
import { loadConfig, resolveConfig } from './config.js'
import type { HyperstacheConfig, ResolvedConfig } from './config.js'
import { bundle, bundleProcess } from './bundler/index.js'
import type { BundleResult } from './bundler/index.js'

export type HyperstachePluginOptions = (HyperstacheConfig | ResolvedConfig) & {
  /** Only bundle a specific process by name */
  filterProcess?: string
}

/**
 * Vite plugin for hyperstache — bundles AO Lua processes with mustache templates.
 *
 * Usage in vite.config.ts:
 *   import { hyperstache } from 'hyperstache/vite'
 *   export default defineConfig({ plugins: [hyperstache({ processes: { main: { entry: 'src/process.lua' } } })] })
 */
export function hyperstache(options?: HyperstachePluginOptions): Plugin {
  let hsConfig: ResolvedConfig
  let viteConfig: ViteResolvedConfig
  let filterProcess: string | undefined

  async function runBundle(): Promise<BundleResult[]> {
    if (filterProcess) {
      const proc = hsConfig.processes.find(p => p.name === filterProcess)
      if (!proc) {
        throw new Error(`Unknown process "${filterProcess}". Available: ${hsConfig.processes.map(p => p.name).join(', ')}`)
      }
      return [await bundleProcess(proc)]
    }
    return bundle(hsConfig)
  }

  function logResults(results: BundleResult[]) {
    for (const result of results) {
      console.log(
        `[hyperstache:${result.processName}] Bundled ${result.moduleCount} modules, ${result.templateCount} templates → ${result.outPath}`,
      )
      if (result.unresolved.length > 0) {
        console.warn(
          `[hyperstache:${result.processName}] Unresolved modules: ${result.unresolved.join(', ')}`,
        )
      }
    }
  }

  return {
    name: 'vite-plugin-hyperstache',

    async configResolved(config) {
      viteConfig = config
      const root = config.root

      if (options) {
        filterProcess = options.filterProcess
        const { filterProcess: _, ...configOptions } = options
        if (Array.isArray((configOptions as ResolvedConfig).processes)) {
          hsConfig = configOptions as ResolvedConfig
        } else {
          hsConfig = await resolveConfig(configOptions as HyperstacheConfig, root)
        }
      } else {
        hsConfig = await loadConfig(root)
      }
    },

    async buildStart() {
      const results = await runBundle()
      logResults(results)
    },

    configureServer(server) {
      // Collect all unique extensions and watch patterns
      const extensionSet = new Set<string>()
      for (const proc of hsConfig.processes) {
        for (const ext of proc.templates.extensions) {
          extensionSet.add(ext)
        }
      }

      const watchPatterns = [
        '**/*.lua',
        ...[...extensionSet].map((e) => `**/*${e}`),
      ]

      // If any process has Vite template processing enabled, also watch asset files
      const anyVite = hsConfig.processes.some(p => p.templates.vite)
      if (anyVite) {
        watchPatterns.push(
          '**/*.css',
          '**/*.scss',
          '**/*.sass',
          '**/*.less',
          '**/*.styl',
          '**/*.js',
          '**/*.ts',
          '**/*.jsx',
          '**/*.tsx',
        )
      }

      server.watcher.add(watchPatterns)
    },

    async handleHotUpdate({ file, server }) {
      const isLua = file.endsWith('.lua')
      const isTemplate = hsConfig.processes.some(p =>
        p.templates.extensions.some((ext) => file.endsWith(ext)),
      )
      const anyVite = hsConfig.processes.some(p => p.templates.vite)
      const isTemplateAsset =
        anyVite &&
        /\.(css|scss|sass|less|styl|js|ts|jsx|tsx)$/.test(file)

      if (isLua || isTemplate || isTemplateAsset) {
        console.log(`[hyperstache] File changed: ${file}, re-bundling...`)
        const results = await runBundle()
        for (const result of results) {
          console.log(
            `[hyperstache:${result.processName}] Re-bundled ${result.moduleCount} modules, ${result.templateCount} templates${result.viteProcessed ? ' (Vite processed)' : ''}`,
          )
        }
        // Trigger full page reload since Lua changes affect the process
        server.ws.send({ type: 'full-reload' })
        return []
      }
    },
  }
}

export { defineConfig } from './config.js'
export type { HyperstacheConfig, ResolvedConfig, ViteTemplateOptions } from './config.js'
