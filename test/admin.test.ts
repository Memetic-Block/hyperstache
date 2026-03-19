import { describe, it, expect } from 'vitest'
import { generateAdminSource } from '../src/bundler/admin.js'

describe('generateAdminSource', () => {
  it('generates Lua source with admin UI HTML', async () => {
    const source = await generateAdminSource({ handlers: false })

    expect(source).toContain('local admin = {}')
    expect(source).toContain('return admin')
    expect(source).toContain('require("hyperstache")')
    expect(source).toContain('hyperstache_admin')
  })

  it('embeds a self-contained HTML page', async () => {
    const source = await generateAdminSource({ handlers: false })

    expect(source).toContain('<!DOCTYPE html>')
    expect(source).toContain('Hyperstache Admin')
    expect(source).toContain('</html>')
  })

  it('includes import map with aoconnect txid', async () => {
    const source = await generateAdminSource({ handlers: false })

    expect(source).toContain('@permaweb/aoconnect')
    expect(source).toContain('K45UpuInM8T0zvWSQbi-YPuh1LGGfC62DFCaXvRpdM')
  })

  it('contains templates management section', async () => {
    const source = await generateAdminSource({ handlers: false })

    expect(source).toContain('id="templates"')
    expect(source).toContain('id="template-list"')
    expect(source).toContain('id="template-editor"')
    expect(source).toContain('Hyperstache-Set')
    expect(source).toContain('Hyperstache-Remove')
    expect(source).toContain('Hyperstache-List')
    expect(source).toContain('Hyperstache-Get')
  })

  it('contains ACL management section', async () => {
    const source = await generateAdminSource({ handlers: false })

    expect(source).toContain('id="acl"')
    expect(source).toContain('id="acl-list"')
    expect(source).toContain('Hyperstache-Grant-Role')
    expect(source).toContain('Hyperstache-Revoke-Role')
    expect(source).toContain('Hyperstache-Get-Roles')
  })

  it('contains render preview section', async () => {
    const source = await generateAdminSource({ handlers: false })

    expect(source).toContain('id="preview"')
    expect(source).toContain('id="preview-output"')
    expect(source).toContain('Hyperstache-Render')
  })

  it('injects ao.id as process ID placeholder', async () => {
    const source = await generateAdminSource({ handlers: false })

    // The JS uses __PROCESS_ID__ which gets replaced by Lua at runtime
    expect(source).toContain('__PROCESS_ID__')
    expect(source).toContain('ao.id')
    expect(source).toContain(':gsub("__PROCESS_ID__", ao.id)')
  })

  it('uses default path key "admin" when no path specified', async () => {
    const source = await generateAdminSource({ handlers: false })

    expect(source).toContain('local _path = "admin"')
    // No __ADMIN_PATH__ placeholders should remain
    expect(source).not.toContain('__ADMIN_PATH__')
  })

  it('replaces path key with custom value', async () => {
    const source = await generateAdminSource({ handlers: false, path: 'manage' })

    expect(source).toContain('local _path = "manage"')
    expect(source).not.toContain('__ADMIN_PATH__')
    expect(source).not.toContain('local _path = "admin"')
  })

  it('does not auto-call handlers when handlers is false', async () => {
    const source = await generateAdminSource({ handlers: false })

    expect(source).toContain('function admin.handlers()')
    const lines = source.split('\n')
    const handlerCalls = lines.filter(l => l.trim() === 'admin.handlers()')
    expect(handlerCalls).toHaveLength(0)
  })

  it('auto-calls handlers when handlers is true', async () => {
    const source = await generateAdminSource({ handlers: true })

    const lines = source.split('\n')
    const handlerCalls = lines.filter(l => l.trim() === 'admin.handlers()')
    expect(handlerCalls).toHaveLength(1)
  })

  it('registers mutation sync handlers via Handlers.append', async () => {
    const source = await generateAdminSource({ handlers: false })

    expect(source).toContain('Handlers.append("Hyperstache-Admin-Sync-Set"')
    expect(source).toContain('Handlers.append("Hyperstache-Admin-Sync-Remove"')
    expect(source).toContain('Handlers.append("Hyperstache-Admin-Sync-Grant"')
    expect(source).toContain('Handlers.append("Hyperstache-Admin-Sync-Revoke"')
  })

  it('guards sync handlers with ACL permission checks', async () => {
    const source = await generateAdminSource({ handlers: false })

    // Set and Remove sync handlers check their respective permissions
    const setStart = source.indexOf('"Hyperstache-Admin-Sync-Set"')
    const setEnd = source.indexOf('end\n  )', setStart)
    const setBody = source.slice(setStart, setEnd)
    expect(setBody).toContain('hyperstache.has_permission(msg.From, "Hyperstache-Set")')

    const removeStart = source.indexOf('"Hyperstache-Admin-Sync-Remove"')
    const removeEnd = source.indexOf('end\n  )', removeStart)
    const removeBody = source.slice(removeStart, removeEnd)
    expect(removeBody).toContain('hyperstache.has_permission(msg.From, "Hyperstache-Remove")')

    // Grant and Revoke sync handlers require admin permission
    const grantStart = source.indexOf('"Hyperstache-Admin-Sync-Grant"')
    const grantEnd = source.indexOf('end\n  )', grantStart)
    const grantBody = source.slice(grantStart, grantEnd)
    expect(grantBody).toContain('hyperstache.has_permission(msg.From, "admin")')

    const revokeStart = source.indexOf('"Hyperstache-Admin-Sync-Revoke"')
    const revokeEnd = source.indexOf('end\n  )', revokeStart)
    const revokeBody = source.slice(revokeStart, revokeEnd)
    expect(revokeBody).toContain('hyperstache.has_permission(msg.From, "admin")')
  })

  it('publishes to patch@1.0 via Send', async () => {
    const source = await generateAdminSource({ handlers: false })

    expect(source).toContain('Send({')
    expect(source).toContain('device = "patch@1.0"')
    expect(source).toContain('[_path] = hyperstache_admin')
  })

  it('renders and publishes on init when handlers enabled', async () => {
    const source = await generateAdminSource({ handlers: false })

    // The handlers function should call render + publish before registering
    const handlersStart = source.indexOf('function admin.handlers()')
    const handlersBody = source.slice(handlersStart, source.indexOf('\nend', handlersStart + 100))
    expect(handlersBody).toContain('admin.render()')
    expect(handlersBody).toContain('admin.publish()')
  })

  it('custom path key propagates to Send call', async () => {
    const source = await generateAdminSource({ handlers: false, path: 'dashboard' })

    expect(source).toContain('local _path = "dashboard"')
    // The Send uses [_path] which is a dynamic key, so the variable holds the path
    expect(source).toContain('[_path] = hyperstache_admin')
  })
})
