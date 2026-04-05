import { defineConfig, DEFAULT_AOS_COMMIT } from '../../src/config.js'

export default defineConfig({
  processes: {
    main: { entry: 'src/process.lua' },
  },
  templates: {
    vite: {
      esm: true,
      external: [
        { name: '@permaweb/aoconnect', url: 'ar://g2XHqQZLuyssd0_DRMB-cx1BC-TUPTHI1n8nwfFKHM0' },
      ],
    },
  },
  handlers: true,
  adminInterface: {
    dir: '../../src/scaffolds/admin',
  },
  aos: {
    commit: DEFAULT_AOS_COMMIT,
  },
})
