#!/usr/bin/env node

import { Command } from 'commander'
import { resolve } from 'node:path'
import { readFile } from 'node:fs/promises'
import { loadConfig } from './config.js'
import { bundle } from './bundler/index.js'
import { writeRockspec } from './rockspec.js'
import { createProject, printNextSteps } from './create.js'
import { loadWallet, publishProcess, mergeManifest, deployProcess, createLogger } from './deploy/index.js'
import type { CreateFlags } from './create.js'

const pkg = JSON.parse(
  await readFile(new URL('../package.json', import.meta.url), 'utf-8'),
)

const program = new Command()

program
  .name('hyperengine')
  .description('AO Lua process bundler with Mustache templates and optional Luarocks support')
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
      const aosNote = result.aosModule ? ' +aos module' : ''
      const moduleNote = result.type === 'module' ? ' +module' : ''
      console.log(`[${result.processName}] Bundled ${result.moduleCount} modules, ${result.templateCount} templates${viteNote}${aosNote}${moduleNote}`)
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
        const aosNote = result.aosModule ? ' +aos module' : ''
        const moduleNote = result.type === 'module' ? ' +module' : ''
        console.log(`[${result.processName}] Bundled ${result.moduleCount} modules, ${result.templateCount} templates${viteNote}${aosNote}${moduleNote}`)
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
  .description('Create a new hyperengine project')
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

program
  .command('publish')
  .description('Publish WASM or Lua modules to Arweave via Turbo')
  .option('-r, --root <dir>', 'Project root directory', '.')
  .option('-p, --process <name>', 'Publish only the named process')
  .option('-v, --verbose', 'Show detailed operation logs')
  .option('-D, --debug', 'Show all details including payloads')
  .action(async (opts) => {
    const root = resolve(opts.root)
    const logger = createLogger({ verbose: opts.verbose, debug: opts.debug })
    const config = await loadConfig(root)

    if (!config.deploy.wallet) {
      console.error('No wallet configured. Set WALLET_PATH env var or deploy.wallet in config.')
      process.exit(1)
    }

    logger.verbose(`Project root: ${root}`)
    logger.verbose(`Wallet path: ${config.deploy.wallet}`)

    const wallet = await loadWallet(config.deploy.wallet, root)

    const targets = opts.process
      ? config.processes.filter(p => p.name === opts.process)
      : config.processes

    if (opts.process && targets.length === 0) {
      const names = config.processes.map(p => p.name).join(', ')
      console.error(`Unknown process "${opts.process}". Available: ${names}`)
      process.exit(1)
    }

    logger.verbose(`Target processes: ${targets.map(p => p.name).join(', ')}`)

    const updates: Record<string, { moduleId: string }> = {}
    for (const proc of targets) {
      try {
        const result = await publishProcess(proc, config.deploy, wallet, logger)
        console.log(`[${result.processName}] Published ${result.type} module: ${result.transactionId}`)
        updates[result.processName] = { moduleId: result.transactionId }
      } catch (err: unknown) {
        console.error(`[${proc.name}] ${(err as Error).message}`)
        process.exit(1)
      }
    }

    await mergeManifest(root, updates)
    console.log('Deploy manifest updated.')
  })

program
  .command('deploy')
  .description('Spawn AO processes and load bundled Lua code')
  .option('-r, --root <dir>', 'Project root directory', '.')
  .option('-p, --process <name>', 'Deploy only the named process')
  .option('-v, --verbose', 'Show detailed operation logs')
  .option('-D, --debug', 'Show all details including payloads')
  .action(async (opts) => {
    const root = resolve(opts.root)
    const logger = createLogger({ verbose: opts.verbose, debug: opts.debug })
    const config = await loadConfig(root)

    if (!config.deploy.wallet) {
      console.error('No wallet configured. Set WALLET_PATH env var or deploy.wallet in config.')
      process.exit(1)
    }

    logger.verbose(`Project root: ${root}`)
    logger.verbose(`Wallet path: ${config.deploy.wallet}`)

    const wallet = await loadWallet(config.deploy.wallet, root)

    // Filter to deployable processes (skip type: 'module' — those are publish-only)
    let targets = config.processes.filter(p => p.type !== 'module')

    if (opts.process) {
      targets = targets.filter(p => p.name === opts.process)
      if (targets.length === 0) {
        const deployable = config.processes.filter(p => p.type !== 'module').map(p => p.name)
        const moduleOnly = config.processes.filter(p => p.type === 'module').map(p => p.name)
        let msg = `Cannot deploy "${opts.process}".`
        if (moduleOnly.includes(opts.process)) {
          msg += ` Process "${opts.process}" is a dynamic read module (type: 'module'). Use \`publish\` instead.`
        } else {
          msg += ` Available: ${deployable.join(', ')}`
        }
        console.error(msg)
        process.exit(1)
      }
    }

    logger.verbose(`Target processes: ${targets.map(p => p.name).join(', ')}`)

    const updates: Record<string, { processId: string; moduleId: string }> = {}
    for (const proc of targets) {
      try {
        console.log(`[${proc.name}] Deploying process...`)
        console.log(`[${proc.name}] HyperBEAM URL: ${config.deploy.hyperbeamUrl}`)
        console.log(`[${proc.name}] Scheduler: ${config.deploy.scheduler}`)
        console.log(`[${proc.name}] Authority: ${config.deploy.authority}`)
        const result = await deployProcess(proc, config.deploy, wallet, root, logger)
        console.log(`[${result.processName}] Module: ${result.moduleId}`)
        console.log(`[${result.processName}] Spawned process: ${result.processId}`)
        console.log(
          `[${result.processName}] Link: ${config.deploy.hyperbeamUrl}/${result.processId}/now/serialize~json@1.0`
        )
        updates[result.processName] = {
          processId: result.processId,
          moduleId: result.moduleId,
        }
      } catch (err: unknown) {
        console.error(`[${proc.name}]`, err)
        process.exit(1)
      }
    }

    await mergeManifest(root, updates)
    console.log('Deploy manifest updated.')

    // NB: Known issue with @permaweb/aoconnect where it doesn't properly clear setInterval(), so we force exit
    process.exit(0)
  })

program
  .command('smoke')
  .description('Smoke-test ao WASM modules by loading them with aoloader')
  .argument('[name]', 'Smoke-test only the named process')
  .option('-r, --root <dir>', 'Project root directory', '.')
  .option('--all', 'Smoke-test all ao module processes (default when no name given)')
  .action(async (name: string | undefined, opts: { root: string; all?: boolean }) => {
    const root = resolve(opts.root)
    const config = await loadConfig(root)
    const { smokeProcess, smoke } = await import('./smoke.js')

    if (!config.aos.enabled) {
      console.error('aos is not enabled in config. Smoke testing requires aos WASM builds.')
      process.exit(1)
    }

    if (name) {
      const proc = config.processes.find(p => p.name === name)
      if (!proc) {
        const names = config.processes.map(p => p.name).join(', ')
        console.error(`Unknown process "${name}". Available: ${names}`)
        process.exit(1)
      }
      if (proc.type === 'module') {
        console.error(
          `Process "${name}" is a dynamic read module (type: 'module'). ` +
          `Smoke testing is only available for ao module processes.`,
        )
        process.exit(1)
      }
      const result = await smokeProcess(proc, config.aos)
      if (result.success) {
        const gas = result.gasUsed != null ? ` (gas: ${result.gasUsed})` : ''
        console.log(`[${result.processName}] Smoke OK${gas}`)
      } else {
        console.error(`[${result.processName}] FAIL: ${result.error}`)
        process.exit(1)
      }
    } else {
      const results = await smoke(config)
      if (results.length === 0) {
        console.error('No ao module processes found to smoke-test.')
        process.exit(1)
      }
      let failed = false
      for (const result of results) {
        if (result.success) {
          const gas = result.gasUsed != null ? ` (gas: ${result.gasUsed})` : ''
          console.log(`[${result.processName}] Smoke OK${gas}`)
        } else {
          console.error(`[${result.processName}] FAIL: ${result.error}`)
          failed = true
        }
      }
      if (failed) process.exit(1)
    }
  })

program.parse()
