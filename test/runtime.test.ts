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
    expect(source).toContain('function hyperstache.renderTemplate(key, data, partials)')
    expect(source).toContain('function hyperstache.render(template, data, partials)')
    expect(source).toContain('function hyperstache.sync()')
    expect(source).toContain('function hyperstache.handlers()')

    // Should return the module
    expect(source).toContain('return hyperstache')

    // Should use lustache for rendering with partials
    expect(source).toContain('lustache:render(tmpl, data, merged)')
    expect(source).toContain('lustache:render(template, data, merged)')
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
    expect(source).toContain('"Hyperstache-RenderTemplate"')
    expect(source).toContain('"Hyperstache-Render"')
  })

  it('guards mutation handlers with permission check', async () => {
    const source = await generateRuntimeSource({ handlers: false })

    // Set and Remove handlers should use has_permission
    expect(source).toContain('hyperstache.has_permission(msg.From')
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

  it('initializes hyperstache_acl global with defensive pattern', async () => {
    const source = await generateRuntimeSource({ handlers: false })

    expect(source).toContain('if not hyperstache_acl then')
    expect(source).toContain('hyperstache_acl = {}')
  })

  it('exposes ACL API functions', async () => {
    const source = await generateRuntimeSource({ handlers: false })

    expect(source).toContain('function hyperstache.has_permission(address, action)')
    expect(source).toContain('function hyperstache.grant(address, role)')
    expect(source).toContain('function hyperstache.revoke(address, role)')
    expect(source).toContain('function hyperstache.get_roles(address)')
  })

  it('has_permission checks Owner, admin role, and specific action', async () => {
    const source = await generateRuntimeSource({ handlers: false })

    const fnStart = source.indexOf('function hyperstache.has_permission(')
    const fnEnd = source.indexOf('\nend', fnStart)
    const fnBody = source.slice(fnStart, fnEnd)

    // Owner bypass
    expect(fnBody).toContain('address == Owner')
    // Admin check
    expect(fnBody).toContain('roles["admin"]')
    // Specific action check
    expect(fnBody).toContain('roles[action] == true')
  })

  it('revoke cleans up empty ACL entries', async () => {
    const source = await generateRuntimeSource({ handlers: false })

    const fnStart = source.indexOf('function hyperstache.revoke(')
    const fnEnd = source.indexOf('\nend', fnStart)
    const fnBody = source.slice(fnStart, fnEnd)

    expect(fnBody).toContain('hyperstache_acl[address][role] = nil')
    expect(fnBody).toContain('next(hyperstache_acl[address]) == nil')
    expect(fnBody).toContain('hyperstache_acl[address] = nil')
  })

  it('registers ACL handler endpoints', async () => {
    const source = await generateRuntimeSource({ handlers: false })

    expect(source).toContain('"Hyperstache-Grant-Role"')
    expect(source).toContain('"Hyperstache-Revoke-Role"')
    expect(source).toContain('"Hyperstache-Get-Roles"')
  })

  it('guards mutation handlers with has_permission', async () => {
    const source = await generateRuntimeSource({ handlers: false })

    expect(source).toContain(
      'hyperstache.has_permission(msg.From, "Hyperstache-Set")',
    )
    expect(source).toContain(
      'hyperstache.has_permission(msg.From, "Hyperstache-Remove")',
    )
  })

  it('guards Grant-Role and Revoke-Role with admin permission', async () => {
    const source = await generateRuntimeSource({ handlers: false })

    // Both grant and revoke handlers require admin permission
    const grantStart = source.indexOf('"Hyperstache-Grant-Role"')
    const grantEnd = source.indexOf('end\n  )', grantStart)
    const grantBody = source.slice(grantStart, grantEnd)
    expect(grantBody).toContain(
      'hyperstache.has_permission(msg.From, "admin")',
    )

    const revokeStart = source.indexOf('"Hyperstache-Revoke-Role"')
    const revokeEnd = source.indexOf('end\n  )', revokeStart)
    const revokeBody = source.slice(revokeStart, revokeEnd)
    expect(revokeBody).toContain(
      'hyperstache.has_permission(msg.From, "admin")',
    )
  })

  it('prevents non-Owner admins from granting or revoking admin role', async () => {
    const source = await generateRuntimeSource({ handlers: false })

    // Grant handler: admin escalation guard
    const grantStart = source.indexOf('"Hyperstache-Grant-Role"')
    const grantEnd = source.indexOf('end\n  )', grantStart)
    const grantBody = source.slice(grantStart, grantEnd)
    expect(grantBody).toContain('msg.From ~= Owner')
    expect(grantBody).toContain('role ~= "admin"')
    expect(grantBody).toContain('only the owner can grant admin role')

    // Revoke handler: admin escalation guard
    const revokeStart = source.indexOf('"Hyperstache-Revoke-Role"')
    const revokeEnd = source.indexOf('end\n  )', revokeStart)
    const revokeBody = source.slice(revokeStart, revokeEnd)
    expect(revokeBody).toContain('msg.From ~= Owner')
    expect(revokeBody).toContain('role ~= "admin"')
    expect(revokeBody).toContain('only the owner can revoke admin role')
  })

  it('Get-Roles handler is public with no permission check', async () => {
    const source = await generateRuntimeSource({ handlers: false })

    const getRolesStart = source.indexOf('"Hyperstache-Get-Roles"')
    const getRolesEnd = source.indexOf('end\n  )', getRolesStart)
    const getRolesBody = source.slice(getRolesStart, getRolesEnd)

    // Should NOT contain any permission check
    expect(getRolesBody).not.toContain('has_permission')
    expect(getRolesBody).not.toContain('assert')
  })

  it('renderTemplate builds merged partials from hyperstache_templates', async () => {
    const source = await generateRuntimeSource({ handlers: false })

    const fnStart = source.indexOf('function hyperstache.renderTemplate(')
    const fnEnd = source.indexOf('\nend', fnStart)
    const fnBody = source.slice(fnStart, fnEnd)

    // Should copy hyperstache_templates as base partials
    expect(fnBody).toContain('for k, v in pairs(hyperstache_templates)')
    expect(fnBody).toContain('merged[k] = v')
    // Should overlay explicit partials
    expect(fnBody).toContain('if partials then')
    expect(fnBody).toContain('for k, v in pairs(partials)')
    // Should pass merged to lustache
    expect(fnBody).toContain('lustache:render(tmpl, data, merged)')
  })

  it('render builds merged partials from hyperstache_templates', async () => {
    const source = await generateRuntimeSource({ handlers: false })

    const fnStart = source.indexOf('function hyperstache.render(')
    const fnEnd = source.indexOf('\nend', fnStart)
    const fnBody = source.slice(fnStart, fnEnd)

    // Should copy hyperstache_templates as base partials
    expect(fnBody).toContain('for k, v in pairs(hyperstache_templates)')
    expect(fnBody).toContain('merged[k] = v')
    // Should overlay explicit partials
    expect(fnBody).toContain('if partials then')
    expect(fnBody).toContain('for k, v in pairs(partials)')
    // Should pass merged to lustache
    expect(fnBody).toContain('lustache:render(template, data, merged)')
  })

  it('RenderTemplate handler parses JSON with data and partials', async () => {
    const source = await generateRuntimeSource({ handlers: false })

    const handlerStart = source.indexOf('"Hyperstache-RenderTemplate"')
    const handlerEnd = source.indexOf('end\n  )', handlerStart)
    const handlerBody = source.slice(handlerStart, handlerEnd)

    // Should parse msg.Data as JSON
    expect(handlerBody).toContain('json.decode')
    // Should pass parsed.data and parsed.partials
    expect(handlerBody).toContain('parsed.data or {}')
    expect(handlerBody).toContain('parsed.partials')
  })

  it('Render handler passes partials from parsed JSON', async () => {
    const source = await generateRuntimeSource({ handlers: false })

    const handlerStart = source.indexOf('"Hyperstache-Render"')
    const handlerEnd = source.indexOf('end\n  )', handlerStart)
    const handlerBody = source.slice(handlerStart, handlerEnd)

    // Should pass parsed.partials to render()
    expect(handlerBody).toContain('parsed.partials')
  })
})
