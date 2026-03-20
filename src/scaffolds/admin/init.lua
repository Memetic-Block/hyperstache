local hyperstache = require("hyperstache")

local admin = {}

local _path = "admin"

function admin.render()
  local html = hyperstache.get("admin/index.html"):gsub("__PROCESS_ID__", ao.id)
  hyperstache_admin = html
  return html
end

function admin.publish()
  if not hyperstache_admin then
    admin.render()
  end
  Send({ device = "patch@1.0", [_path] = hyperstache_admin })
end

function admin.handlers()
  admin.render()
  admin.publish()

  Handlers.append("Hyperstache-Admin-Sync-Set",
    Handlers.utils.hasMatchingTag("Action", "Hyperstache-Set"),
    function(msg)
      if hyperstache.has_permission(msg.From, "Hyperstache-Set") then
        admin.publish()
      end
    end
  )

  Handlers.append("Hyperstache-Admin-Sync-Remove",
    Handlers.utils.hasMatchingTag("Action", "Hyperstache-Remove"),
    function(msg)
      if hyperstache.has_permission(msg.From, "Hyperstache-Remove") then
        admin.publish()
      end
    end
  )

  Handlers.append("Hyperstache-Admin-Sync-Grant",
    Handlers.utils.hasMatchingTag("Action", "Hyperstache-Grant-Role"),
    function(msg)
      if hyperstache.has_permission(msg.From, "admin") then
        admin.publish()
      end
    end
  )

  Handlers.append("Hyperstache-Admin-Sync-Revoke",
    Handlers.utils.hasMatchingTag("Action", "Hyperstache-Revoke-Role"),
    function(msg)
      if hyperstache.has_permission(msg.From, "admin") then
        admin.publish()
      end
    end
  )
end

return admin
