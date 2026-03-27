import { readFile, stat } from 'node:fs/promises'
import { join } from 'node:path'
import type { JWK } from './wallet.js'
import type { ResolvedProcessConfig, ResolvedDeployConfig } from '../config.js'
import { AOS_MODULE_ID, DEFAULT_SCHEDULER } from '../config.js'
import type { ProcessManifestEntry } from './manifest.js'
import { readManifest } from './manifest.js'
import { defaultLogger } from './logger.js'
import type { Logger } from './logger.js'

export interface DeployResult {
  processName: string
  processId: string
  moduleId: string
}

async function fileExists(path: string): Promise<boolean> {
  try {
    await stat(path)
    return true
  } catch {
    return false
  }
}

async function resolveHyperbeamAddress(deployConfig: ResolvedDeployConfig, logger: Logger): Promise<ResolvedDeployConfig> {
  if (!deployConfig.hyperbeamUrl) return deployConfig
  if (deployConfig.scheduler !== DEFAULT_SCHEDULER || deployConfig.authority !== DEFAULT_SCHEDULER) {
    logger.verbose(`Scheduler/authority already set, skipping HyperBEAM address fetch`)
    return deployConfig
  }

  const url = deployConfig.hyperbeamUrl.replace(/\/+$/, '') + '/~meta@1.0/info/address'
  logger.verbose(`Fetching HyperBEAM node address from ${url}`)
  const done = logger.time('HyperBEAM address fetch')
  const res = await fetch(url)
  if (!res.ok) {
    throw new Error(
      `Failed to fetch HyperBEAM node address from ${url} (HTTP ${res.status}).\n` +
      `Set deploy.scheduler and deploy.authority explicitly, or check your hyperbeamUrl.`,
    )
  }
  const address = (await res.text()).trim()
  done()
  if (!address) {
    throw new Error(`HyperBEAM node at ${url} returned an empty address.`)
  }
  logger.verbose(`Resolved HyperBEAM address: ${address} (HTTP ${res.status})`)
  return { ...deployConfig, scheduler: address, authority: address }
}

export async function deployProcess(
  proc: ResolvedProcessConfig,
  deployConfig: ResolvedDeployConfig,
  wallet: JWK,
  root: string,
  logger: Logger = defaultLogger,
): Promise<DeployResult> {
  const totalDone = logger.time('Deploy total')

  logger.verbose(`Deploying process "${proc.name}"`)
  logger.verbose(`Scheduler: ${deployConfig.scheduler}`)
  logger.verbose(`Authority: ${deployConfig.authority}`)
  if (deployConfig.hyperbeamUrl) logger.verbose(`HyperBEAM URL: ${deployConfig.hyperbeamUrl}`)
  if (deployConfig.spawnTags.length) logger.verbose(`Spawn tags: ${JSON.stringify(deployConfig.spawnTags)}`)
  if (deployConfig.actionTags.length) logger.verbose(`Action tags: ${JSON.stringify(deployConfig.actionTags)}`)

  deployConfig = await resolveHyperbeamAddress(deployConfig, logger)

  const { connect, createDataItemSigner } = await import('@permaweb/aoconnect')

  const signer = createDataItemSigner(wallet)
  const connectOpts = {
    MODE: 'mainnet' as const,
    signer,
    ...(deployConfig.hyperbeamUrl && {
      GATEWAY_URL: deployConfig.hyperbeamUrl,
      URL: deployConfig.hyperbeamUrl,
      SCHEDULER: deployConfig.scheduler
    }),
  }
  logger.debug(`aoconnect options: ${JSON.stringify(connectOpts, null, 2)}`)
  const ao = connect(connectOpts)

  // Determine if this is a WASM module build or a standard single-file deploy
  const wasmPath = join(proc.outDir, proc.name, 'process.wasm')
  const hasWasm = await fileExists(wasmPath)
  logger.verbose(`WASM check: ${wasmPath} — ${hasWasm ? 'found' : 'not found'}`)

  // Resolve the module ID for the spawn
  let moduleId: string
  if (hasWasm || proc.moduleId) {
    // WASM module build: use the published module ID
    logger.verbose(`Module resolution: WASM/custom module path`)
    moduleId = proc.moduleId
      ?? (await readManifest(root)).processes[proc.name]?.moduleId
      ?? ''
    if (!moduleId) {
      throw new Error(
        `No module ID found for "${proc.name}". ` +
        `Run \`hyperengine publish --process ${proc.name}\` first to upload the WASM module.`,
      )
    }
    logger.verbose(`Resolved moduleId: ${moduleId} (source: ${proc.moduleId ? 'config' : 'manifest'})`)
  } else {
    // Standard single-file process: use the default AOS module
    moduleId = AOS_MODULE_ID
    logger.verbose(`Module resolution: standard AOS module (${AOS_MODULE_ID})`)
  }

  // Spawn the process
  const spawnTags = [
    { name: 'Name', value: proc.name },
    { name: 'Authority', value: deployConfig.authority },
    ...deployConfig.spawnTags,
  ]

  const spawnOpts = {
    module: moduleId,
    authority: deployConfig.authority,
    scheduler: deployConfig.scheduler,
    signer,
    tags: spawnTags,
  }
  logger.verbose(`Spawning process with ${spawnTags.length} tags`)
  logger.debug(`Spawn options: ${JSON.stringify({ ...spawnOpts, signer: '[DataItemSigner]' }, null, 2)}`)

  const spawnDone = logger.time('Spawn')
  const processId = await ao.spawn(spawnOpts)
  spawnDone()
  logger.verbose(`Spawned processId: ${processId}`)

  // For single-file processes, Eval the bundled Lua
  if (!hasWasm && !proc.moduleId) {
    const luaPath = join(proc.outDir, proc.outFile)
    if (!(await fileExists(luaPath))) {
      throw new Error(
        `No build output found for "${proc.name}". Run \`hyperengine build\` first.\n` +
        `  Expected: ${luaPath}`,
      )
    }

    const luaSource = await readFile(luaPath, 'utf-8')
    logger.verbose(`Read Lua source: ${luaPath} (${luaSource.length} bytes)`)

    const evalTags = [
      { name: 'Action', value: 'Eval' },
      ...deployConfig.actionTags,
    ]

    const msgOpts = {
      process: processId,
      signer,
      tags: evalTags,
      data: luaSource,
    }
    logger.verbose(`Sending Eval message with ${evalTags.length} tags (${luaSource.length} bytes)`)
    logger.debug(`Eval options: ${JSON.stringify({ ...msgOpts, signer: '[DataItemSigner]', data: `[${luaSource.length} bytes]` }, null, 2)}`)

    const evalDone = logger.time('Eval')
    const msgId = await ao.message(msgOpts)
    logger.verbose(`Eval message sent: ${msgId}`)

    try {
      // Wait for the result to confirm the Eval succeeded
      const res = await ao.result({ process: processId, message: msgId })
      evalDone()
      logger.debug(`Eval result: ${JSON.stringify(res)}`)
      if (res.Error) {
        throw new Error(
          `Eval failed for "${proc.name}" (process: ${processId}):\n${res.Error}`,
        )
      }
      logger.verbose(`Eval succeeded`)
    } catch (err) {
      if (err instanceof Error && err.message.includes('HTTP request failed')) {
        console.warn(
          `Got error with 'HTTP request failed', but there is a known issue with patching HTML ` +
          `sending invalid Headers in response, so the process may have deployed.`
        )
      } else {
        throw err
      }
    }

  }

  totalDone()
  return { processName: proc.name, processId, moduleId }
}
