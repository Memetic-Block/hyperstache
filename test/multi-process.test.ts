import { describe, it, expect, afterEach } from 'vitest'
import { resolveConfig } from '../src/config.js'
import { bundle, bundleProcess } from '../src/bundler/index.js'
import { resolve } from 'node:path'
import { rm } from 'node:fs/promises'

// ---------------------------------------------------------------------------
// Config resolution
// ---------------------------------------------------------------------------

describe('resolveConfig multi-process', () => {
  it('resolves multiple processes with shared defaults', async () => {
    const config = await resolveConfig(
      {
        processes: {
          main: { entry: 'src/process.lua' },
          worker: { entry: 'src/worker.lua' },
        },
        luarocks: {
          dependencies: { lustache: '1.3.1-0' },
        },
      },
      '/fake/project',
    )

    expect(config.processes).toHaveLength(2)

    const main = config.processes.find(p => p.name === 'main')!
    const worker = config.processes.find(p => p.name === 'worker')!

    expect(main.entry).toBe('/fake/project/src/process.lua')
    expect(worker.entry).toBe('/fake/project/src/worker.lua')

    // Both inherit luarocks from top level
    expect(main.luarocks.dependencies).toEqual({ lustache: '1.3.1-0' })
    expect(worker.luarocks.dependencies).toEqual({ lustache: '1.3.1-0' })
  })

  it('derives outFile from entry filename', async () => {
    const config = await resolveConfig(
      {
        processes: {
          main: { entry: 'src/process.lua' },
          worker: { entry: 'src/worker.lua' },
        },
      },
      '/fake/project',
    )

    const main = config.processes.find(p => p.name === 'main')!
    const worker = config.processes.find(p => p.name === 'worker')!

    expect(main.outFile).toBe('process.lua')
    expect(worker.outFile).toBe('worker.lua')
  })

  it('allows explicit outFile override', async () => {
    const config = await resolveConfig(
      {
        processes: {
          main: { entry: 'src/process.lua', outFile: 'custom.lua' },
        },
      },
      '/fake/project',
    )

    expect(config.processes[0].outFile).toBe('custom.lua')
  })

  it('per-process templates override shared defaults', async () => {
    const root = resolve(__dirname, 'fixtures/multi-app')
    const config = await resolveConfig(
      {
        processes: {
          main: { entry: 'src/process.lua' },
          worker: { entry: 'src/worker.lua', templates: { extensions: ['.tmpl'] } },
        },
        templates: { extensions: ['.html', '.htm'] },
      },
      root,
    )

    const main = config.processes.find(p => p.name === 'main')!
    const worker = config.processes.find(p => p.name === 'worker')!

    expect(main.templates.extensions).toEqual(['.html', '.htm'])
    expect(worker.templates.extensions).toEqual(['.tmpl'])
  })

  it('per-process luarocks merges with shared defaults', async () => {
    const config = await resolveConfig(
      {
        processes: {
          main: { entry: 'src/process.lua' },
          worker: { entry: 'src/worker.lua', luarocks: { dependencies: { json: '1.0-0' } } },
        },
        luarocks: { dependencies: { lustache: '1.3.1-0' } },
      },
      '/fake/project',
    )

    const main = config.processes.find(p => p.name === 'main')!
    const worker = config.processes.find(p => p.name === 'worker')!

    // main gets only shared
    expect(main.luarocks.dependencies).toEqual({ lustache: '1.3.1-0' })
    // worker gets shared + its own
    expect(worker.luarocks.dependencies).toEqual({ lustache: '1.3.1-0', json: '1.0-0' })
  })

  it('throws on empty processes', async () => {
    await expect(
      resolveConfig({ processes: {} }, '/fake/project'),
    ).rejects.toThrow('At least one process must be defined')
  })

  it('throws on conflicting luarocks versions', async () => {
    await expect(
      resolveConfig(
        {
          processes: {
            main: { entry: 'src/a.lua', luarocks: { dependencies: { lustache: '1.3.1-0' } } },
            worker: { entry: 'src/b.lua', luarocks: { dependencies: { lustache: '2.0.0-0' } } },
          },
        },
        '/fake/project',
      ),
    ).rejects.toThrow('Conflicting luarocks dependency versions')
  })

  it('defaults type to process', async () => {
    const config = await resolveConfig(
      {
        processes: {
          main: { entry: 'src/process.lua' },
        },
      },
      '/fake/project',
    )

    expect(config.processes[0].type).toBe('process')
  })

  it('accepts explicit type module', async () => {
    const config = await resolveConfig(
      {
        processes: {
          main: { entry: 'src/process.lua' },
          reader: { entry: 'src/reader.lua', type: 'module' },
        },
      },
      '/fake/project',
    )

    const main = config.processes.find(p => p.name === 'main')!
    const reader = config.processes.find(p => p.name === 'reader')!

    expect(main.type).toBe('process')
    expect(reader.type).toBe('module')
  })
})

// ---------------------------------------------------------------------------
// Multi-process bundling
// ---------------------------------------------------------------------------

describe('multi-process bundling', () => {
  const fixtureRoot = resolve(__dirname, 'fixtures/multi-app')
  const outDir = resolve(fixtureRoot, 'dist')

  afterEach(async () => {
    await rm(outDir, { recursive: true, force: true }).catch(() => {})
  })

  it('bundles two processes into separate files', async () => {
    const config = await resolveConfig(
      {
        processes: {
          main: { entry: 'src/process.lua' },
          worker: { entry: 'src/worker.lua', outFile: 'worker.lua' },
        },
        luarocks: {
          dependencies: { lustache: '1.3.1-0' },
        },
      },
      fixtureRoot,
    )

    const results = await bundle(config)

    expect(results).toHaveLength(2)

    const main = results.find(r => r.processName === 'main')!
    const worker = results.find(r => r.processName === 'worker')!

    // Main process: has lib.utils + entry, has templates
    expect(main.moduleCount).toBe(2)
    expect(main.templateCount).toBe(1) // index.html
    expect(main.output).toContain('_modules["lib.utils"]')
    expect(main.output).toContain('_modules["templates"]')
    expect(main.output).toContain("require('lib.utils')")
    expect(main.outPath).toContain('process.lua')

    // Worker process: has lib.utils + entry, no templates dir specific to worker
    expect(worker.moduleCount).toBe(2)
    expect(worker.output).toContain('_modules["lib.utils"]')
    expect(worker.output).toContain("require('lib.utils')")
    expect(worker.outPath).toContain('worker.lua')
  })

  it('bundleProcess bundles a single named process', async () => {
    const config = await resolveConfig(
      {
        processes: {
          main: { entry: 'src/process.lua' },
          worker: { entry: 'src/worker.lua', outFile: 'worker.lua' },
        },
      },
      fixtureRoot,
    )

    const workerProc = config.processes.find(p => p.name === 'worker')!
    const result = await bundleProcess(workerProc)

    expect(result.processName).toBe('worker')
    expect(result.moduleCount).toBe(2) // lib.utils + worker entry
    expect(result.output).toContain('_modules["lib.utils"]')
    expect(result.output).toContain("require('lib.utils')")
  })

  it('bundles module-type artifact with raw emitBundle output', async () => {
    const config = await resolveConfig(
      {
        processes: {
          main: { entry: 'src/process.lua' },
          reader: { entry: 'src/reader.lua', type: 'module' },
        },
      },
      fixtureRoot,
    )

    const results = await bundle(config)
    const reader = results.find(r => r.processName === 'reader')!

    // Should use raw emitBundle (no _init wrapper)
    expect(reader.output).toContain('-- Bundled by hyperengine')
    expect(reader.output).toContain('local _modules = {}')
    expect(reader.output).not.toContain('local function _init()')
    expect(reader.output).not.toContain('return {}')

    // Type metadata should be set
    expect(reader.type).toBe('module')

    // Should not be flagged as aos
    expect(reader.aosModule).toBe(false)
    expect(reader.aosCopiedFiles).toEqual([])

    // Should resolve its module
    expect(reader.moduleCount).toBe(2) // lib.utils + reader entry
    expect(reader.output).toContain('_modules["lib.utils"]')
  })

  it('module-type skips aos even when aos config is present', async () => {
    const config = await resolveConfig(
      {
        processes: {
          main: { entry: 'src/process.lua' },
          reader: { entry: 'src/reader.lua', type: 'module' },
        },
        aos: { commit: 'abc1234' },
      },
      fixtureRoot,
    )

    // Only bundle the reader (skip main to avoid needing real aos repo)
    const readerProc = config.processes.find(p => p.name === 'reader')!
    const result = await bundleProcess(readerProc, config.aos)

    // Raw output, no _init wrapper
    expect(result.output).toContain('-- Bundled by hyperengine')
    expect(result.output).not.toContain('local function _init()')

    // AOS completely skipped
    expect(result.aosModule).toBe(false)
    expect(result.aosCopiedFiles).toEqual([])

    // Should output directly to outDir, not nested under processName/
    expect(result.outPath).toBe(resolve(fixtureRoot, 'dist', 'reader.lua'))
  })
})
