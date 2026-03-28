import type { JWK } from './wallet.js'

export interface TurboClient {
  uploadFile: (opts: {
    fileStreamFactory: () => unknown
    fileSizeFactory: () => number
    dataItemOpts: { tags: Array<{ name: string; value: string }> }
  }) => Promise<{ id: string }>
}

export interface TurboSDK {
  TurboFactory: {
    authenticated: (opts: { privateKey: JWK }) => TurboClient
  }
}

/**
 * Dynamically import `@ardrive/turbo-sdk`.  Extracted into its own module
 * so tests can mock this single function without affecting publishProcess.
 */
export async function loadTurboSDK(): Promise<TurboSDK> {
  try {
    // Variable indirection prevents TypeScript from resolving the specifier during DTS emit
    const id = '@ardrive/turbo-sdk'
    return await (import(id) as Promise<unknown>) as TurboSDK
  } catch {
    throw new Error(
      '@ardrive/turbo-sdk is required for publishing but is not installed.\n\n' +
      '  npm install @ardrive/turbo-sdk\n\n' +
      'Then run the publish command again.',
    )
  }
}
