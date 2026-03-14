import { describe, it, expect, afterEach } from 'vitest'
import { resolveConfig } from '../src/config.js'
import { bundle } from '../src/bundler/index.js'
import { resolve } from 'node:path'
import { rm } from 'node:fs/promises'

describe('bundle integration', () => {
  const fixtureRoot = resolve(__dirname, 'fixtures/sample-app')
  const outDir = resolve(fixtureRoot, 'dist')

  // Clean up after tests
  afterEach(async () => {
    await rm(outDir, { recursive: true, force: true }).catch(() => {})
  })

  it('bundles sample app into a single Lua file', async () => {
    const config = await resolveConfig(
      {
        entry: 'src/process.lua',
        outDir: 'dist',
      },
      fixtureRoot,
    )

    const result = await bundle(config)

    // Should have entry + lib.utils
    expect(result.moduleCount).toBe(2)

    // Should have 2 templates
    expect(result.templateCount).toBe(2)

    // Output should contain the module loader
    expect(result.output).toContain('local _modules = {}')

    // Output should contain the utils module
    expect(result.output).toContain('_modules["lib.utils"]')

    // Output should contain inlined templates
    expect(result.output).toContain('_modules["templates"]')
    expect(result.output).toContain('{{title}}')
    expect(result.output).toContain('{{username}}')

    // Entry source should be at the end
    expect(result.output).toContain("local utils = require('lib.utils')")

    // lustache and templates should be unresolved (external)
    // lustache is unresolved because it's not in the project
    expect(result.unresolved).toContain('lustache')
  })
})
