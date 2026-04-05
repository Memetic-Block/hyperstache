local hyperengine = require('hyperengine')
require('admin')

hyperengine.publish({
  home = hyperengine.renderTemplate('index.html', { title = 'Hello', name = Owner })
})

Handlers.add('Info', Handlers.utils.hasMatchingTag('Action', 'Info'), function(msg)
  Send({
    Target = msg.From,
    Action = 'Info-Response',
    Data = 'Hello from ' .. Name
  })
end)
