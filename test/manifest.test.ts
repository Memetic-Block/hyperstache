import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { mkdtemp, rm, readFile, writeFile, mkdir } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { readManifest, writeManifest, mergeManifest } from '../src/deploy/manifest.js'

let tmp: string

beforeEach(async () => {
  tmp = await mkdtemp(join(tmpdir(), 'hs-manifest-'))
})

afterEach(async () => {
  await rm(tmp, { recursive: true, force: true })
})

describe('readManifest', () => {
  it('returns empty manifest when file does not exist', async () => {
    const manifest = await readManifest(tmp)
    expect(manifest).toEqual({ processes: {} })
  })

  it('reads existing manifest', async () => {
    const dir = join(tmp, '.hyperengine')
    await mkdir(dir, { recursive: true })
    const data = { processes: { main: { processId: 'abc123', deployedAt: '2025-01-01T00:00:00.000Z' } } }
    await writeFile(join(dir, 'deploy.json'), JSON.stringify(data))
    const manifest = await readManifest(tmp)
    expect(manifest.processes.main.processId).toBe('abc123')
  })
})

describe('writeManifest', () => {
  it('creates directory and writes manifest', async () => {
    const data = { processes: { main: { processId: 'xyz789', deployedAt: '2025-01-01T00:00:00.000Z' } } }
    await writeManifest(tmp, data)
    const raw = await readFile(join(tmp, '.hyperengine', 'deploy.json'), 'utf-8')
    const parsed = JSON.parse(raw)
    expect(parsed.processes.main.processId).toBe('xyz789')
  })
})

describe('mergeManifest', () => {
  it('merges new entries into empty manifest', async () => {
    const result = await mergeManifest(tmp, {
      main: { processId: 'proc1' },
    })
    expect(result.processes.main.processId).toBe('proc1')
    expect(result.processes.main.deployedAt).toBeDefined()
  })

  it('updates existing entries preserving other fields', async () => {
    await mergeManifest(tmp, {
      main: { processId: 'proc1', moduleId: 'mod1' },
    })

    const result = await mergeManifest(tmp, {
      main: { processId: 'proc2' },
    })

    expect(result.processes.main.processId).toBe('proc2')
    expect(result.processes.main.moduleId).toBe('mod1')
  })

  it('adds new processes alongside existing ones', async () => {
    await mergeManifest(tmp, { main: { processId: 'proc1' } })
    const result = await mergeManifest(tmp, { worker: { processId: 'proc2' } })

    expect(result.processes.main.processId).toBe('proc1')
    expect(result.processes.worker.processId).toBe('proc2')
  })
})
