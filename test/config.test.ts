import { describe, it, expect } from 'vitest'
import { loadConfig } from '../src/config.js'
import { resolve } from 'node:path'

describe('loadConfig with configPath', () => {
  const fixtureRoot = resolve(__dirname, 'fixtures/sample-app')

  it('loads config from an explicit path', async () => {
    const config = await loadConfig(fixtureRoot, 'hyperengine.config.ts')
    expect(config.processes.length).toBeGreaterThan(0)
    expect(config.processes[0].entry).toContain('process.lua')
  })

  it('loads config from an absolute path', async () => {
    const absPath = resolve(fixtureRoot, 'hyperengine.config.ts')
    const config = await loadConfig(fixtureRoot, absPath)
    expect(config.processes.length).toBeGreaterThan(0)
  })

  it('throws when config file does not exist', async () => {
    await expect(
      loadConfig(fixtureRoot, 'nonexistent.config.ts'),
    ).rejects.toThrow('Config file not found')
  })

  it('throws for unsupported config file extension', async () => {
    await expect(
      loadConfig(fixtureRoot, 'config.json'),
    ).rejects.toThrow('Unsupported config file extension')
  })
})
