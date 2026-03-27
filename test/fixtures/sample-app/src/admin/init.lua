local hyperengine = require("hyperengine")
local templates = require("templates")

local admin = {}

local _path = "admin"

function admin.render()
  local html = templates["admin/index.html"]:gsub("__PROCESS_ID__", ao.id)
  hyperengine_admin = html
  return html
end

function admin.publish()
  if not hyperengine_admin then
    admin.render()
  end
  hyperengine.publish({ [_path] = hyperengine_admin })
end

function admin.handlers()
  admin.render()
  hyperengine.patch({ [_path] = hyperengine_admin })

  Handlers.append("Hyperengine-Admin-Sync-Set",
    Handlers.utils.hasMatchingTag("Action", "Hyperengine-Set"),
    function(msg)
      if hyperengine.has_permission(msg.From, "Hyperengine-Set") then
        admin.render()
        hyperengine.publish({ [_path] = hyperengine_admin })
      end
    end
  )
end

admin.handlers()

return admin
