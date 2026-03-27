import { writeFile } from 'node:fs/promises'
import { resolve, basename } from 'node:path'
import type { ResolvedConfig } from './config.js'

/**
 * Generate a .rockspec file from the hyperengine config.
 */
export function generateRockspec(
  config: ResolvedConfig,
  packageName?: string,
  version?: string,
): string {
  const name = packageName ?? basename(config.root)
  const ver = version ?? '0.1.0'
  const rockVer = `${ver}-1`
  const luaVer = config.luarocks.luaVersion

  const deps = Object.entries(config.luarocks.dependencies)
  const depLines = deps.map(([pkg, ver]) => `    "${pkg} ${ver}"`)

  const lines: string[] = [
    `package = "${name}"`,
    `version = "${rockVer}"`,
    '',
    'source = {',
    `  url = ""`,
    '}',
    '',
    'description = {',
    `  summary = "${name} - AO Lua process"`,
    '}',
    '',
    'dependencies = {',
    `  "lua >= ${luaVer}"`,
    ...(depLines.length > 0 ? [','] : []).flatMap(() => []),
  ]

  // Build dependencies block properly
  const allDeps = [`  "lua >= ${luaVer}"`]
  for (const [pkg, pkgVer] of deps) {
    allDeps.push(`  "${pkg} ${pkgVer}"`)
  }

  const rockspec = [
    `package = "${name}"`,
    `version = "${rockVer}"`,
    '',
    'source = {',
    '  url = ""',
    '}',
    '',
    'description = {',
    `  summary = "${name} - AO Lua process"`,
    '}',
    '',
    'dependencies = {',
    allDeps.join(',\n'),
    '}',
    '',
    'build = {',
    '  type = "builtin"',
    '}',
  ].join('\n')

  return rockspec
}

/**
 * Write the rockspec file to disk.
 */
export async function writeRockspec(
  config: ResolvedConfig,
  packageName?: string,
  version?: string,
): Promise<string> {
  const name = packageName ?? basename(config.root)
  const ver = version ?? '0.1.0'
  const rockVer = `${ver}-1`
  const fileName = `${name}-${rockVer}.rockspec`
  const filePath = resolve(config.root, fileName)
  const content = generateRockspec(config, packageName, version)
  await writeFile(filePath, content, 'utf-8')
  return filePath
}
