export interface RateLimitState {
  endpoint: string;
  retryAfterMs: number;
  consecutive429s: number;
  updatedAt: number;
}

export interface AdaptiveRateLimiterOptions {
  /** Initial delay between requests to an endpoint. */
  initialDelayMs?: number;
  /** Maximum delay imposed by server feedback. */
  maxDelayMs?: number;
  /** Optional clock for deterministic tests. */
  now?: () => number;
}

export interface RateLimitedResponse {
  status: number;
  headers?: { get(name: string): string | null };
}

const DEFAULT_INITIAL_DELAY_MS = 0;
const DEFAULT_MAX_DELAY_MS = 5 * 60 * 1000;

/**
 * Adaptive client-side throttling for Horizon and Soroban RPC endpoints.
 * A 429 response updates only the endpoint that produced it; unrelated
 * endpoints continue at their own pace.
 */
export class AdaptiveRateLimiter {
  private readonly states = new Map<string, RateLimitState>();
  private readonly initialDelayMs: number;
  private readonly maxDelayMs: number;
  private readonly now: () => number;
  private readonly nextAllowedAt = new Map<string, number>();

  constructor(options: AdaptiveRateLimiterOptions = {}) {
    this.initialDelayMs = Math.max(0, options.initialDelayMs ?? DEFAULT_INITIAL_DELAY_MS);
    this.maxDelayMs = Math.max(this.initialDelayMs, options.maxDelayMs ?? DEFAULT_MAX_DELAY_MS);
    this.now = options.now ?? Date.now;
  }

  /** Return the current server-imposed delay for an endpoint. */
  getDelay(endpoint: string): number {
    const state = this.states.get(endpoint);
    const serverDelay = state?.retryAfterMs ?? this.initialDelayMs;
    return Math.max(0, Math.max(serverDelay, (this.nextAllowedAt.get(endpoint) ?? 0) - this.now()));
  }

  /** Wait until a request to the endpoint is allowed. */
  async acquire(endpoint: string): Promise<void> {
    const delay = this.getDelay(endpoint);
    if (delay > 0) await new Promise<void>((resolve) => setTimeout(resolve, delay));
    this.nextAllowedAt.set(endpoint, this.now() + this.initialDelayMs);
  }

  /** Record response feedback, including Retry-After on a 429 response. */
  recordResponse(endpoint: string, response: RateLimitedResponse): void {
    if (response.status !== 429) {
      this.states.delete(endpoint);
      return;
    }
    const previous = this.states.get(endpoint);
    const retryAfterMs = Math.min(
      this.maxDelayMs,
      parseRetryAfter(response.headers?.get("Retry-After"), this.now()) ??
        Math.min(this.maxDelayMs, Math.max(1000, (previous?.retryAfterMs ?? 1000) * 2)),
    );
    this.states.set(endpoint, {
      endpoint,
      retryAfterMs,
      consecutive429s: (previous?.consecutive429s ?? 0) + 1,
      updatedAt: this.now(),
    });
    this.nextAllowedAt.set(endpoint, this.now() + retryAfterMs);
  }

  getState(endpoint: string): RateLimitState | undefined {
    const state = this.states.get(endpoint);
    return state ? { ...state } : undefined;
  }

  reset(endpoint?: string): void {
    if (endpoint === undefined) {
      this.states.clear();
      this.nextAllowedAt.clear();
    } else {
      this.states.delete(endpoint);
      this.nextAllowedAt.delete(endpoint);
    }
  }

  /** Execute a request with endpoint-specific throttling and feedback handling. */
  async fetch<T extends RateLimitedResponse>(
    endpoint: string,
    request: () => Promise<T>,
  ): Promise<T> {
    await this.acquire(endpoint);
    const response = await request();
    this.recordResponse(endpoint, response);
    return response;
  }
}

export function parseRetryAfter(value: string | null | undefined, now = Date.now()): number | undefined {
  if (!value) return undefined;
  const seconds = Number(value.trim());
  if (Number.isFinite(seconds) && seconds >= 0) return Math.round(seconds * 1000);
  const date = Date.parse(value);
  if (!Number.isNaN(date)) return Math.max(0, date - now);
  return undefined;
}

export const adaptiveRateLimiter = new AdaptiveRateLimiter();
export default AdaptiveRateLimiter;
