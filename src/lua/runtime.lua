--- Hyperengine: A template management runtime for AO processes.
--- Provides CRUD operations for Mustache templates, rendering with partials,
--- automatic dependency-aware re-rendering, role-based access control,
--- and persistent state sync to HyperBEAM's `patch@1.0` device.
---@module 'hyperengine'

---@alias TemplateMap table<string, string> Template key to content mapping
---@alias ACL table<string, table<string, boolean>> Address to role-set mapping (address → { role → true })
---@alias PatchMap table<string, string> Patch path to rendered HTML mapping
---@alias PublishedRegistry table<string, HyperenginePublishedEntry> Patch path to published entry mapping
---@alias DataProvider table|fun():table Static data table or dynamic data function callback

--- Internal registration entry stored in `hyperengine_published`.
---@class HyperenginePublishedEntry
---@field key string Template key that was published
---@field data? table Static data table (nil when using a data function)
---@field dataFn? fun():table Dynamic data function called on each re-render
---@field partials? TemplateMap Additional partials passed at publish time
---@field statePath? string Dot-notation path to a Lua global used as dynamic data source

--- Published template info returned by `get_state()`.
---@class HyperenginePublishedInfo
---@field path string The patch path this template is published to
---@field template_name string The template key used for rendering
---@field partials? TemplateMap Additional partials passed at publish time
---@field statePath? string Dot-notation path to a Lua global used as data source
---@field re_render_on_state_change boolean Whether this entry auto-rerenders on template changes

--- State snapshot returned by `get_state()`.
---@class HyperengineState
---@field templates string[] Array of all template keys
---@field published HyperenginePublishedInfo[] Array of published template info entries
---@field acl ACL The current access control list

---@class hyperengine
local _bundled = require("templates")
local _patch_key = "ui"
local _state_key = "hyperengine_state"

---@type TemplateMap Persistent template storage; survives AO process reloads via lowercase globals.
if not hyperengine_templates then
  hyperengine_templates = {}
end
for k, v in pairs(_bundled) do
  if hyperengine_templates[k] == nil then
    hyperengine_templates[k] = v
  end
end

---@type ACL Role-based access control list; `{ [address] = { [role] = true } }`.
if not hyperengine_acl then
  hyperengine_acl = { [Owner] = { owner = true } }
end

---@type PatchMap Accumulated HTML patches keyed by patch path, sent to `patch@1.0`.
if not hyperengine_patches then
  hyperengine_patches = {}
end

---@type PublishedRegistry Registry of published templates for auto-rerender tracking.
if not hyperengine_published then
  hyperengine_published = {}
end

local lustache = require("lustache")

--- Resolve a dot-notation path against the Lua global table `_G`.
--- For example, `"state.config.title"` traverses `_G.state.config.title`.
---@private
---@param path string Dot-notation path (e.g. `"state.config.title"`)
---@return any|nil value The resolved value, or `nil` if any segment is missing
local function _resolve_path(path)
  local current = _G
  for segment in path:gmatch("[^%.]+") do
    if type(current) ~= "table" then return nil end
    current = current[segment]
  end
  return current
end

--- Extract all Mustache partial references (`{{>name}}`) from a template string.
---@private
---@param content string|any Template content to scan (non-strings return empty table)
---@return table<string, boolean> refs Set of partial names found (name → `true`)
local function _find_partial_refs(content)
  local refs = {}
  if type(content) ~= "string" then
    return refs
  end
  for name in content:gmatch("{{>%s*([%w_%.%-/]+)%s*}}") do
    refs[name] = true
  end
  return refs
end

--- Set a value in a nested table by splitting `path` on `/`.
--- For example, `_deep_set(t, "a/b/c", v)` produces `t.a.b.c = v`,
--- creating intermediate tables as needed.
---@private
---@param tbl table Root table to write into
---@param path string Slash-delimited path (e.g. `"admin/index.html"`)
---@param value any Value to store at the leaf
local function _deep_set(tbl, path, value)
  local segments = {}
  for seg in path:gmatch("[^/]+") do
    segments[#segments + 1] = seg
  end
  if #segments == 0 then return end
  local current = tbl
  for i = 1, #segments - 1 do
    if type(current[segments[i]]) ~= "table" then
      current[segments[i]] = {}
    end
    current = current[segments[i]]
  end
  current[segments[#segments]] = value
end

--- Remove a leaf value from a nested table by splitting `path` on `/`.
---@private
---@param tbl table Root table to remove from
---@param path string Slash-delimited path
local function _deep_remove(tbl, path)
  local segments = {}
  for seg in path:gmatch("[^/]+") do
    segments[#segments + 1] = seg
  end
  if #segments == 0 then return end
  local current = tbl
  for i = 1, #segments - 1 do
    if type(current[segments[i]]) ~= "table" then return end
    current = current[segments[i]]
  end
  current[segments[#segments]] = nil
end

local function _deep_copy(orig, copies)
  copies = copies or {}
  local orig_type = type(orig)
  local copy
  if orig_type == 'table' then
    if copies[orig] then
      copy = copies[orig]
    else
      copy = {}
      copies[orig] = copy
      for orig_key, orig_value in next, orig, nil do
        copy[_deep_copy(orig_key, copies)] = _deep_copy(orig_value, copies)
      end
      setmetatable(copy, _deep_copy(getmetatable(orig), copies))
    end
  else -- number, string, boolean, etc
    copy = orig
  end
  return copy
end

--- Recursively check whether `template_key` depends on `changed_key` via partial references.
--- Performs a depth-first traversal through the partial dependency graph with cycle detection.
---@private
---@param template_key string The template to check for dependency
---@param changed_key string The template key that was modified
---@param seen? table<string, boolean> Visited set for cycle detection (created internally)
---@return boolean depends `true` if `template_key` depends on `changed_key` (directly or transitively)
local function _depends_on(template_key, changed_key, seen)
  if not seen then seen = {} end
  if seen[template_key] then return false end
  seen[template_key] = true
  local content = hyperengine_templates[template_key]
  if not content then return false end
  local refs = _find_partial_refs(content)
  if refs[changed_key] then return true end
  for ref_key in pairs(refs) do
    if _depends_on(ref_key, changed_key, seen) then
      return true
    end
  end
  return false
end

--- Re-render all published templates that depend on `changed_key`.
--- Iterates over `hyperengine_published`, checks direct key match and transitive
--- partial dependencies, re-renders affected templates, and sends a batched
--- `patch@1.0` message if any output changed.
---@private
---@param changed_key string The template key that was modified
local function _auto_rerender(changed_key)
  local any_changed = false
  for patchPath, published in pairs(hyperengine_published) do
    if published.template_key == changed_key or _depends_on(published.template_key, changed_key) then
      local data = published.data
      if type(published.dataFn) == "function" then
        local ok, result = pcall(published.dataFn)
        if ok then data = result end
      end
      local ok, html = pcall(lustache.render, lustache, hyperengine_templates[published.template_key] or "", data or {}, hyperengine_templates)
      if ok then
        _deep_set(hyperengine_patches, patchPath, html)
        any_changed = true
      end
    end
  end
  if any_changed then
    Send({ device = "patch@1.0", [_patch_key] = hyperengine_patches })
  end
end

local hyperengine = {}

--- Return a snapshot of the current hyperengine state.
--- Includes template keys, published template info, and the ACL.
---@return HyperengineState state Current state snapshot
function hyperengine.get_state()
  local state = {
    templates = {},
    published = {},
    acl = hyperengine_acl,
    ui_root = _patch_key
  }
  for template_key, _ in pairs(hyperengine_templates) do
    table.insert(state.templates, template_key)
  end
  for patchPath, published in pairs(hyperengine_published) do
    table.insert(state.published, {
      path = patchPath,
      template_name = published.template_key,
      partials = published.partials,
      statePath = published.statePath,
      re_render_on_state_change = type(published.dataFn) == "function" or type(published.data) == "table"
    })
  end

  return state
end

--- Sync current templates, ACL, and published state to `patch@1.0`.
--- Triggers an auto-rerender of the admin interface and sends all
--- accumulated patches, state, templates, and published registry in a single message.
function hyperengine.sync()
  local hyperengine_state = hyperengine.get_state()
  -- _auto_rerender('admin/index.html')

  for _, published in pairs(hyperengine_published) do
    hyperengine.republishTemplate(published.template_key)
  end

  Send({
    device = "patch@1.0",
    [_patch_key] = hyperengine_patches,
    [_state_key] = hyperengine_state,
    hyperengine_templates = hyperengine_templates,
    hyperengine_published = hyperengine_published
  })
end

-- function hyperengine.sync_rerender()
--   Send({
--     device = "patch@1.0",
--     [_patch_key] = hyperengine_patches
--   })
-- end

--- Retrieve template content by key.
---@param key string Template key (e.g. `"index.html"`)
---@return string|nil content Template content, or `nil` if not found
function hyperengine.get(key)
  return hyperengine_templates[key]
end

--- Create or update a template.
--- Stores the content, syncs state to `patch@1.0`, and triggers auto-rerender
--- of all published templates that depend on this key.
---@param key string Template key (e.g. `"index.html"`)
---@param content string Template content (Mustache syntax)
function hyperengine.set(key, content)
  hyperengine_templates[key] = content
  hyperengine.sync()
  -- _auto_rerender(key)
end

--- Delete a template and clean up any published entries that reference it.
--- Removes the template from storage, unpublishes all entries using this key,
--- syncs state, and triggers auto-rerender for any remaining dependents.
---@param key string Template key to remove
function hyperengine.remove(key)
  hyperengine_templates[key] = nil
  for patchPath, published in pairs(hyperengine_published) do
    if published.template_key == key then
      hyperengine_published[patchPath] = nil
      _deep_remove(hyperengine_patches, patchPath)
    end
  end
  hyperengine.sync()
  -- _auto_rerender(key)
end

--- Return an array of all stored template keys.
---@return string[] keys List of template keys
function hyperengine.list()
  local keys = {}
  for k in pairs(hyperengine_templates) do
    keys[#keys + 1] = k
  end
  return keys
end

--- Render a stored template by key with optional data and partials.
--- All stored templates are automatically available as partials. Explicit
--- partials override stored templates with the same key.
---@param template_key string Template key to render
---@param data? table Data context for Mustache rendering
---@param partials? TemplateMap Additional partials to merge (override stored templates)
---@return string html Rendered HTML output
---@error Throws if the template key is not found
function hyperengine.renderTemplate(template_key, data, partials)
  local tmpl = hyperengine_templates[template_key]
  assert(type(tmpl) == "string", "template not found: " .. tostring(template_key))
  lustache.renderer:clear_cache()
  return lustache:render(tmpl, data, partials)
end

--- Render a raw Mustache template string with optional data and partials.
--- All stored templates are automatically available as partials. Explicit
--- partials override stored templates with the same key.
---@param template string Mustache template string to render
---@param data? table Data context for Mustache rendering
---@param partials? TemplateMap Additional partials to merge (override stored templates)
---@return string html Rendered HTML output
---@error Throws if `template` is not a string
function hyperengine.render(template, data, partials)
  assert(type(template) == "string", "expected string template, got " .. type(template))
  lustache.renderer:clear_cache()
  return lustache:render(template, data, partials)
end

--- Check whether an address has permission to perform an action.
--- Permission is granted if any of the following are true:
--- 1. The address is the process `Owner` (always authorized)
--- 2. The address has the `"admin"` role (authorized for everything)
--- 3. The address has a role matching the exact `action` name
---@param address string The wallet address to check
---@param action string The action name (e.g. `"Hyperengine-Set"`, `"admin"`)
---@return boolean authorized `true` if the address is permitted
function hyperengine.has_permission(address, action)
  if address == Owner then
    return true
  end
  local roles = hyperengine_acl[address]
  if not roles then
    return false
  end
  if roles["admin"] then
    return true
  end
  return roles[action] == true
end

--- Grant a role to an address.
--- Creates the ACL entry for the address if it doesn't exist.
---@param address string The wallet address to grant the role to
---@param role string The role to grant (e.g. `"admin"`, `"Hyperengine-Set"`)
function hyperengine.grant(address, role)
  if not hyperengine_acl[address] then
    hyperengine_acl[address] = {}
  end
  hyperengine_acl[address][role] = true
  hyperengine.sync()
end

--- Revoke a role from an address.
--- No-op if the address has no ACL entry.
---@param address string The wallet address to revoke the role from
---@param role string The role to revoke
function hyperengine.revoke(address, role)
  if not hyperengine_acl[address] then
    return
  end
  hyperengine_acl[address][role] = nil
  hyperengine.sync()
end

--- Get roles for a specific address, or the entire ACL if no address is given.
---@param address? string Wallet address to query (omit for full ACL)
---@return table<string, boolean>|ACL roles Role set for the address, or the full ACL table
function hyperengine.get_roles(address)
  if address then
    return hyperengine_acl[address] or {}
  end
  return hyperengine_acl
end

--- List all currently published templates.
---@return table<string, { key: string, statePath: string? }> published Map of patch path to published template info
function hyperengine.listPublished()
  local result = {}
  for patchPath, published in pairs(hyperengine_published) do
    result[patchPath] = {
      template_key = published.template_key,
      statePath = published.statePath
    }
  end
  return result
end

--- Render a template and register it for automatic re-rendering.
--- When any template this one depends on changes (directly or via partials),
--- it will be automatically re-rendered and re-published.
---
--- The `data` parameter can be:
--- - A **table**: stored as static data, re-used on each auto-rerender.
--- - A **function**: called on each render to produce fresh data (useful for live dashboards).
---
---@param template_key string Template key to render
---@param ui_path string Path to publish rendered output to via `patch@1.0`
---@param data? DataProvider Data table or function returning data for rendering
---@param partials? TemplateMap Additional partials for rendering
---@param statePath? string Dot-notation path to a Lua global used as dynamic data source
---@return string html The rendered HTML output
function hyperengine.publishTemplate(template_key, ui_path, data, partials, statePath)
  local dataFn = nil
  local renderData = data
  if type(data) == "function" then
    dataFn = data
    renderData = data()
  end
  local partialsCopy = _deep_copy(partials)
  local html = hyperengine.renderTemplate(template_key, renderData or {}, partialsCopy)
  hyperengine_published[ui_path] = {
    template_key = template_key,
    data = (type(data) ~= "function") and data or nil,
    dataFn = dataFn,
    partials = partialsCopy,
    statePath = statePath
  }
  _deep_set(hyperengine_patches, ui_path, html)

  return html
end

function hyperengine.republishTemplate(template_key)
  for patchPath, published in pairs(hyperengine_published) do
    if published.template_key == template_key then
      hyperengine.publishTemplate(published.template_key, patchPath, published.dataFn or published.data, published.partials, published.statePath)
    end
  end
end

--- Stop publishing a template at the given patch path.
--- Removes the registration and clears the patch, then sends updated patches.
---@param patchPath string The patch path to unpublish
function hyperengine.unpublishTemplate(patchPath)
  hyperengine_published[patchPath] = nil
  _deep_remove(hyperengine_patches, patchPath)
  Send({ device = "patch@1.0", [_patch_key] = hyperengine_patches })
end

--- Accumulate HTML patches without sending them.
--- Merges the provided patches into `hyperengine_patches`. Call `publish()` to send.
---@param patches PatchMap Patch path to HTML content mapping
function hyperengine.patch(patches)
  for k, v in pairs(patches) do
    _deep_set(hyperengine_patches, k, v)
  end
end

--- Publish all accumulated patches to `patch@1.0`.
--- Optionally merges additional patches before sending.
---@param patches? PatchMap Additional patches to merge before publishing
function hyperengine.publish(patches)
  if patches then
    for k, v in pairs(patches) do
      _deep_set(hyperengine_patches, k, v)
    end
  end
  Send({ device = "patch@1.0", [_patch_key] = hyperengine_patches })
end

--- Register all AO message handlers for remote template management.
--- Adds 12 handlers to the AO `Handlers` table:
---
--- **Public (no auth required):**
--- - `Hyperengine-Get` — Retrieve template content (Tag: `Key`)
--- - `Hyperengine-List` — List all template keys
--- - `Hyperengine-RenderTemplate` — Render stored template (Tag: `Key`, Body: JSON `{data, partials}`)
--- - `Hyperengine-Render` — Render raw template string (Body: JSON `{template, data, partials}`)
--- - `Hyperengine-Get-Roles` — Query ACL roles (Tag: `Address` optional)
--- - `Hyperengine-List-Published` — List all published templates
---
--- **Owner/Admin/Per-action role required:**
--- - `Hyperengine-Set` — Create/update template (Tag: `Key`, Body: content)
--- - `Hyperengine-Remove` — Delete template (Tag: `Key`)
--- - `Hyperengine-Publish-Template` — Publish rendered template (Tags: `Template-Name`, `Publish-Path`, `State-Path?`)
--- - `Hyperengine-Unpublish-Template` — Stop publishing (Tag: `Path`)
---
--- **Owner/Admin only:**
--- - `Hyperengine-Grant-Role` — Grant role (Tags: `Address`, `Role`)
--- - `Hyperengine-Revoke-Role` — Revoke role (Tags: `Address`, `Role`)
function hyperengine.handlers()
  Handlers.add("Hyperengine-Get",
    Handlers.utils.hasMatchingTag("Action", "Hyperengine-Get"),
    function(msg)
      local template_key = msg.Tags['Template-Key']
      local tmpl = hyperengine.get(template_key)
      Send({ Target = msg.From, Action = 'Hyperengine-Get-Response', Data = tmpl or "" })
    end
  )

  Handlers.add("Hyperengine-List",
    Handlers.utils.hasMatchingTag("Action", "Hyperengine-List"),
    function(msg)
      local keys = hyperengine.list()
      Send({ Target = msg.From, Action = 'Hyperengine-List-Response', Data = table.concat(keys, "\n") })
    end
  )

  Handlers.add("Hyperengine-RenderTemplate",
    Handlers.utils.hasMatchingTag("Action", "Hyperengine-RenderTemplate"),
    function(msg)
      local template_key = msg.Tags['Template-Key']
      local ok, parsed = pcall(json.decode, msg.Data or "{}")
      if not ok then
        Send({ Target = msg.From, Action = 'Hyperengine-RenderTemplate-Response', Data = "", Error = "invalid JSON: " .. tostring(parsed) })
        return
      end
      local ok2, result = pcall(hyperengine.renderTemplate, template_key, parsed.data or {}, parsed.partials)
      if ok2 then
        Send({ Target = msg.From, Action = 'Hyperengine-RenderTemplate-Response', Data = result })
      else
        Send({ Target = msg.From, Action = 'Hyperengine-RenderTemplate-Response', Data = "", Error = result })
      end
    end
  )

  Handlers.add("Hyperengine-Render",
    Handlers.utils.hasMatchingTag("Action", "Hyperengine-Render"),
    function(msg)
      local ok, parsed = pcall(json.decode, msg.Data or "{}")
      if not ok then
        Send({ Target = msg.From, Action = 'Hyperengine-Render-Response', Data = "", Error = "invalid JSON: " .. tostring(parsed) })
        return
      end
      local tmpl = parsed.template or ""
      local ok2, result = pcall(hyperengine.render, tmpl, parsed.data or {}, parsed.partials)
      if ok2 then
        Send({ Target = msg.From, Action = 'Hyperengine-Render-Response', Data = result })
      else
        Send({ Target = msg.From, Action = 'Hyperengine-Render-Response', Data = "", Error = result })
      end
    end
  )

  Handlers.add("Hyperengine-Set",
    Handlers.utils.hasMatchingTag("Action", "Hyperengine-Set"),
    function(msg)
      assert(hyperengine.has_permission(msg.From, "Hyperengine-Set"), "not authorized to set templates")
      local template_key = msg.Tags['Template-Key']
      assert(type(template_key) == "string" and template_key ~= "", "Template-Key tag is required and must be a non-empty string")
      hyperengine.set(template_key, msg.Data)
      Send({ Target = msg.From, Action = 'Hyperengine-Set-Response', Data = 'OK' })
    end
  )

  Handlers.add("Hyperengine-Remove",
    Handlers.utils.hasMatchingTag("Action", "Hyperengine-Remove"),
    function(msg)
      assert(hyperengine.has_permission(msg.From, "Hyperengine-Remove"), "not authorized to remove templates")
      local template_key = msg.Tags['Template-Key']
      hyperengine.remove(template_key)
      Send({ Target = msg.From, Action = 'Hyperengine-Remove-Response', Data = 'OK' })
    end
  )

  Handlers.add("Hyperengine-Grant-Role",
    Handlers.utils.hasMatchingTag("Action", "Hyperengine-Grant-Role"),
    function(msg)
      assert(hyperengine.has_permission(msg.From, "admin"), "not authorized to manage roles")
      local address = msg.Tags.Address or msg.Tags.address
      local role = msg.Tags.Role or msg.Tags.role
      assert(address, "Address tag is required")
      assert(role, "Role tag is required")
      if msg.From ~= Owner then
        assert(role ~= "admin", "only the owner can grant admin role")
      end
      hyperengine.grant(address, role)
      Send({ Target = msg.From, Action = 'Hyperengine-Grant-Role-Response', Data = 'OK' })
    end
  )

  Handlers.add("Hyperengine-Revoke-Role",
    Handlers.utils.hasMatchingTag("Action", "Hyperengine-Revoke-Role"),
    function(msg)
      assert(hyperengine.has_permission(msg.From, "admin"), "not authorized to manage roles")
      local address = msg.Tags.Address or msg.Tags.address
      local role = msg.Tags.Role or msg.Tags.role
      assert(address, "Address tag is required")
      assert(role, "Role tag is required")
      if msg.From ~= Owner then
        assert(role ~= "admin", "only the owner can revoke admin role")
      end
      hyperengine.revoke(address, role)
      Send({ Target = msg.From, Action = 'Hyperengine-Revoke-Role-Response', Data = 'OK' })
    end
  )

  Handlers.add("Hyperengine-Get-Roles",
    Handlers.utils.hasMatchingTag("Action", "Hyperengine-Get-Roles"),
    function(msg)
      local address = msg.Tags.Address or msg.Tags.address
      local roles = hyperengine.get_roles(address)
      if address then
        local keys = {}
        for k in pairs(roles) do
          keys[#keys + 1] = k
        end
        Send({ Target = msg.From, Action = 'Hyperengine-Get-Roles-Response', Data = table.concat(keys, "\n") })
      else
        local lines = {}
        for addr, r in pairs(roles) do
          local keys = {}
          for k in pairs(r) do
            keys[#keys + 1] = k
          end
          lines[#lines + 1] = addr .. ":" .. table.concat(keys, ",")
        end
        Send({ Target = msg.From, Action = 'Hyperengine-Get-Roles-Response', Data = table.concat(lines, "\n") })
      end
    end
  )

  Handlers.add("Hyperengine-Publish-Template",
    Handlers.utils.hasMatchingTag("Action", "Hyperengine-Publish-Template"),
    function(msg)
      assert(hyperengine.has_permission(msg.From, "Hyperengine-Publish-Template"), "not authorized to publish templates")
      local template_key = msg.Tags['Template-Key']
      local publish_path = msg.Tags['Publish-Path']
      assert(template_key, "Template-Key tag is required, got: " .. tostring(template_key))
      assert(publish_path, "Publish-Path tag is required, got: " .. tostring(publish_path))
      local statePath = msg.Tags["State-Path"] or msg.Tags["state-path"]
      local data = {}
      if statePath then
        local resolved = _resolve_path(statePath)
        if type(resolved) == "table" then
          data = function() return _resolve_path(statePath) end
        elseif type(resolved) == "function" then
          data = resolved
        end
      elseif msg.Data and msg.Data ~= "" then
        local ok, parsed = pcall(json.decode, msg.Data)
        if ok and type(parsed) == "table" then
          data = parsed
        end
      end
      local ok, result = pcall(hyperengine.publishTemplate, template_key, publish_path, data, nil, statePath)
      if ok then
        hyperengine.sync()
        Send({ Target = msg.From, Action = 'Hyperengine-Publish-Template-Response', Data = 'OK' })
      else
        Send({ Target = msg.From, Action = 'Hyperengine-Publish-Template-Response', Data = "", Error = tostring(result) })
      end
    end
  )

  Handlers.add("Hyperengine-Unpublish-Template",
    Handlers.utils.hasMatchingTag("Action", "Hyperengine-Unpublish-Template"),
    function(msg)
      assert(hyperengine.has_permission(msg.From, "Hyperengine-Unpublish-Template"), "not authorized to unpublish templates")
      local path = msg.Tags.Path or msg.Tags.path
      assert(path, "Path tag is required, got: " .. tostring(path))
      hyperengine.unpublishTemplate(path)
      hyperengine.sync()
      Send({ Target = msg.From, Action = 'Hyperengine-Unpublish-Template-Response', Data = 'OK' })
    end
  )

  Handlers.add("Hyperengine-List-Published",
    Handlers.utils.hasMatchingTag("Action", "Hyperengine-List-Published"),
    function(msg)
      local published = hyperengine.listPublished()
      Send({ Target = msg.From, Action = 'Hyperengine-List-Published-Response', Data = json.encode(published) })
    end
  )
end

if not hyperengine_initialized then
  hyperengine.sync()
  hyperengine_initialized = true
end

return hyperengine
