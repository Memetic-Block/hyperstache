#!/usr/bin/env node

import { Command } from 'commander'
import { resolve } from 'node:path'
import { readFile } from 'node:fs/promises'
import { loadConfig } from './config.js'
import { bundle } from './bundler/index.js'
import { writeRockspec } from './rockspec.js'
import { createProject, printNextSteps } from './create.js'
import type { CreateFlags } from './create.js'

const pkg = JSON.parse(
  await readFile(new URL('../package.json', import.meta.url), 'utf-8'),
)

const program = new Command()

program
  .name('hyperstache')
  .description('AO Lua process bundler with Mustache templates and Luarocks')
  .version(pkg.version)

program
  .command('build')
  .description('Bundle AO Lua processes')
  .option('-r, --root <dir>', 'Project root directory', '.')
  .option('-p, --process <name>', 'Bundle only the named process')
  .action(async (opts) => {
    const root = resolve(opts.root)
    const config = await loadConfig(root)

    if (opts.process) {
      const proc = config.processes.find(p => p.name === opts.process)
      if (!proc) {
        const names = config.processes.map(p => p.name).join(', ')
        console.error(`Unknown process "${opts.process}". Available: ${names}`)
        process.exit(1)
      }
      const { bundleProcess } = await import('./bundler/index.js')
      const result = await bundleProcess(proc, config.aos)
      const viteNote = result.viteProcessed ? ' (Vite processed)' : ''
      const runtimeNote = result.runtimeIncluded ? ' +runtime' : ''
      const aosNote = result.aosModule ? ' +aos module' : ''
      const moduleNote = result.type === 'module' ? ' +module' : ''
      console.log(`[${result.processName}] Bundled ${result.moduleCount} modules, ${result.templateCount} templates${viteNote}${runtimeNote}${aosNote}${moduleNote}`)
      console.log(`[${result.processName}] Output: ${result.outPath}`)
      if (result.aosCopiedFiles.length > 0) {
        console.log(`[${result.processName}] aos files: ${result.aosCopiedFiles.join(', ')}`)
      }
      if (result.unresolved.length > 0) {
        console.warn(`[${result.processName}] Unresolved modules: ${result.unresolved.join(', ')}`)
      }
    } else {
      const results = await bundle(config)
      for (const result of results) {
        const viteNote = result.viteProcessed ? ' (Vite processed)' : ''
        const runtimeNote = result.runtimeIncluded ? ' +runtime' : ''
        const aosNote = result.aosModule ? ' +aos module' : ''
        const moduleNote = result.type === 'module' ? ' +module' : ''
        console.log(`[${result.processName}] Bundled ${result.moduleCount} modules, ${result.templateCount} templates${viteNote}${runtimeNote}${aosNote}${moduleNote}`)
        console.log(`[${result.processName}] Output: ${result.outPath}`)
        if (result.aosCopiedFiles.length > 0) {
          console.log(`[${result.processName}] aos files: ${result.aosCopiedFiles.join(', ')}`)
        }
        if (result.unresolved.length > 0) {
          console.warn(`[${result.processName}] Unresolved modules: ${result.unresolved.join(', ')}`)
        }
      }
    }
  })

program
  .command('dev')
  .description('Start Vite dev server with hyperstache plugin')
  .option('-r, --root <dir>', 'Project root directory', '.')
  .option('-p, --process <name>', 'Watch/bundle only the named process')
  .action(async (opts) => {
    const root = resolve(opts.root)
    const { createServer } = await import('vite')
    const { hyperstache } = await import('./vite-plugin.js')
    const config = await loadConfig(root)

    const server = await createServer({
      root,
      plugins: [hyperstache({ ...config, filterProcess: opts.process })],
    })

    await server.listen()
    server.printUrls()
  })

program
  .command('rockspec')
  .description('Generate a .rockspec file from config')
  .option('-r, --root <dir>', 'Project root directory', '.')
  .option('-n, --name <name>', 'Package name')
  .option('-v, --ver <version>', 'Package version', '0.1.0')
  .action(async (opts) => {
    const root = resolve(opts.root)
    const config = await loadConfig(root)
    const filePath = await writeRockspec(config, opts.name, opts.ver)
    console.log(`Rockspec written to: ${filePath}`)
  })

program
  .command('create')
  .description('Create a new hyperstache project')
  .argument('[name]', 'Project name')
  .option('-T, --typescript', 'Include TypeScript support')
  .option('-e, --esm', 'Enable ESM mode for inlined scripts')
  .option('-a, --admin', 'Include admin interface for template & ACL management')
  .option('-d, --directory <dir>', 'Parent directory for the new project')
  .action(async (name: string | undefined, opts: { typescript?: boolean; esm?: boolean; admin?: boolean; directory?: string }) => {
    if (!name) {
      const { createInterface } = await import('node:readline/promises')
      const rl = createInterface({ input: process.stdin, output: process.stdout })
      name = (await rl.question('Project name: ')).trim()
      rl.close()
      if (!name) {
        console.error('Project name is required.')
        process.exit(1)
      }
    }

    const flags: CreateFlags = {
      typescript: opts.typescript,
      esm: opts.esm,
      admin: opts.admin,
    }
    const parentDir = opts.directory ? resolve(opts.directory) : process.cwd()
    try {
      const projectDir = await createProject(name, flags, parentDir)
      printNextSteps(name, projectDir)
    } catch (err: unknown) {
      console.error((err as Error).message)
      process.exit(1)
    }
  })

program.parse()
