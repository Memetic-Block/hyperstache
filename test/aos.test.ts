import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { injectRequire, copyAosProcessFiles, generateAosYaml, writeAosYaml, stripRequires } from '../src/bundler/aos.js'
import { mkdir, writeFile, readFile, rm } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'

describe('injectRequire', () => {
  let dir: string

  beforeEach(async () => {
    dir = join(tmpdir(), `hyperengine-aos-test-${Date.now()}`)
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

    // require(".main") should appear after the closing ) of the second Handlers.add
    const requireIdx = lines.findIndex(l => l.trim() === 'require(".main")')
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
    expect(result).toContain('require(".worker")')

    const lines = result.split('\n')
    const requireIdx = lines.findIndex(l => l.trim() === 'require(".worker")')
    // Should be after the closing paren at index 3
    expect(requireIdx).toBeGreaterThan(3)
  })

  it('appends at end of file when no Handlers calls exist', async () => {
    const lua = 'print("hello")\nlocal x = 1'
    const filePath = join(dir, 'process.lua')
    await writeFile(filePath, lua, 'utf-8')
    await injectRequire(filePath, 'mymod')

    const result = await readFile(filePath, 'utf-8')
    expect(result).toContain('require(".mymod")')

    const lines = result.split('\n')
    const requireIdx = lines.findIndex(l => l.trim() === 'require(".mymod")')
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
    const requireIdx = lines.findIndex(l => l.trim() === 'require(".app")')
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
    const base = join(tmpdir(), `hyperengine-copy-test-${Date.now()}`)
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

describe('generateAosYaml', () => {
  const defaultOpts = {
    stack_size: 3_145_728,
    initial_memory: 4_194_304,
    maximum_memory: 1_073_741_824,
    target: 32 as const,
    aos_git_hash: '15dd81ee596518e2f44521e973b8ad1ce3ee9945',
    compute_limit: '9000000000000',
    module_format: 'wasm32-unknown-emscripten-metering',
  }

  it('generates valid YAML with all default fields', () => {
    const yaml = generateAosYaml(defaultOpts)
    expect(yaml).toContain('stack_size: 3145728')
    expect(yaml).toContain('initial_memory: 4194304')
    expect(yaml).toContain('maximum_memory: 1073741824')
    expect(yaml).toContain('target: 32')
    expect(yaml).toContain("aos_git_hash: '15dd81ee596518e2f44521e973b8ad1ce3ee9945'")
    expect(yaml).toContain("compute_limit: '9000000000000'")
    expect(yaml).toContain("module_format: 'wasm32-unknown-emscripten-metering'")
  })

  it('respects custom values', () => {
    const yaml = generateAosYaml({
      stack_size: 6_291_456,
      initial_memory: 8_388_608,
      maximum_memory: 2_147_483_648,
      target: 64,
      aos_git_hash: 'abc1234',
      compute_limit: '5000000000000',
      module_format: 'wasm64-unknown-emscripten-metering',
    })
    expect(yaml).toContain('stack_size: 6291456')
    expect(yaml).toContain('initial_memory: 8388608')
    expect(yaml).toContain('maximum_memory: 2147483648')
    expect(yaml).toContain('target: 64')
    expect(yaml).toContain("aos_git_hash: 'abc1234'")
    expect(yaml).toContain("compute_limit: '5000000000000'")
    expect(yaml).toContain("module_format: 'wasm64-unknown-emscripten-metering'")
  })

  it('ends with a newline', () => {
    const yaml = generateAosYaml(defaultOpts)
    expect(yaml.endsWith('\n')).toBe(true)
  })
})

describe('writeAosYaml', () => {
  let dir: string

  beforeEach(async () => {
    dir = join(tmpdir(), `hyperengine-yaml-test-${Date.now()}`)
    await mkdir(dir, { recursive: true })
  })

  afterEach(async () => {
    await rm(dir, { recursive: true, force: true })
  })

  it('writes config.yml to the output directory', async () => {
    const yamlPath = await writeAosYaml(dir, {
      stack_size: 3_145_728,
      initial_memory: 4_194_304,
      maximum_memory: 1_073_741_824,
      target: 32,
      aos_git_hash: 'deadbeef',
      compute_limit: '9000000000000',
      module_format: 'wasm32-unknown-emscripten-metering',
    })

    expect(yamlPath).toBe(join(dir, 'config.yml'))
    const content = await readFile(yamlPath, 'utf-8')
    expect(content).toContain('stack_size: 3145728')
    expect(content).toContain("aos_git_hash: 'deadbeef'")
  })

  it('creates output directory if it does not exist', async () => {
    const nested = join(dir, 'sub', 'dir')
    const yamlPath = await writeAosYaml(nested, {
      stack_size: 3_145_728,
      initial_memory: 4_194_304,
      maximum_memory: 1_073_741_824,
      target: 32,
      aos_git_hash: 'cafebabe',
      compute_limit: '9000000000000',
      module_format: 'wasm32-unknown-emscripten-metering',
    })

    const content = await readFile(yamlPath, 'utf-8')
    expect(content).toContain("aos_git_hash: 'cafebabe'")
  })
})

describe('stripRequires', () => {
  let dir: string

  beforeEach(async () => {
    dir = join(tmpdir(), `hyperengine-strip-test-${Date.now()}`)
    await mkdir(dir, { recursive: true })
  })

  afterEach(async () => {
    await rm(dir, { recursive: true, force: true })
  })

  it('removes a single require line', async () => {
    const lua = [
      'local x = 1',
      'require(".crypto.init")',
      'require(".main")',
      'print("done")',
    ].join('\n')

    const filePath = join(dir, 'process.lua')
    await writeFile(filePath, lua, 'utf-8')

    const removed = await stripRequires(filePath, ['.crypto.init'])
    expect(removed).toEqual(['.crypto.init'])

    const result = await readFile(filePath, 'utf-8')
    expect(result).not.toContain('.crypto.init')
    expect(result).toContain('require(".main")')
    expect(result).toContain('print("done")')
  })

  it('removes multiple require lines in one pass', async () => {
    const lua = [
      'require(".crypto.init")',
      'require(".sqlite")',
      'require(".main")',
    ].join('\n')

    const filePath = join(dir, 'process.lua')
    await writeFile(filePath, lua, 'utf-8')

    const removed = await stripRequires(filePath, ['.crypto.init', '.sqlite'])
    expect(removed).toContain('.crypto.init')
    expect(removed).toContain('.sqlite')
    expect(removed).toHaveLength(2)

    const result = await readFile(filePath, 'utf-8')
    expect(result).not.toContain('.crypto.init')
    expect(result).not.toContain('.sqlite')
    expect(result).toContain('require(".main")')
  })

  it('handles single-quote require syntax', async () => {
    const lua = "require('.crypto.init')\nrequire('.main')"
    const filePath = join(dir, 'process.lua')
    await writeFile(filePath, lua, 'utf-8')

    const removed = await stripRequires(filePath, ['.crypto.init'])
    expect(removed).toEqual(['.crypto.init'])

    const result = await readFile(filePath, 'utf-8')
    expect(result).not.toContain('.crypto.init')
    expect(result).toContain("require('.main')")
  })

  it('handles bare require syntax without parentheses', async () => {
    const lua = 'require ".crypto.init"\nrequire ".main"'
    const filePath = join(dir, 'process.lua')
    await writeFile(filePath, lua, 'utf-8')

    const removed = await stripRequires(filePath, ['.crypto.init'])
    expect(removed).toEqual(['.crypto.init'])

    const result = await readFile(filePath, 'utf-8')
    expect(result).not.toContain('.crypto.init')
    expect(result).toContain('require ".main"')
  })

  it('normalises names without leading dot', async () => {
    const lua = 'require(".crypto.init")\nrequire(".main")'
    const filePath = join(dir, 'process.lua')
    await writeFile(filePath, lua, 'utf-8')

    const removed = await stripRequires(filePath, ['crypto.init'])
    expect(removed).toEqual(['.crypto.init'])

    const result = await readFile(filePath, 'utf-8')
    expect(result).not.toContain('.crypto.init')
  })

  it('returns only modules that were actually found', async () => {
    const lua = 'require(".main")\nprint("hi")'
    const filePath = join(dir, 'process.lua')
    await writeFile(filePath, lua, 'utf-8')

    const removed = await stripRequires(filePath, ['.crypto.init', '.sqlite'])
    expect(removed).toEqual([])

    const result = await readFile(filePath, 'utf-8')
    expect(result).toContain('require(".main")')
  })

  it('leaves file unchanged when no matches', async () => {
    const lua = 'local x = 1\nrequire(".main")'
    const filePath = join(dir, 'process.lua')
    await writeFile(filePath, lua, 'utf-8')

    await stripRequires(filePath, ['.nonexistent'])

    const result = await readFile(filePath, 'utf-8')
    expect(result).toBe(lua)
  })

  it('returns empty array when given empty exclude list', async () => {
    const lua = 'require(".crypto.init")'
    const filePath = join(dir, 'process.lua')
    await writeFile(filePath, lua, 'utf-8')

    const removed = await stripRequires(filePath, [])
    expect(removed).toEqual([])
  })

  it('handles indented require lines', async () => {
    const lua = '  require(".crypto.init")\n  require(".main")'
    const filePath = join(dir, 'process.lua')
    await writeFile(filePath, lua, 'utf-8')

    const removed = await stripRequires(filePath, ['.crypto.init'])
    expect(removed).toEqual(['.crypto.init'])

    const result = await readFile(filePath, 'utf-8')
    expect(result).not.toContain('.crypto.init')
    expect(result).toContain('require(".main")')
  })
})
