import { readFile, stat } from 'node:fs/promises'
import { join } from 'node:path'
import type { JWK } from './wallet.js'
import type { ResolvedProcessConfig, ResolvedDeployConfig } from '../config.js'
import { defaultLogger } from './logger.js'
import type { Logger } from './logger.js'

export interface PublishResult {
  processName: string
  transactionId: string
  type: 'wasm' | 'lua'
}

async function fileExists(path: string): Promise<boolean> {
  try {
    await stat(path)
    return true
  } catch {
    return false
  }
}

export async function publishProcess(
  proc: ResolvedProcessConfig,
  deployConfig: ResolvedDeployConfig,
  wallet: JWK,
  logger: Logger = defaultLogger,
): Promise<PublishResult> {
  const totalDone = logger.time('Publish total')
  logger.verbose(`Publishing process "${proc.name}"`)

  const { TurboFactory } = await import('@ardrive/turbo-sdk')
  const turbo = TurboFactory.authenticated({ privateKey: wallet })

  // Check for WASM build artifact first
  const wasmPath = join(proc.outDir, proc.name, 'process.wasm')
  logger.verbose(`Checking for WASM artifact: ${wasmPath}`)
  if (await fileExists(wasmPath)) {
    const data = await readFile(wasmPath)
    logger.verbose(`Found WASM artifact (${data.byteLength} bytes)`)
    const tags = [
      { name: 'Content-Type', value: 'application/wasm' },
      { name: 'Type', value: 'Module' },
      ...deployConfig.spawnTags,
    ]
    logger.debug(`Upload tags: ${JSON.stringify(tags, null, 2)}`)

    logger.verbose(`Uploading WASM module via Turbo...`)
    const uploadDone = logger.time('WASM upload')
    const response = await turbo.uploadFile({
      fileStreamFactory: () => data as unknown as ReadableStream,
      fileSizeFactory: () => data.byteLength,
      dataItemOpts: { tags },
    })
    uploadDone()
    logger.verbose(`Upload complete: ${response.id}`)
    logger.debug(`Turbo response: ${JSON.stringify(response)}`)

    totalDone()
    return {
      processName: proc.name,
      transactionId: response.id,
      type: 'wasm',
    }
  }

  // Fall back to Lua file upload (dynamic read modules)
  const luaPath = join(proc.outDir, proc.outFile)
  logger.verbose(`Checking for Lua artifact: ${luaPath}`)
  if (!(await fileExists(luaPath))) {
    throw new Error(
      `No build artifact found for "${proc.name}". Run \`hyperengine build\` first.\n` +
      `  Looked for: ${wasmPath}\n` +
      `  Looked for: ${luaPath}`,
    )
  }

  const data = await readFile(luaPath)
  logger.verbose(`Found Lua artifact (${data.byteLength} bytes)`)
  const tags = [
    { name: 'Content-Type', value: 'text/x-lua' },
    { name: 'Type', value: 'Module' },
    ...deployConfig.spawnTags,
  ]
  logger.debug(`Upload tags: ${JSON.stringify(tags, null, 2)}`)

  logger.verbose(`Uploading Lua module via Turbo...`)
  const uploadDone = logger.time('Lua upload')
  const response = await turbo.uploadFile({
    fileStreamFactory: () => data as unknown as ReadableStream,
    fileSizeFactory: () => data.byteLength,
    dataItemOpts: { tags },
  })
  uploadDone()
  logger.verbose(`Upload complete: ${response.id}`)
  logger.debug(`Turbo response: ${JSON.stringify(response)}`)

  totalDone()
  return {
    processName: proc.name,
    transactionId: response.id,
    type: 'lua',
  }
}
