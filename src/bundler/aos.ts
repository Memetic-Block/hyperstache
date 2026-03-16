import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { cp, readFile, writeFile, mkdir, readdir, stat, access } from 'node:fs/promises'
import { join, relative, dirname } from 'node:path'

const execFileAsync = promisify(execFile)

/**
 * Ensure the aos repo is cloned and checked out at the given commit.
 * Caches in `{root}/node_modules/.cache/hyperstache/aos-{commit}`.
 * Returns the path to the cached repo.
 */
export async function ensureAosRepo(commit: string, root: string): Promise<string> {
  const cacheDir = join(root, 'node_modules', '.cache', 'hyperstache', `aos-${commit}`)
  const marker = join(cacheDir, '.complete')

  // Check if already cached
  try {
    await access(marker)
    return cacheDir
  } catch {
    // Not cached yet — clone
  }

  // Verify git is available
  try {
    await execFileAsync('git', ['--version'])
  } catch {
    throw new Error(
      'git is required for aos module builds but was not found on PATH. Please install git.',
    )
  }

  await mkdir(cacheDir, { recursive: true })

  // Clone with no checkout, then checkout the specific commit
  await execFileAsync('git', ['clone', '--no-checkout', 'https://github.com/permaweb/aos', '.'], { cwd: cacheDir })
  await execFileAsync('git', ['checkout', commit], { cwd: cacheDir })

  // Write marker
  await writeFile(marker, commit, 'utf-8')

  return cacheDir
}

/**
 * Recursively find all .lua files under `dir`, returning paths relative to `dir`.
 */
async function findLuaFiles(dir: string, base: string = ''): Promise<string[]> {
  const results: string[] = []
  const entries = await readdir(dir, { withFileTypes: true })
  for (const entry of entries) {
    const rel = base ? join(base, entry.name) : entry.name
    if (entry.isDirectory()) {
      results.push(...await findLuaFiles(join(dir, entry.name), rel))
    } else if (entry.name.endsWith('.lua')) {
      results.push(rel)
    }
  }
  return results
}

/**
 * Copy all .lua files from the aos repo's `process/` directory into `outDir`.
 * Preserves subdirectory structure. Returns the list of relative paths copied.
 */
export async function copyAosProcessFiles(repoPath: string, outDir: string): Promise<string[]> {
  const processDir = join(repoPath, 'process')
  const luaFiles = await findLuaFiles(processDir)

  for (const rel of luaFiles) {
    const src = join(processDir, rel)
    const dest = join(outDir, rel)
    await mkdir(dirname(dest), { recursive: true })
    await cp(src, dest)
  }

  return luaFiles
}

/**
 * Inject a `require()` call into the aos process.lua after the last
 * `Handlers.add(` or `Handlers.append(` call.
 *
 * Tracks parenthesis depth to handle multi-line handler registrations,
 * then inserts `require("{moduleName}")` on the line after the closing paren.
 * Falls back to appending at end of file if no Handlers call is found.
 */
export async function injectRequire(processLuaPath: string, moduleName: string): Promise<void> {
  const content = await readFile(processLuaPath, 'utf-8')
  const lines = content.split('\n')

  // Find all Handlers.add / Handlers.append call start positions
  const handlerPattern = /Handlers\s*\.\s*(?:add|append)\s*\(/
  let lastHandlerEnd = -1

  for (let i = 0; i < lines.length; i++) {
    if (handlerPattern.test(lines[i])) {
      // Found a Handlers call — track parens to find the end
      let depth = 0
      let foundOpen = false
      for (let j = i; j < lines.length; j++) {
        for (const ch of lines[j]) {
          if (ch === '(') {
            depth++
            foundOpen = true
          } else if (ch === ')') {
            depth--
          }
          if (foundOpen && depth === 0) {
            lastHandlerEnd = j
            break
          }
        }
        if (foundOpen && depth === 0) break
      }
    }
  }

  const requireLine = `require("${moduleName}")`

  if (lastHandlerEnd >= 0) {
    // Insert after the last handler call
    lines.splice(lastHandlerEnd + 1, 0, '', requireLine)
  } else {
    // No handler calls found — append at end
    lines.push('', requireLine)
  }

  await writeFile(processLuaPath, lines.join('\n'), 'utf-8')
}

export interface AosYamlOptions {
  stack_size: number
  initial_memory: number
  maximum_memory: number
  target: 32 | 64
  aos_git_hash: string
  compute_limit: string
  module_format: string
}

/**
 * Generate YAML content for ao-dev-cli configuration.
 */
export function generateAosYaml(opts: AosYamlOptions): string {
  const lines: string[] = []
  lines.push('# ao-dev-cli options')
  lines.push(`stack_size: ${opts.stack_size}`)
  lines.push(`initial_memory: ${opts.initial_memory}`)
  lines.push(`maximum_memory: ${opts.maximum_memory}`)
  lines.push(`target: ${opts.target}`)
  lines.push('# extra info')
  lines.push(`aos_git_hash: '${opts.aos_git_hash}'`)
  lines.push(`compute_limit: '${opts.compute_limit}'`)
  lines.push(`module_format: '${opts.module_format}'`)
  return lines.join('\n') + '\n'
}

/**
 * Write the ao-dev-cli YAML configuration file to `outDir/config.yml`.
 */
export async function writeAosYaml(outDir: string, opts: AosYamlOptions): Promise<string> {
  const yamlContent = generateAosYaml(opts)
  const yamlPath = join(outDir, 'config.yml')
  await mkdir(outDir, { recursive: true })
  await writeFile(yamlPath, yamlContent, 'utf-8')
  return yamlPath
}
