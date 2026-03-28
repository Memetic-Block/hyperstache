import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { mkdtemp, rm, writeFile, mkdir } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'

// Mock @permaweb/aoconnect
const mockSpawn = vi.fn(async () => 'spawned-process-id')
const mockMessage = vi.fn(async () => 'eval-msg-id')
const mockResult = vi.fn(async () => ({}))

vi.mock('@permaweb/aoconnect', () => ({
  connect: vi.fn(() => ({
    spawn: mockSpawn,
    message: mockMessage,
    result: mockResult,
  })),
  createDataItemSigner: vi.fn(() => 'mock-signer'),
}))

import { deployProcess } from '../src/deploy/deploy.js'
import { writeManifest } from '../src/deploy/manifest.js'
import { createLogger } from '../src/deploy/logger.js'
import { AOS_MODULE_ID } from '../src/config.js'
import type { ResolvedProcessConfig, ResolvedDeployConfig } from '../src/config.js'

let tmp: string

beforeEach(async () => {
  tmp = await mkdtemp(join(tmpdir(), 'hs-deploy-'))
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
    handlers: false,
    adminInterface: { enabled: false, path: 'admin', dir: join(tmp, 'src/admin') },
    patchKey: 'ui',
    stateKey: 'hyperengine_state',
    ...overrides,
  }
}

const deployConfig: ResolvedDeployConfig = {
  scheduler: '_GQ33BkPtZrqxA84vM8Zk-N2aO0toNNu_C-l-rawrBA',
  authority: '_GQ33BkPtZrqxA84vM8Zk-N2aO0toNNu_C-l-rawrBA',
  spawnTags: [],
  actionTags: [],
}

const wallet = { kty: 'RSA', n: 'test-n', e: 'AQAB' }

describe('deployProcess', () => {
  it('spawns with standard AOS module and evals bundled Lua', async () => {
    const proc = makeProc()
    await mkdir(join(tmp, 'dist'), { recursive: true })
    await writeFile(join(tmp, 'dist', 'process.lua'), '-- bundled lua code')

    const result = await deployProcess(proc, deployConfig, wallet, tmp)

    expect(result.processId).toBe('spawned-process-id')
    expect(result.moduleId).toBe(AOS_MODULE_ID)
    expect(mockSpawn).toHaveBeenCalledWith(
      expect.objectContaining({
        module: AOS_MODULE_ID,
        scheduler: deployConfig.scheduler,
      }),
    )
    expect(mockMessage).toHaveBeenCalledWith(
      expect.objectContaining({
        process: 'spawned-process-id',
        data: '-- bundled lua code',
      }),
    )
    expect(mockResult).toHaveBeenCalled()
  })

  it('spawns with published moduleId from config (no Eval)', async () => {
    const proc = makeProc({ moduleId: 'custom-module-tx-id' })
    await mkdir(join(tmp, 'dist'), { recursive: true })

    const result = await deployProcess(proc, deployConfig, wallet, tmp)

    expect(result.moduleId).toBe('custom-module-tx-id')
    expect(mockSpawn).toHaveBeenCalledWith(
      expect.objectContaining({
        module: 'custom-module-tx-id',
      }),
    )
    // No Eval step for module builds
    expect(mockMessage).not.toHaveBeenCalled()
  })

  it('reads moduleId from deploy manifest when not in config', async () => {
    const proc = makeProc()
    // Create a WASM artifact to trigger module-build path
    await mkdir(join(tmp, 'dist', 'main'), { recursive: true })
    await writeFile(join(tmp, 'dist', 'main', 'process.wasm'), Buffer.alloc(4))
    // Write manifest with moduleId
    await writeManifest(tmp, {
      processes: { main: { moduleId: 'manifest-module-id', deployedAt: '2025-01-01T00:00:00Z' } },
    })

    const result = await deployProcess(proc, deployConfig, wallet, tmp)

    expect(result.moduleId).toBe('manifest-module-id')
    expect(mockMessage).not.toHaveBeenCalled()
  })

  it('throws when WASM exists but no moduleId available', async () => {
    const proc = makeProc()
    await mkdir(join(tmp, 'dist', 'main'), { recursive: true })
    await writeFile(join(tmp, 'dist', 'main', 'process.wasm'), Buffer.alloc(4))

    await expect(deployProcess(proc, deployConfig, wallet, tmp)).rejects.toThrow(
      /No module ID found/,
    )
  })

  it('throws when no build output exists for single-file deploy', async () => {
    const proc = makeProc()

    await expect(deployProcess(proc, deployConfig, wallet, tmp)).rejects.toThrow(
      /No build output found/,
    )
  })

  it('throws when Eval returns an error', async () => {
    mockResult.mockResolvedValueOnce({ Error: 'syntax error near line 1' })
    const proc = makeProc()
    await mkdir(join(tmp, 'dist'), { recursive: true })
    await writeFile(join(tmp, 'dist', 'process.lua'), 'invalid lua')

    await expect(deployProcess(proc, deployConfig, wallet, tmp)).rejects.toThrow(
      /Eval failed/,
    )
  })

  it('includes custom spawnTags and actionTags', async () => {
    const proc = makeProc()
    await mkdir(join(tmp, 'dist'), { recursive: true })
    await writeFile(join(tmp, 'dist', 'process.lua'), '-- lua')

    const customDeploy: ResolvedDeployConfig = {
      ...deployConfig,
      spawnTags: [{ name: 'App-Name', value: 'test-app' }],
      actionTags: [{ name: 'X-Custom', value: 'val' }],
    }

    await deployProcess(proc, customDeploy, wallet, tmp)

    expect(mockSpawn).toHaveBeenCalledWith(
      expect.objectContaining({
        tags: expect.arrayContaining([
          { name: 'App-Name', value: 'test-app' },
        ]),
      }),
    )
    expect(mockMessage).toHaveBeenCalledWith(
      expect.objectContaining({
        tags: expect.arrayContaining([
          { name: 'X-Custom', value: 'val' },
        ]),
      }),
    )
  })

  it('passes hyperbeamUrl to connect options', async () => {
    const { connect } = await import('@permaweb/aoconnect')
    const proc = makeProc()
    await mkdir(join(tmp, 'dist'), { recursive: true })
    await writeFile(join(tmp, 'dist', 'process.lua'), '-- lua')

    const customDeploy: ResolvedDeployConfig = {
      ...deployConfig,
      hyperbeamUrl: 'https://hyperbeam.example.com',
      scheduler: 'explicit-scheduler',
      authority: 'explicit-authority',
    }

    await deployProcess(proc, customDeploy, wallet, tmp)

    expect(connect).toHaveBeenCalledWith(
      expect.objectContaining({
        GATEWAY_URL: 'https://hyperbeam.example.com',
        URL: 'https://hyperbeam.example.com',
        SCHEDULER: 'explicit-scheduler',
      }),
    )
  })

  it('uses explicit authority in spawn tags', async () => {
    const proc = makeProc()
    await mkdir(join(tmp, 'dist'), { recursive: true })
    await writeFile(join(tmp, 'dist', 'process.lua'), '-- lua')

    const customDeploy: ResolvedDeployConfig = {
      ...deployConfig,
      authority: 'explicit-authority-addr',
    }

    await deployProcess(proc, customDeploy, wallet, tmp)

    expect(mockSpawn).toHaveBeenCalledWith(
      expect.objectContaining({
        tags: expect.arrayContaining([
          { name: 'Authority', value: 'explicit-authority-addr' },
        ]),
      }),
    )
  })

  it('uses scheduler as authority when authority matches scheduler', async () => {
    const proc = makeProc()
    await mkdir(join(tmp, 'dist'), { recursive: true })
    await writeFile(join(tmp, 'dist', 'process.lua'), '-- lua')

    const customDeploy: ResolvedDeployConfig = {
      ...deployConfig,
      scheduler: 'my-scheduler-addr',
      authority: 'my-scheduler-addr',
    }

    await deployProcess(proc, customDeploy, wallet, tmp)

    expect(mockSpawn).toHaveBeenCalledWith(
      expect.objectContaining({
        tags: expect.arrayContaining([
          { name: 'Authority', value: 'my-scheduler-addr' },
        ]),
      }),
    )
  })

  it('fetches address from hyperbeam node when scheduler and authority are defaults', async () => {
    const mockFetch = vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(
      new Response('hyperbeam-wallet-address', { status: 200 }),
    )

    const proc = makeProc()
    await mkdir(join(tmp, 'dist'), { recursive: true })
    await writeFile(join(tmp, 'dist', 'process.lua'), '-- lua')

    const customDeploy: ResolvedDeployConfig = {
      ...deployConfig,
      hyperbeamUrl: 'https://my-node.example.com',
    }

    await deployProcess(proc, customDeploy, wallet, tmp)

    expect(mockFetch).toHaveBeenCalledWith(
      'https://my-node.example.com/~meta@1.0/info/address',
    )
    expect(mockSpawn).toHaveBeenCalledWith(
      expect.objectContaining({
        scheduler: 'hyperbeam-wallet-address',
        tags: expect.arrayContaining([
          { name: 'Authority', value: 'hyperbeam-wallet-address' },
        ]),
      }),
    )

    mockFetch.mockRestore()
  })

  it('throws when hyperbeam address fetch fails', async () => {
    const mockFetch = vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(
      new Response('Not Found', { status: 404 }),
    )

    const proc = makeProc()
    await mkdir(join(tmp, 'dist'), { recursive: true })
    await writeFile(join(tmp, 'dist', 'process.lua'), '-- lua')

    const customDeploy: ResolvedDeployConfig = {
      ...deployConfig,
      hyperbeamUrl: 'https://my-node.example.com',
    }

    await expect(
      deployProcess(proc, customDeploy, wallet, tmp),
    ).rejects.toThrow(/Failed to fetch HyperBEAM node address/)

    mockFetch.mockRestore()
  })

  it('produces verbose output when logger level is verbose', async () => {
    const proc = makeProc()
    await mkdir(join(tmp, 'dist'), { recursive: true })
    await writeFile(join(tmp, 'dist', 'process.lua'), '-- bundled lua code')

    const stderrSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
    const logger = createLogger({ verbose: true })

    await deployProcess(proc, deployConfig, wallet, tmp, logger)

    const verboseMessages = stderrSpy.mock.calls.map(c => c[0] as string)
    expect(verboseMessages.some(m => m.includes('[verbose]') && m.includes('Deploying process'))).toBe(true)
    expect(verboseMessages.some(m => m.includes('[verbose]') && m.includes('Scheduler:'))).toBe(true)
    expect(verboseMessages.some(m => m.includes('[verbose]') && m.includes('Spawned processId:'))).toBe(true)
    expect(verboseMessages.some(m => m.includes('[verbose]') && m.includes('Eval succeeded'))).toBe(true)

    stderrSpy.mockRestore()
  })

  it('produces debug output when logger level is debug', async () => {
    const proc = makeProc()
    await mkdir(join(tmp, 'dist'), { recursive: true })
    await writeFile(join(tmp, 'dist', 'process.lua'), '-- bundled lua code')

    const stderrSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
    const logger = createLogger({ debug: true })

    await deployProcess(proc, deployConfig, wallet, tmp, logger)

    const allMessages = stderrSpy.mock.calls.map(c => c[0] as string)
    // debug implies verbose, so both should appear
    expect(allMessages.some(m => m.includes('[verbose]'))).toBe(true)
    expect(allMessages.some(m => m.includes('[debug]') && m.includes('aoconnect options'))).toBe(true)
    expect(allMessages.some(m => m.includes('[debug]') && m.includes('Spawn options'))).toBe(true)

    stderrSpy.mockRestore()
  })
})
