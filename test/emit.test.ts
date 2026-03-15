import { describe, it, expect } from 'vitest'
import { emitBundle, emitModule } from '../src/bundler/emit.js'
import type { LuaModule } from '../src/bundler/resolver.js'

describe('emitBundle', () => {
  it('emits a valid bundle with modules and templates', () => {
    const modules: LuaModule[] = [
      {
        name: 'lib.utils',
        path: '/fake/lib/utils.lua',
        source: 'local M = {}\nfunction M.hello() return "hi" end\nreturn M',
        dependencies: [],
      },
      {
        name: 'process',
        path: '/fake/process.lua',
        source: 'local utils = require("lib.utils")\nprint(utils.hello())',
        dependencies: ['lib.utils'],
      },
    ]

    const templatesLua = `local _templates = {}\n_templates["index.html"] = [[<h1>Hello</h1>]]\nreturn _templates`

    const output = emitBundle(modules, templatesLua)

    // Should have the module loader
    expect(output).toContain('local _modules = {}')
    expect(output).toContain('local function _require(name)')

    // Should register the dep module
    expect(output).toContain('_modules["lib.utils"]')

    // Should register the templates module
    expect(output).toContain('_modules["templates"]')

    // Entry module source should appear at the end, unwrapped
    expect(output).toContain('local utils = require("lib.utils")')

    // Should contain comment marker
    expect(output).toContain('-- Entry point')
  })

  it('emits bundle without templates when none provided', () => {
    const modules: LuaModule[] = [
      {
        name: 'main',
        path: '/fake/main.lua',
        source: 'print("hello")',
        dependencies: [],
      },
    ]

    const output = emitBundle(modules, null)
    expect(output).not.toContain('_modules["templates"]')
    expect(output).toContain('print("hello")')
  })

  it('emits bundle with runtime module after templates', () => {
    const modules: LuaModule[] = [
      {
        name: 'main',
        path: '/fake/main.lua',
        source: 'print("hello")',
        dependencies: [],
      },
    ]

    const templatesLua = `local _templates = {}\nreturn _templates`
    const runtimeLua = `local hyperstache = {}\nreturn hyperstache`

    const output = emitBundle(modules, templatesLua, runtimeLua)

    // Both modules should be registered
    expect(output).toContain('_modules["templates"]')
    expect(output).toContain('_modules["hyperstache"]')

    // Runtime should appear after templates
    const templatesIdx = output.indexOf('_modules["templates"]')
    const runtimeIdx = output.indexOf('_modules["hyperstache"]')
    expect(runtimeIdx).toBeGreaterThan(templatesIdx)
  })

  it('auto-requires runtime when autoRequireRuntime is true', () => {
    const modules: LuaModule[] = [
      {
        name: 'main',
        path: '/fake/main.lua',
        source: 'print("hello")',
        dependencies: [],
      },
    ]

    const runtimeLua = `local hyperstache = {}\nreturn hyperstache`

    const output = emitBundle(modules, null, runtimeLua, true)

    // Should have auto-require before entry point
    const entryIdx = output.indexOf('-- Entry point')
    const requireIdx = output.indexOf('require("hyperstache")', entryIdx)
    expect(requireIdx).toBeGreaterThan(entryIdx)
  })

  it('does not auto-require runtime when autoRequireRuntime is false', () => {
    const modules: LuaModule[] = [
      {
        name: 'main',
        path: '/fake/main.lua',
        source: 'print("hello")',
        dependencies: [],
      },
    ]

    const runtimeLua = `local hyperstache = {}\nreturn hyperstache`

    const output = emitBundle(modules, null, runtimeLua, false)

    // Should NOT have auto-require in the entry section
    const entryIdx = output.indexOf('-- Entry point')
    const afterEntry = output.slice(entryIdx)
    expect(afterEntry).not.toContain('require("hyperstache")')
  })
})

describe('emitModule', () => {
  it('wraps the bundle in _init() and returns empty table', () => {
    const modules: LuaModule[] = [
      {
        name: 'process',
        path: '/fake/process.lua',
        source: 'print("hello")',
        dependencies: [],
      },
    ]

    const output = emitModule(modules, null)

    // Should wrap in _init function
    expect(output).toContain('local function _init()')
    expect(output).toContain('_init()')
    expect(output).toContain('return {}')

    // The bundle content should be indented inside _init
    expect(output).toContain('  -- Bundled by hyperstache')
    expect(output).toContain('  local _modules = {}')

    // Entry source should still be present (inside _init)
    expect(output).toContain('print("hello")')
  })

  it('wraps bundle with modules and templates as a module', () => {
    const modules: LuaModule[] = [
      {
        name: 'lib.utils',
        path: '/fake/lib/utils.lua',
        source: 'local M = {}\nreturn M',
        dependencies: [],
      },
      {
        name: 'process',
        path: '/fake/process.lua',
        source: 'local u = require("lib.utils")',
        dependencies: ['lib.utils'],
      },
    ]

    const templatesLua = 'local _templates = {}\nreturn _templates'
    const output = emitModule(modules, templatesLua)

    expect(output).toContain('local function _init()')
    expect(output).toContain('return {}')
    // Inner content should be indented
    expect(output).toContain('  _modules["lib.utils"]')
    expect(output).toContain('  _modules["templates"]')
  })

  it('ends with _init() call and return {}', () => {
    const modules: LuaModule[] = [
      {
        name: 'main',
        path: '/fake/main.lua',
        source: 'print("go")',
        dependencies: [],
      },
    ]

    const output = emitModule(modules, null)
    const lines = output.split('\n')
    // Last line should be return {}
    expect(lines[lines.length - 1]).toBe('return {}')
    // Second to last should be _init()
    expect(lines[lines.length - 2]).toBe('_init()')
  })
})
