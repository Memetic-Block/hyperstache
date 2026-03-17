local _bundled = require("templates")
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

local lustache = require("lustache")

local hyperstache = {}

function hyperstache.get(key)
  return hyperstache_templates[key]
end

function hyperstache.set(key, content)
  hyperstache_templates[key] = content
end

function hyperstache.remove(key)
  hyperstache_templates[key] = nil
end

function hyperstache.list()
  local keys = {}
  for k in pairs(hyperstache_templates) do
    keys[#keys + 1] = k
  end
  return keys
end

function hyperstache.render(key, data)
  local tmpl = hyperstache_templates[key]
  if not tmpl then
    error("template not found: " .. tostring(key))
  end
  return lustache:render(tmpl, data)
end

function hyperstache.sync()
  for k, v in pairs(_bundled) do
    hyperstache_templates[k] = v
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
end

function hyperstache.revoke(address, role)
  if not hyperstache_acl[address] then
    return
  end
  hyperstache_acl[address][role] = nil
  if next(hyperstache_acl[address]) == nil then
    hyperstache_acl[address] = nil
  end
end

function hyperstache.get_roles(address)
  if address then
    return hyperstache_acl[address] or {}
  end
  return hyperstache_acl
end

function hyperstache.handlers()
  Handlers.add("Hyperstache-Get",
    Handlers.utils.hasMatchingTag("Action", "Hyperstache-Get"),
    function(msg)
      local key = msg.Tags.Key or msg.Tags.key
      local tmpl = hyperstache.get(key)
      msg.reply({ Data = tmpl or "" })
    end
  )

  Handlers.add("Hyperstache-List",
    Handlers.utils.hasMatchingTag("Action", "Hyperstache-List"),
    function(msg)
      local keys = hyperstache.list()
      msg.reply({ Data = table.concat(keys, "\n") })
    end
  )

  Handlers.add("Hyperstache-Render",
    Handlers.utils.hasMatchingTag("Action", "Hyperstache-Render"),
    function(msg)
      local key = msg.Tags.Key or msg.Tags.key
      local ok, result = pcall(hyperstache.render, key, msg.Data or {})
      if ok then
        msg.reply({ Data = result })
      else
        msg.reply({ Data = "", Error = result })
      end
    end
  )

  Handlers.add("Hyperstache-Set",
    Handlers.utils.hasMatchingTag("Action", "Hyperstache-Set"),
    function(msg)
      assert(hyperstache.has_permission(msg.From, "Hyperstache-Set"), "not authorized to set templates")
      local key = msg.Tags.Key or msg.Tags.key
      hyperstache.set(key, msg.Data)
      msg.reply({ Data = "ok" })
    end
  )

  Handlers.add("Hyperstache-Remove",
    Handlers.utils.hasMatchingTag("Action", "Hyperstache-Remove"),
    function(msg)
      assert(hyperstache.has_permission(msg.From, "Hyperstache-Remove"), "not authorized to remove templates")
      local key = msg.Tags.Key or msg.Tags.key
      hyperstache.remove(key)
      msg.reply({ Data = "ok" })
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
      msg.reply({ Data = "ok" })
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
      msg.reply({ Data = "ok" })
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
        msg.reply({ Data = table.concat(keys, "\n") })
      else
        local lines = {}
        for addr, r in pairs(roles) do
          local keys = {}
          for k in pairs(r) do
            keys[#keys + 1] = k
          end
          lines[#lines + 1] = addr .. ":" .. table.concat(keys, ",")
        end
        msg.reply({ Data = table.concat(lines, "\n") })
      end
    end
  )
end

return hyperstache
