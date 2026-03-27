local hyperengine = require('hyperengine')
local json = require('json')

local admin = {}

local _path = 'admin'

function admin.publish()
  local routes = {
    { path = 'index', title = 'Home' },
    { path = 'templates', title = 'Templates' },
    { path = 'publish', title = 'Publish' },
    { path = 'acl', title = 'Access Control' }
  }

  local dataFn = function(current_page) return function()
    local hyperengine_state = hyperengine.get_state()

    local hyperengine_acl = {}
    for address, roles in pairs(hyperengine_state.acl or {}) do
      local role_list = {}
      for role, _ in pairs(roles) do
        table.insert(role_list, role)
      end
      table.insert(hyperengine_acl, { address = address, roles = role_list })
    end

    return {
      ao_env = ao.env,
      hyperengine_state = hyperengine_state,
      hyperengine_acl = hyperengine_acl,
      current_page = current_page,
      navigation_links = routes,
      nav_css = function(self)
        return self.path == current_page and 'current-page' or ''
      end,
      ui_root = hyperengine_state.ui_root,

      -- JSON injection for lazy debugging
      ao_env_json = json.encode(ao.env),
      hyperengine_state_json = json.encode(hyperengine_state),
      hyperengine_acl_json = json.encode(hyperengine_acl),
    }
  end end

  for _, route in pairs(routes) do
    local ok, err = pcall(hyperengine.publishTemplate,
      'admin/template.html',
      _path .. '/' .. route.path,
      dataFn(route.path),
      {
        header = hyperengine.get('admin/partials/header.mu'),
        nav = hyperengine.get('admin/partials/nav.mu'),
        body = hyperengine.get('admin/pages/' .. route.path .. '.mu'),
        footer = hyperengine.get('admin/partials/footer.mu')
      }
    )
    assert(ok, 'Error publishing admin template: ' .. err)
  end
end

admin.publish()

return admin
