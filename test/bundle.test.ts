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
        processes: {
          main: { entry: 'src/process.lua' },
        },
        outDir: 'dist',
      },
      fixtureRoot,
    )

    const results = await bundle(config)
    expect(results).toHaveLength(1)
    const result = results[0]

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

    // Process name should be set
    expect(result.processName).toBe('main')

    // Runtime not included by default
    expect(result.runtimeIncluded).toBe(false)
  })

  it('bundles with runtime module when enabled', async () => {
    const config = await resolveConfig(
      {
        processes: {
          main: { entry: 'src/process.lua' },
        },
        outDir: 'dist',
        runtime: true,
      },
      fixtureRoot,
    )

    const results = await bundle(config)
    expect(results).toHaveLength(1)
    const result = results[0]

    expect(result.runtimeIncluded).toBe(true)
    expect(result.output).toContain('_modules["hyperstache"]')
    expect(result.output).toContain('hyperstache_templates')
    expect(result.output).toContain('function hyperstache.get(key)')
    expect(result.output).toContain('function hyperstache.render(key, data)')

    // Runtime module should appear after templates module
    const templatesIdx = result.output.indexOf('_modules["templates"]')
    const runtimeIdx = result.output.indexOf('_modules["hyperstache"]')
    expect(runtimeIdx).toBeGreaterThan(templatesIdx)
  })

  it('auto-requires runtime when handlers mode is enabled', async () => {
    const config = await resolveConfig(
      {
        processes: {
          main: { entry: 'src/process.lua' },
        },
        outDir: 'dist',
        runtime: { handlers: true },
      },
      fixtureRoot,
    )

    const results = await bundle(config)
    const result = results[0]

    expect(result.runtimeIncluded).toBe(true)

    // Should auto-require in entry section
    const entryIdx = result.output.indexOf('-- Entry point')
    const afterEntry = result.output.slice(entryIdx)
    expect(afterEntry).toContain('require("hyperstache")')

    // Should auto-register handlers inside the module
    expect(result.output).toContain('Handlers.add("Hyperstache-Get"')
    expect(result.output).toContain('hyperstache.handlers()')
  })

  it('bundles with admin interface when enabled', async () => {
    const config = await resolveConfig(
      {
        processes: {
          main: { entry: 'src/process.lua' },
        },
        outDir: 'dist',
        runtime: { adminInterface: true },
      },
      fixtureRoot,
    )

    const results = await bundle(config)
    const result = results[0]

    expect(result.runtimeIncluded).toBe(true)
    expect(result.adminIncluded).toBe(true)

    // Admin module should be registered
    expect(result.output).toContain('_modules["hyperstache-admin"]')

    // Admin module should appear after runtime module
    const runtimeIdx = result.output.indexOf('_modules["hyperstache"]')
    const adminIdx = result.output.indexOf('_modules["hyperstache-admin"]')
    expect(adminIdx).toBeGreaterThan(runtimeIdx)

    // Should auto-require admin in entry section
    const entryIdx = result.output.indexOf('-- Entry point')
    const afterEntry = result.output.slice(entryIdx)
    expect(afterEntry).toContain('require("hyperstache-admin")')

    // Should contain admin UI HTML
    expect(result.output).toContain('Hyperstache Admin')
    expect(result.output).toContain('patch@1.0')

    // Handlers should be forced on by adminInterface
    expect(result.output).toContain('hyperstache.handlers()')
  })

  it('bundles admin interface with custom path key', async () => {
    const config = await resolveConfig(
      {
        processes: {
          main: { entry: 'src/process.lua' },
        },
        outDir: 'dist',
        runtime: { adminInterface: { path: 'manage' } },
      },
      fixtureRoot,
    )

    const results = await bundle(config)
    const result = results[0]

    expect(result.adminIncluded).toBe(true)
    expect(result.output).toContain('local _path = "manage"')
    expect(result.output).not.toContain('__ADMIN_PATH__')
  })
})
