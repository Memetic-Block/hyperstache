import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { mkdtemp, rm, writeFile, mkdir } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'

// Mock the turbo module to simulate missing package
vi.mock('../src/deploy/turbo.js', () => ({
  loadTurboSDK: vi.fn(async () => {
    throw new Error(
      '@ardrive/turbo-sdk is required for publishing but is not installed.\n\n' +
      '  npm install @ardrive/turbo-sdk\n\n' +
      'Then run the publish command again.',
    )
  }),
}))

import { publishProcess } from '../src/deploy/publish.js'
import type { ResolvedProcessConfig, ResolvedDeployConfig } from '../src/config.js'

let tmp: string

beforeEach(async () => {
  tmp = await mkdtemp(join(tmpdir(), 'hs-publish-missing-'))
})

afterEach(async () => {
  await rm(tmp, { recursive: true, force: true })
})

const deployConfig: ResolvedDeployConfig = {
  scheduler: '_GQ33BkPtZrqxA84vM8Zk-N2aO0toNNu_C-l-rawrBA',
  authority: '_GQ33BkPtZrqxA84vM8Zk-N2aO0toNNu_C-l-rawrBA',
  spawnTags: [],
  actionTags: [],
}

const wallet = { kty: 'RSA', n: 'test-n', e: 'AQAB' }

describe('publishProcess – missing @ardrive/turbo-sdk', () => {
  it('throws a helpful error when @ardrive/turbo-sdk is not installed', async () => {
    const proc: ResolvedProcessConfig = {
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
    }
    await mkdir(join(tmp, 'dist'), { recursive: true })
    await writeFile(join(tmp, 'dist', 'process.lua'), '-- bundled lua')

    await expect(publishProcess(proc, deployConfig, wallet)).rejects.toThrow(
      /turbo-sdk is required for publishing but is not installed/,
    )
  })
})
