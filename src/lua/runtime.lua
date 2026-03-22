local _bundled = require("templates")
local _patch_key = "ui"
local _state_key = "hyperstache_state"

if not hyperstache_templates then
  hyperstache_templates = {}
end
for k, v in pairs(_bundled) do
  if hyperstache_templates[k] == nil then
    hyperstache_templates[k] = v
  end
end

if not hyperstache_acl then
  hyperstache_acl = {}
end

if not hyperstache_patches then
  hyperstache_patches = {}
end

if not hyperstache_published then
  hyperstache_published = {}
end

local lustache = require("lustache")

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

local function _depends_on(template_key, changed_key, seen)
  if not seen then seen = {} end
  if seen[template_key] then return false end
  seen[template_key] = true
  local content = hyperstache_templates[template_key]
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

local function _auto_rerender(changed_key)
  local any_changed = false
  for patchPath, reg in pairs(hyperstache_published) do
    if reg.key == changed_key or _depends_on(reg.key, changed_key) then
      local data = reg.data
      if type(reg.dataFn) == "function" then
        local ok, result = pcall(reg.dataFn)
        if ok then data = result end
      end
      local ok, html = pcall(lustache.render, lustache, hyperstache_templates[reg.key] or "", data or {}, hyperstache_templates)
      if ok then
        hyperstache_patches[patchPath] = html
        any_changed = true
      end
    end
  end
  if any_changed then
    Send({ device = "patch@1.0", [_patch_key] = hyperstache_patches })
  end
end

local hyperstache = {}
function hyperstache._sync_state()
  local state = {
    template_keys = ''
  }
  for template_key, _ in pairs(hyperstache_templates) do
    if state.template_keys ~= '' then
      state.template_keys = state.template_keys .. ','
    end
    state.template_keys = state.template_keys .. template_key
  end
  for address, roles in pairs(hyperstache_acl) do
    local role_list = ''
    for role, _ in pairs(roles) do
      if role_list ~= '' then
        role_list = role_list .. ','
      end
      role_list = role_list .. role
    end
    state['acl_'..address] = role_list
  end
  Send({
    device = "patch@1.0",
    [_state_key] = state,
    hyperstache_templates = hyperstache_templates
  })
end

hyperstache._sync_state()

function hyperstache.get(key)
  return hyperstache_templates[key]
end

function hyperstache.set(key, content)
  hyperstache_templates[key] = content
  hyperstache._sync_state()
  _auto_rerender(key)
end

function hyperstache.remove(key)
  hyperstache_templates[key] = nil
  for patchPath, reg in pairs(hyperstache_published) do
    if reg.key == key then
      hyperstache_published[patchPath] = nil
      hyperstache_patches[patchPath] = nil
    end
  end
  hyperstache._sync_state()
  _auto_rerender(key)
end

function hyperstache.list()
  local keys = {}
  for k in pairs(hyperstache_templates) do
    keys[#keys + 1] = k
  end
  return keys
end

function hyperstache.renderTemplate(key, data, partials)
  local tmpl = hyperstache_templates[key]
  if not tmpl then
    error("template not found: " .. tostring(key))
  end
  local merged = {}
  for k, v in pairs(hyperstache_templates) do
    merged[k] = v
  end
  if partials then
    for k, v in pairs(partials) do
      merged[k] = v
    end
  end
  return lustache:render(tmpl, data, merged)
end

function hyperstache.render(template, data, partials)
  if type(template) ~= "string" then
    error("expected string template, got " .. type(template))
  end
  local merged = {}
  for k, v in pairs(hyperstache_templates) do
    merged[k] = v
  end
  if partials then
    for k, v in pairs(partials) do
      merged[k] = v
    end
  end
  return lustache:render(template, data, merged)
end

function hyperstache.sync()
  for k, v in pairs(_bundled) do
    hyperstache_templates[k] = v
  end
  hyperstache._sync_state()
  local any_changed = false
  for patchPath, reg in pairs(hyperstache_published) do
    local data = reg.data
    if type(reg.dataFn) == "function" then
      local ok, result = pcall(reg.dataFn)
      if ok then data = result end
    end
    local ok, html = pcall(lustache.render, lustache, hyperstache_templates[reg.key] or "", data or {}, hyperstache_templates)
    if ok then
      hyperstache_patches[patchPath] = html
      any_changed = true
    end
  end
  if any_changed then
    Send({ device = "patch@1.0", [_patch_key] = hyperstache_patches })
  end
end

function hyperstache.has_permission(address, action)
  if address == Owner then
    return true
  end
  local roles = hyperstache_acl[address]
  if not roles then
    return false
  end
  if roles["admin"] then
    return true
  end
  return roles[action] == true
end

function hyperstache.grant(address, role)
  if not hyperstache_acl[address] then
    hyperstache_acl[address] = {}
  end
  hyperstache_acl[address][role] = true
  hyperstache._sync_state()
end

function hyperstache.revoke(address, role)
  if not hyperstache_acl[address] then
    return
  end
  hyperstache_acl[address][role] = nil
  hyperstache._sync_state()
end

function hyperstache.get_roles(address)
  if address then
    return hyperstache_acl[address] or {}
  end
  return hyperstache_acl
end

function hyperstache.publishTemplate(key, patchPath, data, partials)
  local dataFn = nil
  local renderData = data
  if type(data) == "function" then
    dataFn = data
    renderData = data()
  end
  local html = hyperstache.renderTemplate(key, renderData or {}, partials)
  hyperstache_published[patchPath] = {
    key = key,
    data = (type(data) ~= "function") and data or nil,
    dataFn = dataFn,
    partials = partials
  }
  hyperstache_patches[patchPath] = html
  Send({ device = "patch@1.0", [_patch_key] = hyperstache_patches })
  return html
end

function hyperstache.unpublishTemplate(patchPath)
  hyperstache_published[patchPath] = nil
  hyperstache_patches[patchPath] = nil
  Send({ device = "patch@1.0", [_patch_key] = hyperstache_patches })
end

function hyperstache.patch(patches)
  for k, v in pairs(patches) do
    hyperstache_patches[k] = v
  end
end

function hyperstache.publish(patches)
  if patches then
    for k, v in pairs(patches) do
      hyperstache_patches[k] = v
    end
  end
  Send({ device = "patch@1.0", [_patch_key] = hyperstache_patches })
end

function hyperstache.handlers()
  Handlers.add("Hyperstache-Get",
    Handlers.utils.hasMatchingTag("Action", "Hyperstache-Get"),
    function(msg)
      local key = msg.Tags.Key or msg.Tags.key
      local tmpl = hyperstache.get(key)
      Send({ Target = msg.From, Action = 'Hyperstache-Get-Response', Data = tmpl or "" })
    end
  )

  Handlers.add("Hyperstache-List",
    Handlers.utils.hasMatchingTag("Action", "Hyperstache-List"),
    function(msg)
      local keys = hyperstache.list()
      Send({ Target = msg.From, Action = 'Hyperstache-List-Response', Data = table.concat(keys, "\n") })
    end
  )

  Handlers.add("Hyperstache-RenderTemplate",
    Handlers.utils.hasMatchingTag("Action", "Hyperstache-RenderTemplate"),
    function(msg)
      local key = msg.Tags.Key or msg.Tags.key
      local ok, parsed = pcall(json.decode, msg.Data or "{}")
      if not ok then
        Send({ Target = msg.From, Action = 'Hyperstache-RenderTemplate-Response', Data = "", Error = "invalid JSON: " .. tostring(parsed) })
        return
      end
      local ok2, result = pcall(hyperstache.renderTemplate, key, parsed.data or {}, parsed.partials)
      if ok2 then
        Send({ Target = msg.From, Action = 'Hyperstache-RenderTemplate-Response', Data = result })
      else
        Send({ Target = msg.From, Action = 'Hyperstache-RenderTemplate-Response', Data = "", Error = result })
      end
    end
  )

  Handlers.add("Hyperstache-Render",
    Handlers.utils.hasMatchingTag("Action", "Hyperstache-Render"),
    function(msg)
      local ok, parsed = pcall(json.decode, msg.Data or "{}")
      if not ok then
        Send({ Target = msg.From, Action = 'Hyperstache-Render-Response', Data = "", Error = "invalid JSON: " .. tostring(parsed) })
        return
      end
      local tmpl = parsed.template or ""
      local ok2, result = pcall(hyperstache.render, tmpl, parsed.data or {}, parsed.partials)
      if ok2 then
        Send({ Target = msg.From, Action = 'Hyperstache-Render-Response', Data = result })
      else
        Send({ Target = msg.From, Action = 'Hyperstache-Render-Response', Data = "", Error = result })
      end
    end
  )

  Handlers.add("Hyperstache-Set",
    Handlers.utils.hasMatchingTag("Action", "Hyperstache-Set"),
    function(msg)
      assert(hyperstache.has_permission(msg.From, "Hyperstache-Set"), "not authorized to set templates")
      local key = msg.Tags.Key or msg.Tags.key
      hyperstache.set(key, msg.Data)
      Send({ Target = msg.From, Action = 'Hyperstache-Set-Response', Data = 'OK' })
    end
  )

  Handlers.add("Hyperstache-Remove",
    Handlers.utils.hasMatchingTag("Action", "Hyperstache-Remove"),
    function(msg)
      assert(hyperstache.has_permission(msg.From, "Hyperstache-Remove"), "not authorized to remove templates")
      local key = msg.Tags.Key or msg.Tags.key
      hyperstache.remove(key)
      Send({ Target = msg.From, Action = 'Hyperstache-Remove-Response', Data = 'OK' })
    end
  )

  Handlers.add("Hyperstache-Grant-Role",
    Handlers.utils.hasMatchingTag("Action", "Hyperstache-Grant-Role"),
    function(msg)
      assert(hyperstache.has_permission(msg.From, "admin"), "not authorized to manage roles")
      local address = msg.Tags.Address or msg.Tags.address
      local role = msg.Tags.Role or msg.Tags.role
      assert(address, "Address tag is required")
      assert(role, "Role tag is required")
      if msg.From ~= Owner then
        assert(role ~= "admin", "only the owner can grant admin role")
      end
      hyperstache.grant(address, role)
      Send({ Target = msg.From, Action = 'Hyperstache-Grant-Role-Response', Data = 'OK' })
    end
  )

  Handlers.add("Hyperstache-Revoke-Role",
    Handlers.utils.hasMatchingTag("Action", "Hyperstache-Revoke-Role"),
    function(msg)
      assert(hyperstache.has_permission(msg.From, "admin"), "not authorized to manage roles")
      local address = msg.Tags.Address or msg.Tags.address
      local role = msg.Tags.Role or msg.Tags.role
      assert(address, "Address tag is required")
      assert(role, "Role tag is required")
      if msg.From ~= Owner then
        assert(role ~= "admin", "only the owner can revoke admin role")
      end
      hyperstache.revoke(address, role)
      Send({ Target = msg.From, Action = 'Hyperstache-Revoke-Role-Response', Data = 'OK' })
    end
  )

  Handlers.add("Hyperstache-Get-Roles",
    Handlers.utils.hasMatchingTag("Action", "Hyperstache-Get-Roles"),
    function(msg)
      local address = msg.Tags.Address or msg.Tags.address
      local roles = hyperstache.get_roles(address)
      if address then
        local keys = {}
        for k in pairs(roles) do
          keys[#keys + 1] = k
        end
        Send({ Target = msg.From, Action = 'Hyperstache-Get-Roles-Response', Data = table.concat(keys, "\n") })
      else
        local lines = {}
        for addr, r in pairs(roles) do
          local keys = {}
          for k in pairs(r) do
            keys[#keys + 1] = k
          end
          lines[#lines + 1] = addr .. ":" .. table.concat(keys, ",")
        end
        Send({ Target = msg.From, Action = 'Hyperstache-Get-Roles-Response', Data = table.concat(lines, "\n") })
      end
    end
  )
end

return hyperstache
