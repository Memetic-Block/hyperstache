import { readFile, stat } from 'node:fs/promises'
import { join } from 'node:path'
import type { ResolvedProcessConfig, ResolvedConfig } from './config.js'

export interface SmokeResult {
  /** Process name from config */
  processName: string
  /** Whether the smoke test passed */
  success: boolean
  /** Error message if the smoke test failed */
  error?: string
  /** Gas used during the spawn message */
  gasUsed?: number
}

async function fileExists(path: string): Promise<boolean> {
  try {
    await stat(path)
    return true
  } catch {
    return false
  }
}

/**
 * Smoke-test a single ao module process by loading its compiled WASM
 * artifact with `@permaweb/aoloader` and verifying it initialises cleanly.
 */
export async function smokeProcess(
  proc: ResolvedProcessConfig,
  aos: ResolvedConfig['aos'],
): Promise<SmokeResult> {
  const wasmPath = join(proc.outDir, proc.name, 'process.wasm')

  if (!(await fileExists(wasmPath))) {
    return {
      processName: proc.name,
      success: false,
      error: `No WASM artifact found at ${wasmPath}. Run \`hyperengine build\` followed by \`ao build\` first.`,
    }
  }

  const wasmBinary = await readFile(wasmPath)

  let AoLoader: (wasm: Buffer | ArrayBuffer, options: Record<string, unknown>) => Promise<
    (memory: ArrayBuffer | null, msg: Record<string, unknown>, env: Record<string, unknown>) => Promise<{ Output?: unknown; Messages?: unknown[]; Error?: string; GasUsed?: number; Memory?: unknown }>
  >
  try {
    // ao-loader is a CJS module that exports the loader function directly
    const mod = await import('@permaweb/ao-loader')
    AoLoader = (mod.default ?? mod) as typeof AoLoader
  } catch {
    throw new Error(
      '@permaweb/ao-loader is required for smoke testing but could not be loaded.\n\n' +
      '  npm install @permaweb/ao-loader\n\n' +
      'Then run the smoke command again.',
    )
  }

  const options = {
    format: aos.module_format,
    inputEncoding: 'JSON-1' as const,
    outputEncoding: 'JSON-1' as const,
    memoryLimit: String(aos.maximum_memory),
    computeLimit: aos.compute_limit,
    extensions: [],
  }

  let handle: Awaited<ReturnType<typeof AoLoader>>
  try {
    handle = await AoLoader(wasmBinary, options)
  } catch (err: unknown) {
    return {
      processName: proc.name,
      success: false,
      error: `Failed to initialise WASM module: ${(err as Error).message}`,
    }
  }

  const env = {
    Process: {
      Id: 'SMOKE_TEST_PROCESS',
      Owner: 'SMOKE_TEST_OWNER',
      Tags: [
        { name: 'Name', value: proc.name },
        { name: 'Authority', value: 'SMOKE_TEST_AUTHORITY' },
      ],
    },
  }

  // Spawn: pass null as memory buffer to initialise a fresh process
  let result: { Output?: unknown; Messages?: unknown[]; Error?: string; GasUsed?: number; Memory?: unknown }
  try {
    result = await handle(null, {
      Owner: 'SMOKE_TEST_OWNER',
      Target: 'SMOKE_TEST_PROCESS',
      From: 'SMOKE_TEST_OWNER',
      Tags: [{ name: 'Action', value: 'Eval' }],
      Data: 'return "smoke"',
    }, env)
  } catch (err: unknown) {
    return {
      processName: proc.name,
      success: false,
      error: `WASM execution failed: ${(err as Error).message}`,
    }
  }

  if (result.Error) {
    return {
      processName: proc.name,
      success: false,
      error: result.Error,
      gasUsed: result.GasUsed,
    }
  }

  return {
    processName: proc.name,
    success: true,
    gasUsed: result.GasUsed,
  }
}

/**
 * Smoke-test all eligible ao module processes in parallel.
 * Eligible = `aos.enabled && proc.type !== 'module'`
 */
export async function smoke(config: ResolvedConfig): Promise<SmokeResult[]> {
  if (!config.aos.enabled) {
    return config.processes
      .filter(p => p.type !== 'module')
      .map(p => ({
        processName: p.name,
        success: false,
        error: 'aos is not enabled in config. Smoke testing requires aos WASM builds.',
      }))
  }

  const eligible = config.processes.filter(p => p.type !== 'module')
  return Promise.all(eligible.map(p => smokeProcess(p, config.aos)))
}
