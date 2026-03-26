import { describe, it, expect } from 'vitest'
import { generateRuntimeSource } from '../src/bundler/runtime.js'

const defaults = { handlers: false, patchKey: 'ui', stateKey: 'hyperstache_state' }

describe('generateRuntimeSource', () => {
  it('generates Lua source with all API functions', async () => {
    const source = await generateRuntimeSource(defaults)

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
    const source = await generateRuntimeSource(defaults)

    // Should check for nil before setting
    expect(source).toContain('if hyperstache_templates[k] == nil then')
    expect(source).toContain('hyperstache_templates[k] = v')
  })

  it('does not auto-register handlers when handlers is false', async () => {
    const source = await generateRuntimeSource(defaults)

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
    const source = await generateRuntimeSource({ ...defaults, handlers: true })

    // Should have an auto-call to hyperstache.handlers()
    const lines = source.split('\n')
    const handlerCalls = lines.filter(
      (l) => l.trim() === 'hyperstache.handlers()',
    )
    expect(handlerCalls).toHaveLength(1)
  })

  it('registers all expected AO handlers', async () => {
    const source = await generateRuntimeSource(defaults)

    expect(source).toContain('"Hyperstache-Get"')
    expect(source).toContain('"Hyperstache-Set"')
    expect(source).toContain('"Hyperstache-Remove"')
    expect(source).toContain('"Hyperstache-List"')
    expect(source).toContain('"Hyperstache-RenderTemplate"')
    expect(source).toContain('"Hyperstache-Render"')
  })

  it('guards mutation handlers with permission check', async () => {
    const source = await generateRuntimeSource(defaults)

    // Set and Remove handlers should use has_permission
    expect(source).toContain('hyperstache.has_permission(msg.From')
  })

  it('sync() force-overwrites from bundled templates', async () => {
    const source = await generateRuntimeSource(defaults)

    // sync should not check for nil (unconditional overwrite)
    expect(source).toContain('function hyperstache.sync()')
    const syncStart = source.indexOf('function hyperstache.sync()')
    const syncEnd = source.indexOf('end', syncStart)
    const syncBody = source.slice(syncStart, syncEnd)
    expect(syncBody).toContain('hyperstache_templates[k] = v')
    expect(syncBody).not.toContain('== nil')
  })

  it('initializes hyperstache_acl global with defensive pattern', async () => {
    const source = await generateRuntimeSource(defaults)

    expect(source).toContain('if not hyperstache_acl then')
    expect(source).toContain('hyperstache_acl = {}')
  })

  it('exposes ACL API functions', async () => {
    const source = await generateRuntimeSource(defaults)

    expect(source).toContain('function hyperstache.has_permission(address, action)')
    expect(source).toContain('function hyperstache.grant(address, role)')
    expect(source).toContain('function hyperstache.revoke(address, role)')
    expect(source).toContain('function hyperstache.get_roles(address)')
  })

  it('has_permission checks Owner, admin role, and specific action', async () => {
    const source = await generateRuntimeSource(defaults)

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

  it('revoke removes role from ACL', async () => {
    const source = await generateRuntimeSource(defaults)

    const fnStart = source.indexOf('function hyperstache.revoke(')
    const fnEnd = source.indexOf('\nend', fnStart)
    const fnBody = source.slice(fnStart, fnEnd)

    expect(fnBody).toContain('hyperstache_acl[address][role] = nil')
  })

  it('registers ACL handler endpoints', async () => {
    const source = await generateRuntimeSource(defaults)

    expect(source).toContain('"Hyperstache-Grant-Role"')
    expect(source).toContain('"Hyperstache-Revoke-Role"')
    expect(source).toContain('"Hyperstache-Get-Roles"')
  })

  it('guards mutation handlers with has_permission', async () => {
    const source = await generateRuntimeSource(defaults)

    expect(source).toContain(
      'hyperstache.has_permission(msg.From, "Hyperstache-Set")',
    )
    expect(source).toContain(
      'hyperstache.has_permission(msg.From, "Hyperstache-Remove")',
    )
  })

  it('guards Grant-Role and Revoke-Role with admin permission', async () => {
    const source = await generateRuntimeSource(defaults)

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
    const source = await generateRuntimeSource(defaults)

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
    const source = await generateRuntimeSource(defaults)

    const getRolesStart = source.indexOf('"Hyperstache-Get-Roles"')
    const getRolesEnd = source.indexOf('end\n  )', getRolesStart)
    const getRolesBody = source.slice(getRolesStart, getRolesEnd)

    // Should NOT contain any permission check
    expect(getRolesBody).not.toContain('has_permission')
    expect(getRolesBody).not.toContain('assert')
  })

  it('renderTemplate builds merged partials from hyperstache_templates', async () => {
    const source = await generateRuntimeSource(defaults)

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
    const source = await generateRuntimeSource(defaults)

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
    const source = await generateRuntimeSource(defaults)

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
    const source = await generateRuntimeSource(defaults)

    const handlerStart = source.indexOf('"Hyperstache-Render"')
    const handlerEnd = source.indexOf('end\n  )', handlerStart)
    const handlerBody = source.slice(handlerStart, handlerEnd)

    // Should pass parsed.partials to render()
    expect(handlerBody).toContain('parsed.partials')
  })

  it('exposes patch() that accumulates without sending', async () => {
    const source = await generateRuntimeSource(defaults)

    expect(source).toContain('function hyperstache.patch(patches)')

    const fnStart = source.indexOf('function hyperstache.patch(')
    const fnEnd = source.indexOf('\nend', fnStart)
    const fnBody = source.slice(fnStart, fnEnd)

    // Should merge into persistent state
    expect(fnBody).toContain('_deep_set(hyperstache_patches, k, v)')
    // Should NOT send
    expect(fnBody).not.toContain('Send(')
    expect(fnBody).not.toContain('_sync_state()')
  })

  it('exposes publish() that accumulates and sends full state to patch@1.0', async () => {
    const source = await generateRuntimeSource(defaults)

    expect(source).toContain('function hyperstache.publish(patches)')

    const fnStart = source.indexOf('function hyperstache.publish(')
    const fnEnd = source.indexOf('\nend', fnStart)
    const fnBody = source.slice(fnStart, fnEnd)

    // Should optionally merge new patches
    expect(fnBody).toContain('_deep_set(hyperstache_patches, k, v)')
    // Should send full accumulated state
    expect(fnBody).toContain('device = "patch@1.0"')
    expect(fnBody).toContain('[_patch_key]')
    expect(fnBody).toContain('hyperstache_patches')
  })

  it('initializes hyperstache_patches global with defensive pattern', async () => {
    const source = await generateRuntimeSource(defaults)

    expect(source).toContain('if not hyperstache_patches then')
    expect(source).toContain('hyperstache_patches = {}')
  })

  it('uses default _patch_key = "ui"', async () => {
    const source = await generateRuntimeSource(defaults)

    expect(source).toContain('local _patch_key = "ui"')
  })

  it('injects custom patchKey into _patch_key', async () => {
    const source = await generateRuntimeSource({ ...defaults, patchKey: 'dashboard' })

    expect(source).toContain('local _patch_key = "dashboard"')
    expect(source).not.toContain('local _patch_key = "ui"')
  })

  it('uses default _state_key = "hyperstache_state"', async () => {
    const source = await generateRuntimeSource(defaults)

    expect(source).toContain('local _state_key = "hyperstache_state"')
  })

  it('injects custom stateKey into _state_key', async () => {
    const source = await generateRuntimeSource({ ...defaults, stateKey: 'my_state' })

    expect(source).toContain('local _state_key = "my_state"')
    expect(source).not.toContain('local _state_key = "hyperstache_state"')
  })

  it('defines _sync_state method that sends templates and acl under _state_key', async () => {
    const source = await generateRuntimeSource(defaults)

    expect(source).toContain('function hyperstache._sync_state()')

    const fnStart = source.indexOf('function hyperstache._sync_state()')
    const fnEnd = source.indexOf('\nend', fnStart)
    const fnBody = source.slice(fnStart, fnEnd)

    expect(fnBody).toContain('device = "patch@1.0"')
    expect(fnBody).toContain('[_state_key]')
    expect(fnBody).toContain('templates = hyperstache_templates')
    expect(fnBody).toContain("state['acl_'..address]")
  })

  it('calls _sync_state() at init after module definition', async () => {
    const source = await generateRuntimeSource(defaults)

    // _sync_state() is a method, so it must be called after the module table is defined
    const moduleDef = source.indexOf('local hyperstache = {}')
    const firstFn = source.indexOf('function hyperstache.get(')
    const between = source.slice(moduleDef, firstFn)
    expect(between).toContain('_sync_state()')
  })

  it('set() calls _sync_state()', async () => {
    const source = await generateRuntimeSource(defaults)

    const fnStart = source.indexOf('function hyperstache.set(')
    const fnEnd = source.indexOf('\nend', fnStart)
    const fnBody = source.slice(fnStart, fnEnd)

    expect(fnBody).toContain('_sync_state()')
  })

  it('remove() calls _sync_state()', async () => {
    const source = await generateRuntimeSource(defaults)

    const fnStart = source.indexOf('function hyperstache.remove(')
    const fnEnd = source.indexOf('\nend', fnStart)
    const fnBody = source.slice(fnStart, fnEnd)

    expect(fnBody).toContain('_sync_state()')
  })

  it('sync() calls _sync_state()', async () => {
    const source = await generateRuntimeSource(defaults)

    const fnStart = source.indexOf('function hyperstache.sync()')
    const fnEnd = source.indexOf('\nend', fnStart)
    const fnBody = source.slice(fnStart, fnEnd)

    expect(fnBody).toContain('_sync_state()')
  })

  it('grant() calls _sync_state()', async () => {
    const source = await generateRuntimeSource(defaults)

    const fnStart = source.indexOf('function hyperstache.grant(')
    const fnEnd = source.indexOf('\nend', fnStart)
    const fnBody = source.slice(fnStart, fnEnd)

    expect(fnBody).toContain('_sync_state()')
  })

  it('revoke() calls _sync_state() after mutation', async () => {
    const source = await generateRuntimeSource(defaults)

    const fnStart = source.indexOf('function hyperstache.revoke(')
    const fnEnd = source.indexOf('\nend', fnStart)
    const fnBody = source.slice(fnStart, fnEnd)

    expect(fnBody).toContain('_sync_state()')
  })

  it('revoke() skips _sync_state on early return when address not in ACL', async () => {
    const source = await generateRuntimeSource(defaults)

    const fnStart = source.indexOf('function hyperstache.revoke(')
    const fnEnd = source.indexOf('\nend', fnStart)
    const fnBody = source.slice(fnStart, fnEnd)

    // The early return should come before _sync_state
    const earlyReturn = fnBody.indexOf('return')
    const syncCall = fnBody.indexOf('_sync_state()')
    expect(earlyReturn).toBeLessThan(syncCall)
  })

  it('initializes hyperstache_published global with defensive pattern', async () => {
    const source = await generateRuntimeSource(defaults)

    expect(source).toContain('if not hyperstache_published then')
    expect(source).toContain('hyperstache_published = {}')
  })

  it('exposes publishTemplate() that renders, registers, and publishes', async () => {
    const source = await generateRuntimeSource(defaults)

    expect(source).toContain('function hyperstache.publishTemplate(key, patchPath, data, partials, statePath)')

    const fnStart = source.indexOf('function hyperstache.publishTemplate(')
    const fnEnd = source.indexOf('\nend', fnStart)
    const fnBody = source.slice(fnStart, fnEnd)

    // Should register in hyperstache_published
    expect(fnBody).toContain('hyperstache_published[patchPath]')
    // Should render to get HTML
    expect(fnBody).toContain('hyperstache.renderTemplate(key,')
    // Should store in patches
    expect(fnBody).toContain('_deep_set(hyperstache_patches, patchPath, html)')
    // Should send to patch device
    expect(fnBody).toContain('device = "patch@1.0"')
    expect(fnBody).toContain('[_patch_key]')
    // Should return the rendered HTML
    expect(fnBody).toContain('return html')
  })

  it('publishTemplate() supports function data for callbacks', async () => {
    const source = await generateRuntimeSource(defaults)

    const fnStart = source.indexOf('function hyperstache.publishTemplate(')
    const fnEnd = source.indexOf('\nend', fnStart)
    const fnBody = source.slice(fnStart, fnEnd)

    // Should detect function type
    expect(fnBody).toContain('type(data) == "function"')
    // Should store dataFn
    expect(fnBody).toContain('dataFn = data')
    // Should call function for initial data
    expect(fnBody).toContain('renderData = data()')
  })

  it('exposes unpublishTemplate() that deregisters and clears patch', async () => {
    const source = await generateRuntimeSource(defaults)

    expect(source).toContain('function hyperstache.unpublishTemplate(patchPath)')

    const fnStart = source.indexOf('function hyperstache.unpublishTemplate(')
    const fnEnd = source.indexOf('\nend', fnStart)
    const fnBody = source.slice(fnStart, fnEnd)

    // Should remove from published registry
    expect(fnBody).toContain('hyperstache_published[patchPath] = nil')
    // Should remove from patches
    expect(fnBody).toContain('_deep_remove(hyperstache_patches, patchPath)')
    // Should send updated patches
    expect(fnBody).toContain('device = "patch@1.0"')
  })

  it('set() calls _auto_rerender after _sync_state', async () => {
    const source = await generateRuntimeSource(defaults)

    const fnStart = source.indexOf('function hyperstache.set(')
    const fnEnd = source.indexOf('\nend', fnStart)
    const fnBody = source.slice(fnStart, fnEnd)

    expect(fnBody).toContain('_auto_rerender(key)')
    // _auto_rerender should come after _sync_state
    const syncPos = fnBody.indexOf('_sync_state()')
    const rerenderPos = fnBody.indexOf('_auto_rerender(key)')
    expect(syncPos).toBeLessThan(rerenderPos)
  })

  it('remove() calls _auto_rerender and cleans up published entries', async () => {
    const source = await generateRuntimeSource(defaults)

    const fnStart = source.indexOf('function hyperstache.remove(')
    const fnEnd = source.indexOf('\nend', fnStart)
    const fnBody = source.slice(fnStart, fnEnd)

    expect(fnBody).toContain('_auto_rerender(key)')
    // Should clean up published entries for removed key
    expect(fnBody).toContain('hyperstache_published[patchPath] = nil')
    expect(fnBody).toContain('reg.key == key')
  })

  it('sync() re-renders all published templates', async () => {
    const source = await generateRuntimeSource(defaults)

    const fnStart = source.indexOf('function hyperstache.sync()')
    const fnEnd = source.indexOf('\nend', fnStart)
    const fnBody = source.slice(fnStart, fnEnd)

    // Should iterate published registry
    expect(fnBody).toContain('for patchPath, reg in pairs(hyperstache_published)')
    // Should re-render using lustache
    expect(fnBody).toContain('lustache.render')
    // Should publish if anything changed
    expect(fnBody).toContain('device = "patch@1.0"')
  })

  it('defines _find_partial_refs helper for mustache partial detection', async () => {
    const source = await generateRuntimeSource(defaults)

    expect(source).toContain('local function _find_partial_refs(content)')
    // Should use gmatch for mustache partial syntax
    expect(source).toContain('{{>%s*([%w_%.%-/]+)%s*}}')
  })

  it('defines _depends_on helper for transitive partial dependency check', async () => {
    const source = await generateRuntimeSource(defaults)

    expect(source).toContain('local function _depends_on(template_key, changed_key, seen)')

    const fnStart = source.indexOf('local function _depends_on(')
    const fnEnd = source.indexOf('\nend\n', fnStart)
    const fnBody = source.slice(fnStart, fnEnd)

    // Should use cycle detection
    expect(fnBody).toContain('seen[template_key]')
    // Should call _find_partial_refs
    expect(fnBody).toContain('_find_partial_refs(content)')
    // Should check direct match
    expect(fnBody).toContain('refs[changed_key]')
    // Should recurse
    expect(fnBody).toContain('_depends_on(ref_key, changed_key, seen)')
  })

  it('defines _auto_rerender helper for batch re-rendering published templates', async () => {
    const source = await generateRuntimeSource(defaults)

    expect(source).toContain('local function _auto_rerender(changed_key)')

    const fnStart = source.indexOf('local function _auto_rerender(')
    const fnEnd = source.indexOf('\nend\n', fnStart)
    const fnBody = source.slice(fnStart, fnEnd)

    // Should iterate published registry
    expect(fnBody).toContain('for patchPath, reg in pairs(hyperstache_published)')
    // Should check direct key match and dependency
    expect(fnBody).toContain('reg.key == changed_key')
    expect(fnBody).toContain('_depends_on(reg.key, changed_key)')
    // Should support dataFn callback
    expect(fnBody).toContain('type(reg.dataFn) == "function"')
    // Should use pcall for safe rendering
    expect(fnBody).toContain('pcall(lustache.render')
    // Should batch publish
    expect(fnBody).toContain('device = "patch@1.0"')
  })

  it('defines _resolve_path helper for Lua global path resolution', async () => {
    const source = await generateRuntimeSource(defaults)

    expect(source).toContain('local function _resolve_path(path)')

    const fnStart = source.indexOf('local function _resolve_path(')
    const fnEnd = source.indexOf('\nend\n', fnStart)
    const fnBody = source.slice(fnStart, fnEnd)

    // Should start from _G
    expect(fnBody).toContain('local current = _G')
    // Should split on dots
    expect(fnBody).toContain('path:gmatch("[^%.]+")') 
    // Should walk table segments
    expect(fnBody).toContain('current = current[segment]')
    // Should handle non-table intermediaries
    expect(fnBody).toContain('type(current) ~= "table"')
  })

  it('exposes listPublished() that returns serializable view of published', async () => {
    const source = await generateRuntimeSource(defaults)

    expect(source).toContain('function hyperstache.listPublished()')

    const fnStart = source.indexOf('function hyperstache.listPublished()')
    const fnEnd = source.indexOf('\nend', fnStart)
    const fnBody = source.slice(fnStart, fnEnd)

    // Should iterate hyperstache_published
    expect(fnBody).toContain('for patchPath, reg in pairs(hyperstache_published)')
    // Should return key and statePath
    expect(fnBody).toContain('key = reg.key')
    expect(fnBody).toContain('statePath = reg.statePath')
  })

  it('publishTemplate() stores statePath in registration', async () => {
    const source = await generateRuntimeSource(defaults)

    const fnStart = source.indexOf('function hyperstache.publishTemplate(')
    const fnEnd = source.indexOf('\nend', fnStart)
    const fnBody = source.slice(fnStart, fnEnd)

    // Should store statePath in published entry
    expect(fnBody).toContain('statePath = statePath')
  })

  it('_sync_state includes published_keys', async () => {
    const source = await generateRuntimeSource(defaults)

    const fnStart = source.indexOf('function hyperstache._sync_state()')
    const fnEnd = source.indexOf('\nend', fnStart)
    const fnBody = source.slice(fnStart, fnEnd)

    expect(fnBody).toContain("published_keys = ''")
    expect(fnBody).toContain('for patchPath, _ in pairs(hyperstache_published)')
    expect(fnBody).toContain("state.published_keys = state.published_keys .. patchPath")
  })

  it('registers Hyperstache-Publish-Template handler', async () => {
    const source = await generateRuntimeSource(defaults)

    expect(source).toContain('"Hyperstache-Publish-Template"')

    const handlerStart = source.indexOf('"Hyperstache-Publish-Template"')
    const handlerEnd = source.indexOf('end\n  )', handlerStart)
    const handlerBody = source.slice(handlerStart, handlerEnd)

    // Permission gated
    expect(handlerBody).toContain('hyperstache.has_permission(msg.From, "Hyperstache-Publish-Template")')
    // Requires Key and Path tags
    expect(handlerBody).toContain('msg.Tags.Key or msg.Tags.key')
    expect(handlerBody).toContain('msg.Tags.Path or msg.Tags.path')
    // Supports optional State-Path tag
    expect(handlerBody).toContain('msg.Tags["State-Path"]')
    // Uses _resolve_path for state path
    expect(handlerBody).toContain('_resolve_path(statePath)')
    // Calls publishTemplate
    expect(handlerBody).toContain('hyperstache.publishTemplate')
  })

  it('registers Hyperstache-Unpublish-Template handler', async () => {
    const source = await generateRuntimeSource(defaults)

    expect(source).toContain('"Hyperstache-Unpublish-Template"')

    const handlerStart = source.indexOf('"Hyperstache-Unpublish-Template"')
    const handlerEnd = source.indexOf('end\n  )', handlerStart)
    const handlerBody = source.slice(handlerStart, handlerEnd)

    // Permission gated
    expect(handlerBody).toContain('hyperstache.has_permission(msg.From, "Hyperstache-Unpublish-Template")')
    // Requires Path tag
    expect(handlerBody).toContain('msg.Tags.Path or msg.Tags.path')
    // Calls unpublishTemplate
    expect(handlerBody).toContain('hyperstache.unpublishTemplate(path)')
  })

  it('registers Hyperstache-List-Published handler (public, no permission check)', async () => {
    const source = await generateRuntimeSource(defaults)

    expect(source).toContain('"Hyperstache-List-Published"')

    const handlerStart = source.indexOf('"Hyperstache-List-Published"')
    const handlerEnd = source.indexOf('end\n  )', handlerStart)
    const handlerBody = source.slice(handlerStart, handlerEnd)

    // Should NOT have permission check
    expect(handlerBody).not.toContain('has_permission')
    expect(handlerBody).not.toContain('assert')
    // Should call listPublished and return JSON
    expect(handlerBody).toContain('hyperstache.listPublished()')
    expect(handlerBody).toContain('json.encode(published)')
  })
})
