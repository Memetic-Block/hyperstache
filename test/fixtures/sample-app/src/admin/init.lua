local hyperstache = require("hyperstache")
local templates = require("templates")

local admin = {}

local _path = "admin"

function admin.render()
  local html = templates["admin/index.html"]:gsub("__PROCESS_ID__", ao.id)
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
end

admin.handlers()

return admin
