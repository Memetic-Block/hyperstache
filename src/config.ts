import { readFile, mkdir, writeFile, stat } from 'node:fs/promises'
import { resolve, dirname, join, extname, basename } from 'node:path'
import { pathToFileURL } from 'node:url'
import type { UserConfig as ViteUserConfig } from 'vite'

export interface ViteTemplateOptions {
  /** Vite plugins to use when processing templates */
  plugins?: ViteUserConfig['plugins']
  /** CSS options (PostCSS, preprocessors, etc.) */
  css?: ViteUserConfig['css']
  /** Resolve options (aliases, extensions, etc.) */
  resolve?: ViteUserConfig['resolve']
  /** Define global constant replacements */
  define?: ViteUserConfig['define']
}

export interface TemplateConfig {
  /** File extensions treated as mustache templates (default: [ '.html', '.htm', '.tmpl', '.mustache', '.mst', '.mu', '.stache' ]) */
  extensions?: string[]
  /** Directory to scan for templates (default: auto-discover from entry dir) */
  dir?: string
  /** Enable Vite processing of templates. `true` for defaults, or pass options. */
  vite?: boolean | ViteTemplateOptions
}

export interface LuarocksConfig {
  /** Luarocks dependencies, e.g. { lustache: "1.3.1-0" } */
  dependencies?: Record<string, string>
  /** Lua version for rockspec (default: "5.3") */
  luaVersion?: string
}

export interface RuntimeConfig {
  /** Enable AO message handlers for template CRUD */
  handlers?: boolean
}

export interface AosConfig {
  /** Git commit hash of the permaweb/aos repo to clone */
  commit: string
}

export interface ProcessConfig {
  /** Lua entry point, e.g. "src/process.lua" */
  entry: string
  /** Output filename (default: derived from entry filename) */
  outFile?: string
  /** Per-process template overrides */
  templates?: TemplateConfig
  /** Per-process luarocks overrides */
  luarocks?: LuarocksConfig
  /** Per-process runtime module overrides */
  runtime?: boolean | RuntimeConfig
}

export interface HyperstacheConfig {
  /** Named process definitions */
  processes: Record<string, ProcessConfig>
  /** Output directory (default: "dist") */
  outDir?: string
  /** Shared template defaults for all processes */
  templates?: TemplateConfig
  /** Shared luarocks defaults for all processes */
  luarocks?: LuarocksConfig
  /** Shared runtime module defaults for all processes */
  runtime?: boolean | RuntimeConfig
  /** Build as an aos module — clones the aos repo at the given commit and outputs the user's bundle as a require()'d module */
  aos?: AosConfig
}

export interface ResolvedProcessConfig {
  /** Process name (key from processes map) */
  name: string
  /** Absolute path to the Lua entry point */
  entry: string
  /** Absolute path to the output directory */
  outDir: string
  /** Output filename */
  outFile: string
  /** Absolute path to the project root */
  root: string
  templates: {
    extensions: string[]
    dir: string
    vite: ViteTemplateOptions | false
  }
  luarocks: {
    dependencies: Record<string, string>
    luaVersion: string
  }
  runtime: {
    enabled: boolean
    handlers: boolean
  }
}

export interface ResolvedConfig {
  root: string
  outDir: string
  processes: ResolvedProcessConfig[]
  luarocks: {
    dependencies: Record<string, string>
    luaVersion: string
  }
  aos: {
    enabled: boolean
    commit: string
  }
}

const DEFAULT_EXTENSIONS = ['.html', '.htm', '.tmpl', '.mustache', '.mst', '.mu', '.stache']

const CONFIG_FILES = [
  'hyperstache.config.ts',
  'hyperstache.config.js',
  'hyperstache.config.mjs',
]

async function resolveTemplatesDir(root: string, entryDir: string, configDir?: string): Promise<string> {
  if (configDir) return resolve(root, configDir)
  const templatesSubdir = join(entryDir, 'templates')
  try {
    const s = await stat(templatesSubdir)
    if (s.isDirectory()) return templatesSubdir
  } catch {}
  return entryDir
}

function resolveViteOpts(raw: boolean | ViteTemplateOptions | undefined): ViteTemplateOptions | false {
  if (raw === true) return {}
  if (raw === false || raw == null) return false
  return raw
}

function mergeTemplateConfig(
  shared: TemplateConfig | undefined,
  process: TemplateConfig | undefined,
): TemplateConfig {
  return {
    extensions: process?.extensions ?? shared?.extensions,
    dir: process?.dir ?? shared?.dir,
    vite: process?.vite ?? shared?.vite,
  }
}

function mergeLuarocksConfig(
  shared: LuarocksConfig | undefined,
  process: LuarocksConfig | undefined,
): LuarocksConfig {
  return {
    dependencies: { ...shared?.dependencies, ...process?.dependencies },
    luaVersion: process?.luaVersion ?? shared?.luaVersion,
  }
}

function resolveRuntimeOpts(
  shared: boolean | RuntimeConfig | undefined,
  process: boolean | RuntimeConfig | undefined,
): { enabled: boolean; handlers: boolean } {
  const raw = process ?? shared
  if (raw === true) return { enabled: true, handlers: false }
  if (raw === false || raw == null) return { enabled: false, handlers: false }
  return { enabled: true, handlers: raw.handlers ?? false }
}

export async function resolveConfig(
  raw: HyperstacheConfig,
  root: string,
): Promise<ResolvedConfig> {
  const entries = Object.entries(raw.processes)
  if (entries.length === 0) {
    throw new Error('At least one process must be defined in "processes".')
  }

  // Validate aos config
  const aos: ResolvedConfig['aos'] = raw.aos
    ? { enabled: true, commit: raw.aos.commit }
    : { enabled: false, commit: '' }

  if (aos.enabled && !/^[0-9a-f]{7,40}$/i.test(aos.commit)) {
    throw new Error(
      `Invalid aos commit hash "${aos.commit}". Expected a 7-40 character hex string.`,
    )
  }

  const outDir = resolve(root, raw.outDir ?? 'dist')

  const processes: ResolvedProcessConfig[] = await Promise.all(
    entries.map(async ([name, proc]) => {
      const entry = resolve(root, proc.entry)
      const entryDir = dirname(entry)

      const mergedTemplates = mergeTemplateConfig(raw.templates, proc.templates)
      const mergedLuarocks = mergeLuarocksConfig(raw.luarocks, proc.luarocks)

      const defaultOutFile = basename(proc.entry, '.lua') + '.lua'

      return {
        name,
        entry,
        outDir,
        outFile: proc.outFile ?? defaultOutFile,
        root,
        templates: {
          extensions: mergedTemplates.extensions ?? DEFAULT_EXTENSIONS,
          dir: await resolveTemplatesDir(root, entryDir, mergedTemplates.dir),
          vite: resolveViteOpts(mergedTemplates.vite),
        },
        luarocks: {
          dependencies: mergedLuarocks.dependencies ?? {},
          luaVersion: mergedLuarocks.luaVersion ?? '5.3',
        },
        runtime: resolveRuntimeOpts(raw.runtime, proc.runtime),
      }
    }),
  )

  // Merge all process luarocks deps for the top-level config
  const allDeps: Record<string, string> = {}
  for (const proc of processes) {
    for (const [pkg, ver] of Object.entries(proc.luarocks.dependencies)) {
      if (allDeps[pkg] && allDeps[pkg] !== ver) {
        throw new Error(
          `Conflicting luarocks dependency versions for "${pkg}": "${allDeps[pkg]}" vs "${ver}" (process "${proc.name}").`,
        )
      }
      allDeps[pkg] = ver
    }
  }

  return {
    root,
    outDir,
    processes,
    luarocks: {
      dependencies: allDeps,
      luaVersion: processes[0].luarocks.luaVersion,
    },
    aos,
  }
}

export async function loadConfig(root: string): Promise<ResolvedConfig> {
  for (const name of CONFIG_FILES) {
    const filePath = resolve(root, name)
    try {
      await readFile(filePath)
    } catch {
      continue
    }

    const ext = extname(name)
    let config: HyperstacheConfig

    if (ext === '.ts') {
      // Bundle the TS config to a temp ESM file with esbuild, then import it
      const { build } = await import('esbuild')
      const outdir = resolve(root, 'node_modules', '.hyperstache')
      const outfile = resolve(outdir, `config-${Date.now()}.mjs`)
      await mkdir(outdir, { recursive: true })
      await build({
        entryPoints: [filePath],
        outfile,
        format: 'esm',
        platform: 'node',
        bundle: true,
        write: true,
        packages: 'external',
        plugins: [{
          name: 'hyperstache-config-shim',
          setup(b) {
            b.onResolve({ filter: /^hyperstache$/ }, () => ({
              path: 'hyperstache',
              namespace: 'hyperstache-shim',
            }))
            b.onLoad({ filter: /.*/, namespace: 'hyperstache-shim' }, () => ({
              contents: 'export function defineConfig(config) { return config }',
              loader: 'js',
            }))
          },
        }],
      })
      const mod = await import(pathToFileURL(outfile).href)
      config = mod.default ?? mod
    } else {
      const mod = await import(pathToFileURL(filePath).href)
      config = mod.default ?? mod
    }

    return await resolveConfig(config, root)
  }

  throw new Error(
    `No config file found. Create one of: ${CONFIG_FILES.join(', ')}`,
  )
}

export function defineConfig(config: HyperstacheConfig): HyperstacheConfig {
  return config
}
