import { defineConfig } from '../../../src/config.js'

export default defineConfig({
  processes: {
    main: { entry: 'src/process.lua' },
    worker: { entry: 'src/worker.lua', outFile: 'worker.lua' },
    reader: { entry: 'src/reader.lua', type: 'module' },
  },
})
