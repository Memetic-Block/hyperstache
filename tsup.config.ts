import { defineConfig } from 'tsup'
import { cpSync } from 'node:fs'
import { resolve } from 'node:path'

export default defineConfig({
  entry: {
    index: 'src/index.ts',
    cli: 'src/cli.ts',
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
    '@permaweb/aoconnect',
    '@ardrive/turbo-sdk',
    'dotenv',
  ],
  onSuccess: async () => {
    // Copy all Lua runtime files (runtime.lua + lustache) to dist/lua/
    cpSync(resolve('src', 'lua'), resolve('dist', 'lua'), { recursive: true })

    // Copy admin scaffold files to dist/scaffolds/admin/
    cpSync(resolve('src', 'scaffolds', 'admin'), resolve('dist', 'scaffolds', 'admin'), { recursive: true })
  },
})
