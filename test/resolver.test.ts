import { describe, it, expect } from 'vitest'
import { extractRequires, pathToModuleName } from '../src/bundler/resolver.js'

describe('extractRequires', () => {
  it('extracts double-quoted requires', () => {
    const src = `local m = require("handlers.home")`
    expect(extractRequires(src)).toEqual(['handlers.home'])
  })

  it('extracts single-quoted requires', () => {
    const src = `local m = require('lib.utils')`
    expect(extractRequires(src)).toEqual(['lib.utils'])
  })

  it('extracts requires without parentheses', () => {
    const src = `local m = require "lustache"`
    expect(extractRequires(src)).toEqual(['lustache'])
  })

  it('extracts multiple requires', () => {
    const src = [
      'local a = require("mod.a")',
      'local b = require("mod.b")',
      'local c = require("mod.c")',
    ].join('\n')
    expect(extractRequires(src)).toEqual(['mod.a', 'mod.b', 'mod.c'])
  })

  it('returns empty array for no requires', () => {
    const src = 'print("hello")'
    expect(extractRequires(src)).toEqual([])
  })
})

describe('pathToModuleName', () => {
  it('converts file path to module name', () => {
    expect(pathToModuleName('/project/src/handlers/home.lua', '/project/src'))
      .toBe('handlers.home')
  })

  it('handles init.lua files', () => {
    expect(pathToModuleName('/project/src/mymod/init.lua', '/project/src'))
      .toBe('mymod')
  })

  it('handles top-level file', () => {
    expect(pathToModuleName('/project/src/utils.lua', '/project/src'))
      .toBe('utils')
  })
})

describe('resolveModules', () => {
  it('does not mark hyperengine as unresolved', async () => {
    // Simulate a process that requires 'hyperengine' — it should be
    // skipped like 'templates', not listed as unresolved.
    const { resolveModules } = await import('../src/bundler/resolver.js')
    const { resolve } = await import('node:path')
    const fixtureRoot = resolve(__dirname, 'fixtures/sample-app')

    const config = {
      name: 'test',
      entry: resolve(fixtureRoot, 'src/process.lua'),
      outDir: resolve(fixtureRoot, 'dist'),
      outFile: 'process.lua',
      root: fixtureRoot,
      templates: {
        extensions: ['.html', '.htm'],
        dir: resolve(fixtureRoot, 'src/templates'),
        vite: false as const,
      },
      luarocks: {
        dependencies: {},
        luaVersion: '5.3',
      },
      runtime: {
        enabled: true,
        handlers: false,
      },
    }

    const result = await resolveModules(config)

    // The sample-app process requires 'templates', 'lustache', and 'hyperengine'
    // — all are auto-generated/bundled modules and should be skipped
    expect(result.unresolved).not.toContain('templates')
    expect(result.unresolved).not.toContain('hyperengine')
    expect(result.unresolved).not.toContain('lustache')
  })
})
