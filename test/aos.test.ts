import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { injectRequire, copyAosProcessFiles } from '../src/bundler/aos.js'
import { mkdir, writeFile, readFile, rm } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'

describe('injectRequire', () => {
  let dir: string

  beforeEach(async () => {
    dir = join(tmpdir(), `hyperstache-aos-test-${Date.now()}`)
    await mkdir(dir, { recursive: true })
  })

  afterEach(async () => {
    await rm(dir, { recursive: true, force: true })
  })

  it('injects require after the last Handlers.add call', async () => {
    const lua = [
      'local x = 1',
      'Handlers.add("Init",',
      '  function(msg) return true end,',
      '  function(msg) print("init") end',
      ')',
      'Handlers.add("Ping",',
      '  function(msg) return msg.Action == "Ping" end,',
      '  function(msg) msg.reply({ Data = "Pong" }) end',
      ')',
      'print("done")',
    ].join('\n')

    const filePath = join(dir, 'process.lua')
    await writeFile(filePath, lua, 'utf-8')
    await injectRequire(filePath, 'main')

    const result = await readFile(filePath, 'utf-8')
    const lines = result.split('\n')

    // require("main") should appear after the closing ) of the second Handlers.add
    const requireIdx = lines.indexOf('require("main")')
    expect(requireIdx).toBeGreaterThan(-1)

    // The second Handlers.add closing ) is on line index 8
    // require should be after it (index 9 is blank, 10 is require)
    const closingParenIdx = lines.indexOf(')')
    // Find the LAST standalone )
    let lastParen = -1
    for (let i = 0; i < lines.length; i++) {
      if (lines[i].trim() === ')' && i < requireIdx) lastParen = i
    }
    expect(requireIdx).toBeGreaterThan(lastParen)

    // print("done") should still be there
    expect(result).toContain('print("done")')
  })

  it('injects require after last Handlers.append call', async () => {
    const lua = [
      'Handlers.append("Only",',
      '  function(msg) return true end,',
      '  function(msg) end',
      ')',
    ].join('\n')

    const filePath = join(dir, 'process.lua')
    await writeFile(filePath, lua, 'utf-8')
    await injectRequire(filePath, 'worker')

    const result = await readFile(filePath, 'utf-8')
    expect(result).toContain('require("worker")')

    const lines = result.split('\n')
    const requireIdx = lines.indexOf('require("worker")')
    // Should be after the closing paren at index 3
    expect(requireIdx).toBeGreaterThan(3)
  })

  it('appends at end of file when no Handlers calls exist', async () => {
    const lua = 'print("hello")\nlocal x = 1'
    const filePath = join(dir, 'process.lua')
    await writeFile(filePath, lua, 'utf-8')
    await injectRequire(filePath, 'mymod')

    const result = await readFile(filePath, 'utf-8')
    expect(result).toContain('require("mymod")')

    const lines = result.split('\n')
    const requireIdx = lines.indexOf('require("mymod")')
    expect(requireIdx).toBe(lines.length - 1)
  })

  it('handles deeply nested parentheses in handler calls', async () => {
    const lua = [
      'Handlers.add("Complex",',
      '  Handlers.utils.hasMatchingTag("Action", "Complex"),',
      '  function(msg)',
      '    local data = json.decode(msg.Data)',
      '    if (data.type == "a") then',
      '      msg.reply({ Data = "ok" })',
      '    end',
      '  end',
      ')',
      '',
    ].join('\n')

    const filePath = join(dir, 'process.lua')
    await writeFile(filePath, lua, 'utf-8')
    await injectRequire(filePath, 'app')

    const result = await readFile(filePath, 'utf-8')
    const lines = result.split('\n')
    const requireIdx = lines.indexOf('require("app")')
    expect(requireIdx).toBeGreaterThan(-1)

    // The closing ) of Handlers.add is at line 8
    // Require should come after
    const closingLine = lines.indexOf(')')
    expect(requireIdx).toBeGreaterThan(closingLine)
  })
})

describe('copyAosProcessFiles', () => {
  let srcDir: string
  let destDir: string

  beforeEach(async () => {
    const base = join(tmpdir(), `hyperstache-copy-test-${Date.now()}`)
    srcDir = join(base, 'repo')
    destDir = join(base, 'out')
    await mkdir(join(srcDir, 'process', 'libs'), { recursive: true })
    await mkdir(destDir, { recursive: true })
  })

  afterEach(async () => {
    // Clean up the parent of srcDir
    await rm(join(srcDir, '..'), { recursive: true, force: true })
  })

  it('copies only .lua files preserving structure', async () => {
    await writeFile(join(srcDir, 'process', 'process.lua'), 'print("main")', 'utf-8')
    await writeFile(join(srcDir, 'process', 'utils.lua'), 'return {}', 'utf-8')
    await writeFile(join(srcDir, 'process', 'README.md'), '# readme', 'utf-8')
    await writeFile(join(srcDir, 'process', 'libs', 'json.lua'), 'return {}', 'utf-8')

    const copied = await copyAosProcessFiles(srcDir, destDir)

    expect(copied).toContain('process.lua')
    expect(copied).toContain('utils.lua')
    expect(copied).toContain(join('libs', 'json.lua'))
    expect(copied).not.toContain('README.md')

    // Verify files were actually written
    const content = await readFile(join(destDir, 'process.lua'), 'utf-8')
    expect(content).toBe('print("main")')

    const nested = await readFile(join(destDir, 'libs', 'json.lua'), 'utf-8')
    expect(nested).toBe('return {}')
  })

  it('returns empty array when process dir has no lua files', async () => {
    await writeFile(join(srcDir, 'process', 'notes.txt'), 'not lua', 'utf-8')
    const copied = await copyAosProcessFiles(srcDir, destDir)
    expect(copied).toEqual([])
  })
})
