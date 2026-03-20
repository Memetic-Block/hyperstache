import { readFile, stat } from 'node:fs/promises'
import { join } from 'node:path'
import type { JWK } from './wallet.js'
import type { ResolvedProcessConfig, ResolvedDeployConfig } from '../config.js'
import { AOS_MODULE_ID, DEFAULT_SCHEDULER } from '../config.js'
import type { ProcessManifestEntry } from './manifest.js'
import { readManifest } from './manifest.js'

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

async function resolveHyperbeamAddress(deployConfig: ResolvedDeployConfig): Promise<ResolvedDeployConfig> {
  if (!deployConfig.hyperbeamUrl) return deployConfig
  if (deployConfig.scheduler !== DEFAULT_SCHEDULER || deployConfig.authority !== DEFAULT_SCHEDULER) {
    return deployConfig
  }

  const url = deployConfig.hyperbeamUrl.replace(/\/+$/, '') + '/~meta@1.0/info/address'
  const res = await fetch(url)
  if (!res.ok) {
    throw new Error(
      `Failed to fetch HyperBEAM node address from ${url} (HTTP ${res.status}).\n` +
      `Set deploy.scheduler and deploy.authority explicitly, or check your hyperbeamUrl.`,
    )
  }
  const address = (await res.text()).trim()
  if (!address) {
    throw new Error(`HyperBEAM node at ${url} returned an empty address.`)
  }
  return { ...deployConfig, scheduler: address, authority: address }
}

export async function deployProcess(
  proc: ResolvedProcessConfig,
  deployConfig: ResolvedDeployConfig,
  wallet: JWK,
  root: string,
): Promise<DeployResult> {
  deployConfig = await resolveHyperbeamAddress(deployConfig)

  const { connect, createDataItemSigner } = await import('@permaweb/aoconnect')

  const ao = connect({
    MODE: 'mainnet' as const,
    ...(deployConfig.hyperbeamUrl && {
      GATEWAY_URL: deployConfig.hyperbeamUrl,
      URL: deployConfig.hyperbeamUrl,
      SCHEDULER: deployConfig.scheduler
    }),
  })
  const signer = createDataItemSigner(wallet)

  // Determine if this is a WASM module build or a standard single-file deploy
  const wasmPath = join(proc.outDir, proc.name, 'process.wasm')
  const hasWasm = await fileExists(wasmPath)

  // Resolve the module ID for the spawn
  let moduleId: string
  if (hasWasm || proc.moduleId) {
    // WASM module build: use the published module ID
    moduleId = proc.moduleId
      ?? (await readManifest(root)).processes[proc.name]?.moduleId
      ?? ''
    if (!moduleId) {
      throw new Error(
        `No module ID found for "${proc.name}". ` +
        `Run \`hyperstache publish --process ${proc.name}\` first to upload the WASM module.`,
      )
    }
  } else {
    // Standard single-file process: use the default AOS module
    moduleId = AOS_MODULE_ID
  }

  // Spawn the process
  const spawnTags = [
    { name: 'Name', value: proc.name },
    { name: 'Authority', value: deployConfig.authority },
    ...deployConfig.spawnTags,
  ]

  const processId = await ao.spawn({
    module: moduleId,
    scheduler: deployConfig.scheduler,
    signer,
    tags: spawnTags,
  })

  // For single-file processes, Eval the bundled Lua
  if (!hasWasm && !proc.moduleId) {
    const luaPath = join(proc.outDir, proc.outFile)
    if (!(await fileExists(luaPath))) {
      throw new Error(
        `No build output found for "${proc.name}". Run \`hyperstache build\` first.\n` +
        `  Expected: ${luaPath}`,
      )
    }

    const luaSource = await readFile(luaPath, 'utf-8')
    const evalTags = [
      { name: 'Action', value: 'Eval' },
      ...deployConfig.actionTags,
    ]

    const msgId = await ao.message({
      process: processId,
      signer,
      tags: evalTags,
      data: luaSource,
    })

    // Wait for the result to confirm the Eval succeeded
    const res = await ao.result({ process: processId, message: msgId })
    if (res.Error) {
      throw new Error(
        `Eval failed for "${proc.name}" (process: ${processId}):\n${res.Error}`,
      )
    }
  }

  return { processName: proc.name, processId, moduleId }
}
