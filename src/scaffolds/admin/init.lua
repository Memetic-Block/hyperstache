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
  Send({ device = 'patch@1.0', [_path] = hyperstache_admin })
end

function admin.handlers()
  admin.render()
  admin.publish()

  Handlers.append('Hyperstache-Grant-Role', 'Hyperstache-Grant-Role', function(msg)
    if hyperstache.has_permission(msg.From, 'admin') then
      admin.publish()
    end
  end)

  Handlers.append('Hyperstache-Revoke-Role', 'Hyperstache-Revoke-Role', function(msg)
    if hyperstache.has_permission(msg.From, 'admin') then
      admin.publish()
    end
  end)
end

return admin
