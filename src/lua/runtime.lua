local _bundled = require("templates")
if not hyperstache_templates then
  hyperstache_templates = {}
end
for k, v in pairs(_bundled) do
  if hyperstache_templates[k] == nil then
    hyperstache_templates[k] = v
  end
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
      assert(msg.From == Owner, "only the owner can set templates")
      local key = msg.Tags.Key or msg.Tags.key
      hyperstache.set(key, msg.Data)
      msg.reply({ Data = "ok" })
    end
  )

  Handlers.add("Hyperstache-Remove",
    Handlers.utils.hasMatchingTag("Action", "Hyperstache-Remove"),
    function(msg)
      assert(msg.From == Owner, "only the owner can remove templates")
      local key = msg.Tags.Key or msg.Tags.key
      hyperstache.remove(key)
      msg.reply({ Data = "ok" })
    end
  )
end

return hyperstache
