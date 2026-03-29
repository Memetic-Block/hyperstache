import { createRequire } from 'node:module'
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
 * Load `@ardrive/turbo-sdk` via CJS require.  The SDK's transitive dep
 * `ethers` re-exports a named binding from the CJS-only `ws` package,
 * which fails under Node ESM (`import()`).  Using `createRequire` avoids
 * that incompatibility.
 */
export async function loadTurboSDK(): Promise<TurboSDK> {
  try {
    const require = createRequire(import.meta.url)
    return require('@ardrive/turbo-sdk') as TurboSDK
  } catch (err) {
    console.error(err)
    throw new Error(
      '@ardrive/turbo-sdk is required for publishing but is not installed.\n\n' +
      '  npm install @ardrive/turbo-sdk\n\n' +
      'Then run the publish command again.',
    )
  }
}
