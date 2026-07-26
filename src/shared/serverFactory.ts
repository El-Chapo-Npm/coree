/**
 * Centralized server factory with tracing support (#212).
 *
 * All module functions should use these helpers instead of directly
 * instantiating `Horizon.Server` or `SorobanRpc.Server`. The client
 * factory calls `setTracedFetch` once, and all subsequent server
 * instances automatically inject correlation headers.
 *
 * This avoids having to thread a `fetch` option through every function's
 * parameter list while still supporting custom fetch for tracing.
 */

import { Horizon } from "@stellar/stellar-sdk";
import { rpc as SorobanRpc } from "@stellar/stellar-sdk";

let tracedFetch: typeof globalThis.fetch | undefined;

/**
 * Set the fetch function to use for all server instances.
 * Called once during `createSorokitClient`.
 */
export function setTracedFetch(fetch: typeof globalThis.fetch): void {
  tracedFetch = fetch;
}

/**
 * Get the currently configured traced fetch, or undefined.
 */
export function getTracedFetch(): typeof globalThis.fetch | undefined {
  return tracedFetch;
}

/**
 * Create a Horizon.Server instance with optional tracing fetch.
 */
export function createHorizonServer(
  horizonUrl: string,
): Horizon.Server {
  return tracedFetch
    ? new Horizon.Server(horizonUrl, { fetch: tracedFetch })
    : new Horizon.Server(horizonUrl);
}

/**
 * Create a SorobanRpc.Server instance with optional tracing fetch.
 */
export function createSorobanServer(
  rpcUrl: string,
): SorobanRpc.Server {
  return tracedFetch
    ? new SorobanRpc.Server(rpcUrl, { fetch: tracedFetch })
    : new SorobanRpc.Server(rpcUrl);
}
