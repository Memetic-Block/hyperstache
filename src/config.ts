import { readFile, mkdir, writeFile, stat } from 'node:fs/promises'
import { resolve, dirname, join, extname, basename } from 'node:path'
import { pathToFileURL } from 'node:url'
import { config as dotenvConfig } from 'dotenv'
import type { UserConfig as ViteUserConfig } from 'vite'

/**
 * Load a .env file into process.env without overwriting existing values.
 */
export function loadDotenv(root: string): void {
  dotenvConfig({ path: resolve(root, '.env'), quiet: true })
}

export interface ExternalDep {
  /** Module name used as the Rollup external and import map key */
  name: string
  /** URL to map in a `<script type="importmap">`. Use `ar://<txid>` for Arweave wayfinder URLs. */
  url: string
}

export interface ViteTemplateOptions {
  /** Vite plugins to use when processing templates */
  plugins?: ViteUserConfig['plugins']
  /** CSS options (PostCSS, preprocessors, etc.) */
  css?: ViteUserConfig['css']
  /** Resolve options (aliases, extensions, etc.) */
  resolve?: ViteUserConfig['resolve']
  /** Define global constant replacements */
  define?: ViteUserConfig['define']
  /** Dependencies to treat as external (not bundled/inlined by Rollup).
   *  Use `{ name, url }` objects to also inject a `<script type="importmap">`. */
  external?: (string | RegExp | ExternalDep)[]
  /** Preserve `type="module"` on inlined scripts and protect pre-existing
   *  inline `<script>` blocks from Vite transformation. */
  esm?: boolean
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

export interface AdminInterfaceConfig {
  /** Path key used when publishing to patch@1.0 (default: "admin") */
  path?: string
  /** Directory containing admin source files (default: "src/admin") */
  dir?: string
}

export interface AosConfig {
  /** Git commit hash of the permaweb/aos repo to clone */
  commit: string
  /** Stack size in bytes (default: 3145728 = 3MiB) */
  stack_size?: number
  /** Initial memory in bytes — includes stack + heap (default: 4194304 = 4MiB) */
  initial_memory?: number
  /** Maximum memory in bytes (default: 1073741824 = 1GiB) */
  maximum_memory?: number
  /** WASM target: 32 or 64 (default: 64) */
  target?: 32 | 64
  /** Compute limit for publishing (default: '9000000000000') */
  compute_limit?: string
  /** Module format (default: derived from target, e.g. 'wasm64-unknown-emscripten-draft_2024_02_15') */
  module_format?: string
  /** Dot-path module names to exclude from the aos process.lua (e.g. ['.crypto.init']) */
  exclude?: string[]
}

export interface ProcessConfig {
  /** Lua entry point, e.g. "src/process.lua" */
  entry: string
  /** Artifact type: 'process' (default) or 'module' (dynamic read module, skips aos build) */
  type?: 'process' | 'module'
  /** Output filename (default: derived from entry filename) */
  outFile?: string
  /** Per-process template overrides */
  templates?: TemplateConfig
  /** Per-process luarocks overrides */
  luarocks?: LuarocksConfig
  /** Enable AO message handlers for template CRUD (per-process override) */
  handlers?: boolean
  /** Enable admin UI for template & ACL management (per-process override).
   *  `true` for defaults, or pass options. Implicitly enables `handlers` when set. */
  adminInterface?: boolean | AdminInterfaceConfig
  /** Top-level key used when publishing rendered templates to `patch@1.0`.
   *  Nesting under this key causes the JSON device to lazylink-encode HTML,
   *  preventing raw HTML from appearing in message headers. (default: "ui") */
  patchKey?: string
  /** Key under which template and ACL state is synced to `patch@1.0`.
   *  State is nested as `{ templates: ..., acl: ... }` under this key. (default: "hyperengine_state") */
  stateKey?: string
  /** Published module transaction ID (for WASM module builds). Set after `publish`. */
  moduleId?: string
}

export interface DeployTag {
  name: string
  value: string
}

export interface DeployConfig {
  /** HyperBeam node URL. Env: HYPERBEAM_URL */
  hyperbeamUrl?: string
  /** Path to Arweave JWK wallet file. Env: WALLET_PATH */
  wallet?: string
  /** Scheduler address for ao spawn (default: _GQ33BkPtZrqxA84vM8Zk-N2aO0toNNu_C-l-rawrBA) */
  scheduler?: string
  /** Authority address for the spawned process. Falls back to scheduler if absent. */
  authority?: string
  /** Extra tags to include on spawn messages */
  spawnTags?: DeployTag[]
  /** Extra tags to include on Eval action messages */
  actionTags?: DeployTag[]
}

export interface HyperengineConfig {
  /** Named process definitions */
  processes: Record<string, ProcessConfig>
  /** Output directory (default: "dist") */
  outDir?: string
  /** Shared template defaults for all processes */
  templates?: TemplateConfig
  /** Shared luarocks defaults for all processes */
  luarocks?: LuarocksConfig
  /** Enable AO message handlers for template CRUD */
  handlers?: boolean
  /** Enable admin UI for template & ACL management. `true` for defaults, or pass options.
   *  Implicitly enables `handlers` when set. */
  adminInterface?: boolean | AdminInterfaceConfig
  /** Top-level key used when publishing rendered templates to `patch@1.0`.
   *  Nesting under this key causes the JSON device to lazylink-encode HTML,
   *  preventing raw HTML from appearing in message headers. (default: "ui") */
  patchKey?: string
  /** Key under which template and ACL state is synced to `patch@1.0`.
   *  State is nested as `{ templates: ..., acl: ... }` under this key. (default: "hyperengine_state") */
  stateKey?: string
  /** Build as an aos module — clones the aos repo at the given commit and outputs the user's bundle as a require()'d module */
  aos?: AosConfig
  /** Deploy & publish configuration */
  deploy?: DeployConfig
}

export interface ResolvedProcessConfig {
  /** Process name (key from processes map) */
  name: string
  /** Artifact type: 'process' or 'module' (dynamic read module) */
  type: 'process' | 'module'
  /** Absolute path to the Lua entry point */
  entry: string
  /** Absolute path to the output directory */
  outDir: string
  /** Output filename */
  outFile: string
  /** Absolute path to the project root */
  root: string
  /** Published module transaction ID (for WASM module builds) */
  moduleId?: string
  templates: {
    extensions: string[]
    dir: string
    vite: ViteTemplateOptions | false
  }
  luarocks: {
    dependencies: Record<string, string>
    luaVersion: string
  }
  handlers: boolean
  adminInterface: {
    enabled: boolean
    path: string
    dir: string
  }
  /** Top-level key used when publishing to patch@1.0 (default: "ui") */
  patchKey: string
  /** Key under which template and ACL state is synced to patch@1.0 (default: "hyperengine_state") */
  stateKey: string
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
    stack_size: number
    initial_memory: number
    maximum_memory: number
    target: 32 | 64
    compute_limit: string
    module_format: string
    exclude: string[]
  }
  deploy: ResolvedDeployConfig
}

export const DEFAULT_SCHEDULER = '_GQ33BkPtZrqxA84vM8Zk-N2aO0toNNu_C-l-rawrBA'
export const AOS_MODULE_ID = 'ISShJH1ij-hPPt9St5UFFr_8Ys3Kj5cyg7zrMGt7H9s'

export interface ResolvedDeployConfig {
  hyperbeamUrl?: string
  wallet?: string
  scheduler: string
  authority: string
  spawnTags: DeployTag[]
  actionTags: DeployTag[]
}

export function resolveDeployConfig(raw?: DeployConfig): ResolvedDeployConfig {
  const scheduler = raw?.scheduler ?? DEFAULT_SCHEDULER
  return {
    hyperbeamUrl: process.env.HYPERBEAM_URL || raw?.hyperbeamUrl || undefined,
    wallet: process.env.WALLET_PATH || raw?.wallet || undefined,
    scheduler,
    authority: raw?.authority ?? scheduler,
    spawnTags: raw?.spawnTags ?? [],
    actionTags: raw?.actionTags ?? [],
  }
}

export const DEFAULT_EXTENSIONS = ['.html', '.htm', '.tmpl', '.mustache', '.mst', '.mu', '.stache']

const CONFIG_FILES = [
  'hyperengine.config.ts',
  'hyperengine.config.js',
  'hyperengine.config.mjs',
]

const SUPPORTED_EXTENSIONS = ['.ts', '.js', '.mjs']

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

function resolveAdminInterface(
  shared: boolean | AdminInterfaceConfig | undefined,
  perProcess: boolean | AdminInterfaceConfig | undefined,
  root: string,
): { enabled: boolean; path: string; dir: string } {
  const raw = perProcess ?? shared
  if (raw === true) return { enabled: true, path: 'admin', dir: resolve(root, 'src/admin') }
  if (raw && typeof raw === 'object') return { enabled: true, path: raw.path ?? 'admin', dir: resolve(root, raw.dir ?? 'src/admin') }
  return { enabled: false, path: 'admin', dir: resolve(root, 'src/admin') }
}

export async function resolveConfig(
  raw: HyperengineConfig,
  root: string,
): Promise<ResolvedConfig> {
  const entries = Object.entries(raw.processes)
  if (entries.length === 0) {
    throw new Error('At least one process must be defined in "processes".')
  }

  // Validate aos config
  const aosTarget = raw.aos?.target ?? 64
  const aos: ResolvedConfig['aos'] = raw.aos
    ? {
        enabled: true,
        commit: raw.aos.commit,
        stack_size: raw.aos.stack_size ?? 3_145_728,
        initial_memory: raw.aos.initial_memory ?? 4_194_304,
        maximum_memory: raw.aos.maximum_memory ?? 1_073_741_824,
        target: aosTarget,
        compute_limit: raw.aos.compute_limit ?? '9000000000000',
        module_format: raw.aos.module_format ?? `wasm${aosTarget}-unknown-emscripten-draft_2024_02_15`,
        exclude: raw.aos.exclude ?? [],
      }
    : {
        enabled: false,
        commit: '',
        stack_size: 3_145_728,
        initial_memory: 4_194_304,
        maximum_memory: 1_073_741_824,
        target: 64 as const,
        compute_limit: '9000000000000',
        module_format: 'wasm64-unknown-emscripten-draft_2024_02_15',
        exclude: [],
      }

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
      const adminInterface = resolveAdminInterface(raw.adminInterface, proc.adminInterface, root)

      const defaultOutFile = basename(proc.entry, '.lua') + '.lua'

      return {
        name,
        type: proc.type ?? 'process',
        entry,
        outDir,
        outFile: proc.outFile ?? defaultOutFile,
        root,
        moduleId: proc.moduleId,
        templates: {
          extensions: mergedTemplates.extensions ?? DEFAULT_EXTENSIONS,
          dir: await resolveTemplatesDir(root, entryDir, mergedTemplates.dir),
          vite: resolveViteOpts(mergedTemplates.vite),
        },
        luarocks: {
          dependencies: mergedLuarocks.dependencies ?? {},
          luaVersion: mergedLuarocks.luaVersion ?? '5.3',
        },
        adminInterface,
        handlers: adminInterface.enabled ? true : (proc.handlers ?? raw.handlers ?? false),
        patchKey: proc.patchKey ?? raw.patchKey ?? 'ui',
        stateKey: proc.stateKey ?? raw.stateKey ?? 'hyperengine_state',
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
    deploy: resolveDeployConfig(raw.deploy),
  }
}

export async function loadConfig(root: string, configPath?: string): Promise<ResolvedConfig> {
  loadDotenv(root)

  if (configPath) {
    const filePath = resolve(root, configPath)
    const ext = extname(filePath)
    if (!SUPPORTED_EXTENSIONS.includes(ext)) {
      throw new Error(
        `Unsupported config file extension "${ext}". Use one of: ${SUPPORTED_EXTENSIONS.join(', ')}`,
      )
    }
    try {
      await readFile(filePath)
    } catch {
      throw new Error(`Config file not found: ${filePath}`)
    }
    const config = await importConfig(filePath, root)
    return await resolveConfig(config, root)
  }

  for (const name of CONFIG_FILES) {
    const filePath = resolve(root, name)
    try {
      await readFile(filePath)
    } catch {
      continue
    }

    const config = await importConfig(filePath, root)
    return await resolveConfig(config, root)
  }

  throw new Error(
    `No config file found. Create one of: ${CONFIG_FILES.join(', ')}`,
  )
}

async function importConfig(filePath: string, root: string): Promise<HyperengineConfig> {
  const ext = extname(filePath)
  let config: HyperengineConfig

  if (ext === '.ts') {
    // Bundle the TS config to a temp ESM file with esbuild, then import it
    const { build } = await import('esbuild')
    const outdir = resolve(root, 'node_modules', '.hyperengine')
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
        name: 'hyperengine-config-shim',
        setup(b) {
          b.onResolve({ filter: /^@memetic-block\/hyperengine$/ }, () => ({
            path: '@memetic-block/hyperengine',
            namespace: 'hyperengine-shim',
          }))
          b.onLoad({ filter: /.*/, namespace: 'hyperengine-shim' }, () => ({
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

  return config
}

export function defineConfig(config: HyperengineConfig): HyperengineConfig {
  return config
}
