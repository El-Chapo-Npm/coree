import { err, isErr, ok } from "../shared/response";
import type { RecoveryAttempt, SorokitResult } from "../shared/response";
import { isTransientError, toMessage } from "../shared/errors";

export interface EndpointFallbackConfig {
  /** Primary endpoint URL */
  primaryEndpoint: string;
  /** Configured fallback endpoint URLs */
  fallbackEndpoints?: string[];
  /** Maximum retry attempts per endpoint (default: 1) */
  maxAttemptsPerEndpoint?: number;
  /** Enable degraded execution mode for recoverable simulation failures */
  allowDegradedMode?: boolean;
}

export class EndpointFallbackManager {
  private _primaryEndpoint: string;
  private _fallbackEndpoints: string[];
  private _maxAttemptsPerEndpoint: number;
  private _allowDegradedMode: boolean;

  constructor(config: EndpointFallbackConfig) {
    this._primaryEndpoint = config.primaryEndpoint;
    this._fallbackEndpoints = config.fallbackEndpoints ?? [];
    this._maxAttemptsPerEndpoint = config.maxAttemptsPerEndpoint ?? 1;
    this._allowDegradedMode = config.allowDegradedMode ?? false;
  }

  get endpoints(): string[] {
    return [this._primaryEndpoint, ...this._fallbackEndpoints];
  }

  /**
   * Execute an async operation against the primary endpoint, automatically falling back
   * to eligible secondary endpoints if transient/network errors occur.
   */
  async execute<T>(
    operation: (endpoint: string) => Promise<SorokitResult<T>>,
  ): Promise<SorokitResult<T>> {
    const endpointsToTry = this.endpoints;
    const recoveryAttempts: RecoveryAttempt[] = [];
    let lastCause: unknown = undefined;
    const visitedEndpoints = new Set<string>();

    for (const endpoint of endpointsToTry) {
      if (visitedEndpoints.has(endpoint)) continue;
      visitedEndpoints.add(endpoint);

      for (let attempt = 0; attempt < this._maxAttemptsPerEndpoint; attempt++) {
        try {
          const result = await operation(endpoint);

          if (!isErr(result)) {
            return result;
          }

          lastCause = result.error.cause ?? result.error;
          const isEligibleForFallback =
            isTransientError(result.error.cause) ||
            isTransientError(result.error) ||
            result.error.message.includes("Circuit breaker OPEN") ||
            result.error.code === "NETWORK_ERROR" ||
            result.error.code === "SERVICE_UNAVAILABLE";

          recoveryAttempts.push({
            endpoint,
            error: result.error.message,
            timestamp: Date.now(),
          });

          // If error is not transient/eligible or no more fallback endpoints remain, exit inner loop
          if (!isEligibleForFallback) {
            if (this._allowDegradedMode) {
              return {
                ...result,
                error: {
                  ...result.error,
                  recoveryAttempts,
                  degradedMode: true,
                },
              };
            }
            return {
              ...result,
              error: {
                ...result.error,
                recoveryAttempts,
                cause: result.error.cause ?? lastCause,
              },
            };
          }
        } catch (cause) {
          lastCause = cause;
          recoveryAttempts.push({
            endpoint,
            error: toMessage(cause),
            timestamp: Date.now(),
          });
        }
      }
    }

    // Exhausted all recovery attempts
    const lastAttempt = recoveryAttempts[recoveryAttempts.length - 1];
    const finalErrorMessage = lastAttempt
      ? `Network operation failed across all endpoints (${visitedEndpoints.size} tried). Last error: ${lastAttempt.error}`
      : "Network operation failed with no available endpoints.";

    const errorResult = err<T>(
      "NETWORK_ERROR" as any,
      finalErrorMessage,
      lastCause,
    );

    return {
      ...errorResult,
      error: {
        ...errorResult.error,
        recoveryAttempts,
        degradedMode: this._allowDegradedMode,
      },
    };
  }
}
