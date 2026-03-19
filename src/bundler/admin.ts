import { readFile } from 'node:fs/promises'
import { resolve, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = dirname(fileURLToPath(import.meta.url))

export interface AdminOptions {
  handlers: boolean
  /** Path key used in the patch@1.0 Send call (default: "admin") */
  path?: string
}

/**
 * Resolve the path to the admin Lua runtime file.
 *
 * Same dual-layout detection as runtime.ts:
 * - Source: src/bundler/ → ../lua/admin.lua
 * - Dist: dist/ → dist/lua/admin.lua
 */
function luaPath(name: string): string {
  if (__dirname.endsWith('src/bundler') || __dirname.endsWith('src\\bundler')) {
    return resolve(__dirname, '..', 'lua', name)
  }
  return resolve(__dirname, 'lua', name)
}

/**
 * Generate the Lua source for the `hyperstache-admin` module.
 *
 * Reads `src/lua/admin.lua`, replaces the `__ADMIN_PATH__` placeholder
 * with the configured path key, and optionally injects the
 * `admin.handlers()` auto-call before the final `return`.
 */
export async function generateAdminSource(options: AdminOptions): Promise<string> {
  let source = await readFile(luaPath('admin.lua'), 'utf-8')

  // Replace the path placeholder with the configured path key
  const pathKey = options.path ?? 'admin'
  source = source.replace(/__ADMIN_PATH__/g, pathKey)

  if (options.handlers) {
    source = source.replace(
      /\nreturn admin\s*$/,
      '\nadmin.handlers()\n\nreturn admin\n',
    )
  }

  return source
}
