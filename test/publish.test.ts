import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { mkdtemp, rm, writeFile, mkdir } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'

// Mock the turbo module so @ardrive/turbo-sdk is never actually imported
vi.mock('../src/deploy/turbo.js', () => ({
  loadTurboSDK: vi.fn(async () => ({
    TurboFactory: {
      authenticated: vi.fn(() => ({
        uploadFile: vi.fn(async ({ dataItemOpts }: { dataItemOpts: { tags: Array<{ name: string; value: string }> } }) => {
          const contentType = dataItemOpts.tags.find((t: { name: string }) => t.name === 'Content-Type')?.value
          return { id: `tx-${contentType === 'application/wasm' ? 'wasm' : 'lua'}-12345` }
        }),
      })),
    },
  })),
}))

import { publishProcess } from '../src/deploy/publish.js'
import { createLogger } from '../src/deploy/logger.js'
import type { ResolvedProcessConfig, ResolvedDeployConfig } from '../src/config.js'

let tmp: string

beforeEach(async () => {
  tmp = await mkdtemp(join(tmpdir(), 'hs-publish-'))
  vi.clearAllMocks()
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
    runtime: { enabled: false, handlers: false, adminInterface: { enabled: false, path: 'admin' } },
    ...overrides,
  }
}

const deployConfig: ResolvedDeployConfig = {
  scheduler: '_GQ33BkPtZrqxA84vM8Zk-N2aO0toNNu_C-l-rawrBA',
  spawnTags: [],
  actionTags: [],
}

const wallet = { kty: 'RSA', n: 'test-n', e: 'AQAB' }

describe('publishProcess', () => {
  it('publishes WASM module when process.wasm exists', async () => {
    const proc = makeProc()
    await mkdir(join(tmp, 'dist', 'main'), { recursive: true })
    await writeFile(join(tmp, 'dist', 'main', 'process.wasm'), Buffer.from([0x00, 0x61, 0x73, 0x6d]))

    const result = await publishProcess(proc, deployConfig, wallet)
    expect(result.type).toBe('wasm')
    expect(result.transactionId).toBe('tx-wasm-12345')
    expect(result.processName).toBe('main')
  })

  it('publishes Lua file when no WASM exists', async () => {
    const proc = makeProc()
    await mkdir(join(tmp, 'dist'), { recursive: true })
    await writeFile(join(tmp, 'dist', 'process.lua'), '-- bundled lua')

    const result = await publishProcess(proc, deployConfig, wallet)
    expect(result.type).toBe('lua')
    expect(result.transactionId).toBe('tx-lua-12345')
  })

  it('throws when no build artifact exists', async () => {
    const proc = makeProc()
    await expect(publishProcess(proc, deployConfig, wallet)).rejects.toThrow(
      /No build artifact found/,
    )
  })

  it('produces verbose output when logger level is verbose', async () => {
    const proc = makeProc()
    await mkdir(join(tmp, 'dist'), { recursive: true })
    await writeFile(join(tmp, 'dist', 'process.lua'), '-- bundled lua')

    const stderrSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
    const logger = createLogger({ verbose: true })

    await publishProcess(proc, deployConfig, wallet, logger)

    const verboseMessages = stderrSpy.mock.calls.map(c => c[0] as string)
    expect(verboseMessages.some(m => m.includes('[verbose]') && m.includes('Publishing process'))).toBe(true)
    expect(verboseMessages.some(m => m.includes('[verbose]') && m.includes('Upload complete'))).toBe(true)

    stderrSpy.mockRestore()
  })
})
