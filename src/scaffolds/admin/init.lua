local hyperstache = require('hyperstache')

local admin = {}

local _path = 'admin'

function admin.render()
  local html = hyperstache.renderTemplate(
    'admin/index.html',
    { process_id = ao.id, scheduler = require('json').encode(ao.env.Tags) }
  )
  hyperstache_admin = html
  return html
end

function admin.publish()
  if not hyperstache_admin then
    admin.render()
  end
  hyperstache.publish({ [_path] = hyperstache_admin })
end

function admin.handlers()
  admin.render()
  hyperstache.patch({ [_path] = hyperstache_admin })

  Handlers.append('Hyperstache-Grant-Role', 'Hyperstache-Grant-Role', function(msg)
    if hyperstache.has_permission(msg.From, 'admin') then
      admin.render()
      hyperstache.publish({ [_path] = hyperstache_admin })
    end
  end)

  Handlers.append('Hyperstache-Revoke-Role', 'Hyperstache-Revoke-Role', function(msg)
    if hyperstache.has_permission(msg.From, 'admin') then
      admin.render()
      hyperstache.publish({ [_path] = hyperstache_admin })
    end
  end)
end

admin.handlers()

return admin
