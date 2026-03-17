import { describe, it, expect } from 'vitest'
import { generateRuntimeSource } from '../src/bundler/runtime.js'

describe('generateRuntimeSource', () => {
  it('generates Lua source with all API functions', async () => {
    const source = await generateRuntimeSource({ handlers: false })

    // Should seed from bundled templates
    expect(source).toContain('require("templates")')
    expect(source).toContain('hyperstache_templates')

    // Should declare the module table
    expect(source).toContain('local hyperstache = {}')

    // Should expose CRUD API
    expect(source).toContain('function hyperstache.get(key)')
    expect(source).toContain('function hyperstache.set(key, content)')
    expect(source).toContain('function hyperstache.remove(key)')
    expect(source).toContain('function hyperstache.list()')
    expect(source).toContain('function hyperstache.render(key, data)')
    expect(source).toContain('function hyperstache.sync()')
    expect(source).toContain('function hyperstache.handlers()')

    // Should return the module
    expect(source).toContain('return hyperstache')

    // Should use lustache for rendering
    expect(source).toContain('lustache:render(tmpl, data)')
  })

  it('merges bundled templates without overwriting existing keys', async () => {
    const source = await generateRuntimeSource({ handlers: false })

    // Should check for nil before setting
    expect(source).toContain('if hyperstache_templates[k] == nil then')
    expect(source).toContain('hyperstache_templates[k] = v')
  })

  it('does not auto-register handlers when handlers is false', async () => {
    const source = await generateRuntimeSource({ handlers: false })

    // The handlers() function definition should exist
    expect(source).toContain('function hyperstache.handlers()')

    // But it should NOT be called automatically
    const lines = source.split('\n')
    const handlerCalls = lines.filter(
      (l) => l.trim() === 'hyperstache.handlers()',
    )
    expect(handlerCalls).toHaveLength(0)
  })

  it('auto-registers handlers when handlers is true', async () => {
    const source = await generateRuntimeSource({ handlers: true })

    // Should have an auto-call to hyperstache.handlers()
    const lines = source.split('\n')
    const handlerCalls = lines.filter(
      (l) => l.trim() === 'hyperstache.handlers()',
    )
    expect(handlerCalls).toHaveLength(1)
  })

  it('registers all expected AO handlers', async () => {
    const source = await generateRuntimeSource({ handlers: false })

    expect(source).toContain('"Hyperstache-Get"')
    expect(source).toContain('"Hyperstache-Set"')
    expect(source).toContain('"Hyperstache-Remove"')
    expect(source).toContain('"Hyperstache-List"')
    expect(source).toContain('"Hyperstache-Render"')
  })

  it('guards mutation handlers with Owner check', async () => {
    const source = await generateRuntimeSource({ handlers: false })

    // Set and Remove handlers should check msg.From == Owner
    expect(source).toContain('msg.From == Owner')
  })

  it('sync() force-overwrites from bundled templates', async () => {
    const source = await generateRuntimeSource({ handlers: false })

    // sync should not check for nil (unconditional overwrite)
    expect(source).toContain('function hyperstache.sync()')
    const syncStart = source.indexOf('function hyperstache.sync()')
    const syncEnd = source.indexOf('end', syncStart)
    const syncBody = source.slice(syncStart, syncEnd)
    expect(syncBody).toContain('hyperstache_templates[k] = v')
    expect(syncBody).not.toContain('== nil')
  })
})
