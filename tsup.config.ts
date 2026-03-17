import { defineConfig } from 'tsup'
import { copyFileSync, mkdirSync } from 'node:fs'
import { resolve } from 'node:path'

export default defineConfig({
  entry: {
    index: 'src/index.ts',
    cli: 'src/cli.ts',
    vite: 'src/vite-plugin.ts',
  },
  format: ['esm'],
  dts: true,
  clean: true,
  target: 'node18',
  splitting: true,
  sourcemap: true,
  shims: false,
  external: [
    'commander',
    'fast-glob',
    'vite',
    'esbuild',
  ],
  onSuccess: async () => {
    // Copy Lua runtime files to dist/lua/ so they resolve via import.meta.url
    const outDir = resolve('dist', 'lua')
    mkdirSync(outDir, { recursive: true })
    copyFileSync(resolve('src', 'lua', 'runtime.lua'), resolve(outDir, 'runtime.lua'))
  },
})
