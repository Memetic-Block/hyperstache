import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { mkdtemp, rm, writeFile, mkdir } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import type { ResolvedProcessConfig, ResolvedConfig } from '../src/config.js'

// Mock @permaweb/ao-loader
const mockHandle = vi.fn()
const mockAoLoader = vi.fn()
vi.mock('@permaweb/ao-loader', () => ({
  default: (...args: unknown[]) => mockAoLoader(...args),
}))

import { smokeProcess, smoke } from '../src/smoke.js'

let tmp: string

beforeEach(async () => {
  tmp = await mkdtemp(join(tmpdir(), 'hs-smoke-'))
  vi.clearAllMocks()
  mockAoLoader.mockResolvedValue(mockHandle)
  mockHandle.mockResolvedValue({ GasUsed: 42 })
})

afterEach(async () => {
  await rm(tmp, { recursive: true, force: true })
})

function makeProc(overrides: Partial<ResolvedProcessConfig> = {}): ResolvedProcessConfig {
  return {
    name: 'main',
    type: 'process',
    entry: join(tmp, 'src/process.lua'),
    outDir: join(tmp, 'dist'),
    outFile: 'process.lua',
    root: tmp,
    templates: { extensions: ['.html'], dir: join(tmp, 'src/templates'), vite: false },
    luarocks: { dependencies: {}, luaVersion: '5.3' },
    handlers: false,
    adminInterface: { enabled: false, path: 'admin', dir: join(tmp, 'src/admin') },
    patchKey: 'ui',
    stateKey: 'hyperengine_state',
    ...overrides,
  }
}

const aosEnabled: ResolvedConfig['aos'] = {
  enabled: true,
  commit: 'abc1234',
  stack_size: 3_145_728,
  initial_memory: 4_194_304,
  maximum_memory: 1_073_741_824,
  target: 64,
  compute_limit: '9000000000000',
  module_format: 'wasm64-unknown-emscripten-draft_2024_02_15',
  exclude: [],
}

const aosDisabled: ResolvedConfig['aos'] = {
  ...aosEnabled,
  enabled: false,
}

describe('smokeProcess', () => {
  it('returns failure when WASM artifact is missing', async () => {
    const proc = makeProc()
    const result = await smokeProcess(proc, aosEnabled)
    expect(result.success).toBe(false)
    expect(result.error).toMatch(/No WASM artifact found/)
    expect(result.error).toMatch(/hyperengine build/)
  })

  it('passes when WASM loads and executes without error', async () => {
    const proc = makeProc()
    await mkdir(join(tmp, 'dist', 'main'), { recursive: true })
    await writeFile(join(tmp, 'dist', 'main', 'process.wasm'), Buffer.from([0x00, 0x61, 0x73, 0x6d]))

    const result = await smokeProcess(proc, aosEnabled)
    expect(result.success).toBe(true)
    expect(result.processName).toBe('main')
    expect(result.gasUsed).toBe(42)
    expect(mockAoLoader).toHaveBeenCalledWith(
      expect.any(Buffer),
      expect.objectContaining({
        format: 'wasm64-unknown-emscripten-draft_2024_02_15',
        memoryLimit: '1073741824',
        computeLimit: '9000000000000',
      }),
    )
  })

  it('returns failure when AoLoader init throws', async () => {
    const proc = makeProc()
    await mkdir(join(tmp, 'dist', 'main'), { recursive: true })
    await writeFile(join(tmp, 'dist', 'main', 'process.wasm'), Buffer.from([0x00]))

    mockAoLoader.mockRejectedValue(new Error('Invalid WASM'))
    const result = await smokeProcess(proc, aosEnabled)
    expect(result.success).toBe(false)
    expect(result.error).toMatch(/Failed to initialise WASM module/)
  })

  it('returns failure when handle execution throws', async () => {
    const proc = makeProc()
    await mkdir(join(tmp, 'dist', 'main'), { recursive: true })
    await writeFile(join(tmp, 'dist', 'main', 'process.wasm'), Buffer.from([0x00]))

    mockHandle.mockRejectedValue(new Error('Out of memory'))
    const result = await smokeProcess(proc, aosEnabled)
    expect(result.success).toBe(false)
    expect(result.error).toMatch(/WASM execution failed/)
  })

  it('returns failure when result contains Error field', async () => {
    const proc = makeProc()
    await mkdir(join(tmp, 'dist', 'main'), { recursive: true })
    await writeFile(join(tmp, 'dist', 'main', 'process.wasm'), Buffer.from([0x00]))

    mockHandle.mockResolvedValue({ Error: 'handler crashed', GasUsed: 10 })
    const result = await smokeProcess(proc, aosEnabled)
    expect(result.success).toBe(false)
    expect(result.error).toBe('handler crashed')
    expect(result.gasUsed).toBe(10)
  })

  it('passes config-derived options to AoLoader', async () => {
    const proc = makeProc()
    await mkdir(join(tmp, 'dist', 'main'), { recursive: true })
    await writeFile(join(tmp, 'dist', 'main', 'process.wasm'), Buffer.from([0x00]))

    const customAos: ResolvedConfig['aos'] = {
      ...aosEnabled,
      module_format: 'wasm64-unknown-emscripten-metering',
      maximum_memory: 2_147_483_648,
      compute_limit: '1000000000',
    }
    await smokeProcess(proc, customAos)
    expect(mockAoLoader).toHaveBeenCalledWith(
      expect.any(Buffer),
      expect.objectContaining({
        format: 'wasm64-unknown-emscripten-metering',
        memoryLimit: '2147483648',
        computeLimit: '1000000000',
      }),
    )
  })
})

describe('smoke', () => {
  it('returns errors for all processes when aos is disabled', async () => {
    const config: ResolvedConfig = {
      root: tmp,
      outDir: join(tmp, 'dist'),
      processes: [makeProc(), makeProc({ name: 'worker' })],
      luarocks: { dependencies: {}, luaVersion: '5.3' },
      aos: aosDisabled,
      deploy: { scheduler: 'x', authority: 'x', spawnTags: [], actionTags: [] },
    }
    const results = await smoke(config)
    expect(results).toHaveLength(2)
    expect(results.every(r => !r.success)).toBe(true)
    expect(results[0].error).toMatch(/aos is not enabled/)
  })

  it('filters out type module processes', async () => {
    const config: ResolvedConfig = {
      root: tmp,
      outDir: join(tmp, 'dist'),
      processes: [
        makeProc({ name: 'main' }),
        makeProc({ name: 'reader', type: 'module' }),
      ],
      luarocks: { dependencies: {}, luaVersion: '5.3' },
      aos: aosEnabled,
      deploy: { scheduler: 'x', authority: 'x', spawnTags: [], actionTags: [] },
    }

    // main will fail (no WASM), reader should be excluded
    const results = await smoke(config)
    expect(results).toHaveLength(1)
    expect(results[0].processName).toBe('main')
  })

  it('runs all eligible processes in parallel', async () => {
    const config: ResolvedConfig = {
      root: tmp,
      outDir: join(tmp, 'dist'),
      processes: [
        makeProc({ name: 'alpha' }),
        makeProc({ name: 'beta' }),
      ],
      luarocks: { dependencies: {}, luaVersion: '5.3' },
      aos: aosEnabled,
      deploy: { scheduler: 'x', authority: 'x', spawnTags: [], actionTags: [] },
    }

    // Both will fail due to missing WASM — but both should be attempted
    const results = await smoke(config)
    expect(results).toHaveLength(2)
    expect(results.map(r => r.processName).sort()).toEqual(['alpha', 'beta'])
  })
})
