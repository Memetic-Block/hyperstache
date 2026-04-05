import { defineConfig, DEFAULT_AOS_COMMIT } from '../../src/config.js'

export default defineConfig({
  processes: {
    main: { entry: 'src/process.lua' },
  },
  templates: {
    vite: true,
  },
  handlers: true,
  aos: {
    commit: DEFAULT_AOS_COMMIT,
  },
})
