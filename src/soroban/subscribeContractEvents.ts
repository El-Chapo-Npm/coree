export interface ContractEvent {
  id?: string;
  contractId?: string;
  contract_id?: string;
  emitter?: string;
  eventType?: string;
  name?: string;
  topics?: Array<string | null | undefined>;
  topic?: Array<string | null | undefined>;
  timestamp?: string | number;
  ledger?: number;
  value?: unknown;
  [key: string]: unknown;
}

export interface ContractEventFilter {
  name?: string;
  eventType?: string;
  emitter?: string;
  topics?: Array<string | RegExp>;
  topicPatterns?: Array<string | RegExp>;
  contractId?: string;
  and?: ContractEventFilter[];
  or?: ContractEventFilter[];
}

export type EventFilterPredicate = (event: ContractEvent) => boolean;

export interface ContractEventSubscriptionOptions {
  horizonUrl: string;
  intervalMs?: number;
  fetch?: typeof fetch;
  limit?: number;
  /** Maximum age (ms) before a seen-event entry is evicted. Default: 1 hour. */
  deduplicationTtlMs?: number;
  /** Maximum number of entries in the seen-event deduplication set. Default: 10000. */
  deduplicationMaxSize?: number;
}

/** Default TTL for deduplication entries: 1 hour (3,600,000 ms). */
export const DEFAULT_DEDUPLICATION_TTL_MS = 60 * 60 * 1000;

/** Default maximum number of entries in the deduplication set. */
export const DEFAULT_DEDUPLICATION_MAX_SIZE = 10_000;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function readTimestamp(value: unknown): string | number | undefined {
  return typeof value === "string" || typeof value === "number" ? value : undefined;
}

function readEventRecord(raw: unknown): ContractEvent | null {
  if (!isRecord(raw)) return null;

  const topics = Array.isArray(raw.topics)
    ? raw.topics.filter((topic): topic is string => typeof topic === "string")
    : Array.isArray(raw.topic)
      ? raw.topic.filter((topic): topic is string => typeof topic === "string")
      : [];
  const timestamp = readTimestamp(raw.timestamp ?? raw.closed_at ?? raw.closedAt);

  return {
    ...(raw as Record<string, unknown>),
    id: String(raw.id ?? raw.event_id ?? raw.eventId ?? raw.paging_token ?? ""),
    contractId: String(raw.contractId ?? raw.contract_id ?? raw.contractID ?? ""),
    emitter: String(raw.emitter ?? raw.source_account ?? raw.sourceAccount ?? ""),
    eventType: String(raw.eventType ?? raw.event_type ?? raw.name ?? ""),
    name: String(raw.name ?? raw.event_type ?? raw.eventType ?? ""),
    topics,
    ...(timestamp !== undefined ? { timestamp } : {}),
    ...(typeof raw.ledger === "number" ? { ledger: raw.ledger } : {}),
  };
}

function readRecords(payload: unknown): ContractEvent[] {
  if (Array.isArray(payload)) return payload.map(readEventRecord).filter(Boolean) as ContractEvent[];

  if (!isRecord(payload)) return [];

  const embedded = payload._embedded;
  const records = Array.isArray(payload.records)
    ? payload.records
    : isRecord(embedded) && Array.isArray(embedded.records)
      ? embedded.records
      : [];

  return records.map(readEventRecord).filter(Boolean) as ContractEvent[];
}

function matchesTopicPattern(topic: string, pattern: string | RegExp): boolean {
  if (pattern instanceof RegExp) {
    pattern.lastIndex = 0;
    return pattern.test(topic);
  }
  return topic === pattern;
}

/**
 * Evict entries from the seen-event map that are older than `ttlMs` or that
 * exceed `maxSize` (FIFO removal when cap is reached).
 */
function evictSeenEvents(
  seen: Map<string, number>,
  ttlMs: number,
  maxSize: number,
): void {
  const now = Date.now();
  for (const [id, ts] of seen) {
    if (now - ts > ttlMs) {
      seen.delete(id);
    }
  }
  if (seen.size > maxSize) {
    // FIFO: delete oldest entries first
    const entries = [...seen.entries()].sort((a, b) => a[1] - b[1]);
    const excess = seen.size - maxSize;
    for (let i = 0; i < excess; i++) {
      const entry = entries[i];
      if (entry) {
        seen.delete(entry[0]);
      }
    }
  }
}

function matchesFilter(event: ContractEvent, filter?: ContractEventFilter): boolean {
  if (!filter) return true;

  if (filter.name || filter.eventType) {
    const eventName = typeof event.name === "string" ? event.name : "";
    const eventType = typeof event.eventType === "string" ? event.eventType : eventName;
    if (filter.name && eventName !== filter.name) return false;
    if (filter.eventType && eventType !== filter.eventType) return false;
  }

  if (filter.contractId) {
    const eventContractId = typeof event.contractId === "string" ? event.contractId : "";
    if (eventContractId !== filter.contractId) return false;
  }

  if (filter.emitter) {
    const eventEmitter = typeof event.emitter === "string" ? event.emitter : "";
    if (eventEmitter !== filter.emitter) return false;
  }

  const topicPatterns = filter.topics ?? filter.topicPatterns;
  if (topicPatterns?.length) {
    const topics = Array.isArray(event.topics) ? event.topics : [];
    const matchesTopic = topics.some((topic) =>
      topic != null && topicPatterns.some((pattern) => matchesTopicPattern(topic, pattern)),
    );
    if (!matchesTopic) return false;
  }

  if (filter.and && !filter.and.every((nestedFilter) => matchesFilter(event, nestedFilter))) {
    return false;
  }
  if (filter.or && filter.or.length > 0 && !filter.or.some((nestedFilter) => matchesFilter(event, nestedFilter))) {
    return false;
  }

  return true;
}

function matchesEventFilter(
  event: ContractEvent,
  filter?: ContractEventFilter | EventFilterPredicate,
): boolean {
  return typeof filter === "function" ? filter(event) : matchesFilter(event, filter);
}

export function filterContractEvents(
  events: readonly ContractEvent[],
  filter?: ContractEventFilter | EventFilterPredicate,
): ContractEvent[] {
  if (!filter) return events.slice();
  const predicate = typeof filter === "function" ? filter : (event: ContractEvent) => matchesFilter(event, filter);
  return events.filter(predicate);
}

export function andEventFilters(...filters: Array<ContractEventFilter | EventFilterPredicate>): EventFilterPredicate {
  return (event) => filters.every((filter) =>
    typeof filter === "function" ? filter(event) : matchesFilter(event, filter),
  );
}

export function orEventFilters(...filters: Array<ContractEventFilter | EventFilterPredicate>): EventFilterPredicate {
  return (event) => filters.some((filter) =>
    typeof filter === "function" ? filter(event) : matchesFilter(event, filter),
  );
}

function eventTimestamp(event: ContractEvent): number | undefined {
  if (typeof event.timestamp === "number") return event.timestamp;
  if (typeof event.timestamp === "string") {
    const parsed = Date.parse(event.timestamp);
    if (!Number.isNaN(parsed)) return parsed;
  }
  return undefined;
}

export function countByType(events: readonly ContractEvent[]): Record<string, number> {
  const counts: Record<string, number> = {};
  for (const event of events) {
    const type = typeof event.eventType === "string" && event.eventType
      ? event.eventType
      : typeof event.name === "string" ? event.name : "";
    counts[type] = (counts[type] ?? 0) + 1;
  }
  return counts;
}

export function groupByTime(
  events: readonly ContractEvent[],
  intervalMs: number,
): Map<number, ContractEvent[]> {
  if (!Number.isFinite(intervalMs) || intervalMs <= 0) {
    throw new RangeError("intervalMs must be greater than zero");
  }
  const groups = new Map<number, ContractEvent[]>();
  for (const event of events) {
    const timestamp = eventTimestamp(event);
    if (timestamp === undefined) continue;
    const bucket = Math.floor(timestamp / intervalMs) * intervalMs;
    const group = groups.get(bucket);
    if (group) group.push(event);
    else groups.set(bucket, [event]);
  }
  return groups;
}

export function calculateRate(events: readonly ContractEvent[], windowMs?: number): number {
  if (events.length === 0) return 0;
  if (windowMs !== undefined) {
    if (!Number.isFinite(windowMs) || windowMs <= 0) throw new RangeError("windowMs must be greater than zero");
    return events.length / (windowMs / 1000);
  }
  const timestamps = events.map(eventTimestamp).filter((timestamp): timestamp is number => timestamp !== undefined);
  if (timestamps.length < 2) return 0;
  const elapsedMs = Math.max(...timestamps) - Math.min(...timestamps);
  return elapsedMs > 0 ? events.length / (elapsedMs / 1000) : 0;
}

export function subscribeContractEvents(
  contractId: string,
  eventFilter: ContractEventFilter | EventFilterPredicate | undefined,
  callback: (events: ContractEvent[]) => void,
  options: ContractEventSubscriptionOptions,
): () => void {
  const intervalMs = options.intervalMs ?? 1500;
  const requestFetch = options.fetch ?? fetch;
  const seenEventIds = new Map<string, number>();
  const deduplicationTtlMs = options.deduplicationTtlMs ?? DEFAULT_DEDUPLICATION_TTL_MS;
  const deduplicationMaxSize = options.deduplicationMaxSize ?? DEFAULT_DEDUPLICATION_MAX_SIZE;
  let active = true;
  let timer: ReturnType<typeof setTimeout> | undefined;

  const scheduleNextPoll = (): void => {
    if (!active) return;

    timer = setTimeout(() => {
      void poll();
    }, intervalMs);
  };

  const poll = async (): Promise<void> => {
    if (!active) return;

    try {
      const endpoint = new URL(`${options.horizonUrl.replace(/\/$/, "")}/ledgers`);
      endpoint.searchParams.set("order", "desc");
      endpoint.searchParams.set("limit", "1");

      const response = await requestFetch(endpoint.toString());
      if (!response.ok) {
        return;
      }

      const payload = await response.json();
      const events = readRecords(payload)
        .filter((event) => {
          const eventContractId = typeof event.contractId === "string" ? event.contractId : "";
          return eventContractId === contractId;
        })
        .filter((event) => matchesEventFilter(event, eventFilter));

      evictSeenEvents(seenEventIds, deduplicationTtlMs, deduplicationMaxSize);

      const newEvents = events.filter((event) => {
        const id = String(event.id ?? `${event.contractId ?? ""}:${event.name ?? ""}`);
        if (!id || seenEventIds.has(id)) return false;
        seenEventIds.set(id, Date.now());
        return true;
      });

      if (newEvents.length > 0) {
        callback(newEvents);
      }
    } catch {
      // Ignore polling failures and keep the subscription alive.
    }

    if (active) {
      scheduleNextPoll();
    }
  };

  scheduleNextPoll();

  return () => {
    active = false;
    if (timer) {
      clearTimeout(timer);
      timer = undefined;
    }
  };
}

/**
 * Stream Soroban contract events as an async generator.
 *
 * Polls the Horizon endpoint at a configurable interval and yields new events
 * as they arrive. Deduplicates by event ID so the same event is never yielded
 * twice. The generator runs until the provided `AbortSignal` is aborted or the
 * caller breaks out of the `for await` loop.
 *
 * This is the generator-based counterpart of `subscribeContractEvents()` and
 * is more ergonomic when using `for await...of` loops.
 *
 * @param contractId - Soroban contract address to monitor.
 * @param filter     - Optional filter criteria (name, topicPatterns, contractId).
 * @param options    - Horizon URL, polling interval, and optional fetch override.
 * @param signal     - Optional AbortSignal to stop the stream externally.
 * @yields Arrays of new `ContractEvent` objects as they are detected.
 *
 * @example
 * const ac = new AbortController();
 * setTimeout(() => ac.abort(), 30_000);
 * for await (const events of streamContractEvents("C123", undefined, { horizonUrl }, ac.signal)) {
 *   console.log("new events:", events);
 * }
 */
export async function* streamContractEvents(
  contractId: string,
  filter: ContractEventFilter | EventFilterPredicate | undefined,
  options: ContractEventSubscriptionOptions,
  signal?: AbortSignal,
): AsyncGenerator<ContractEvent[]> {
  const intervalMs = options.intervalMs ?? 1500;
  const requestFetch = options.fetch ?? fetch;
  const seenEventIds = new Map<string, number>();
  const deduplicationTtlMs = options.deduplicationTtlMs ?? DEFAULT_DEDUPLICATION_TTL_MS;
  const deduplicationMaxSize = options.deduplicationMaxSize ?? DEFAULT_DEDUPLICATION_MAX_SIZE;

  while (!signal?.aborted) {
    try {
      const endpoint = new URL(`${options.horizonUrl.replace(/\/$/, "")}/ledgers`);
      endpoint.searchParams.set("order", "desc");
      endpoint.searchParams.set("limit", "1");

      const response = await requestFetch(endpoint.toString());
      if (response.ok) {
        const payload = await response.json();
        const events = readRecords(payload)
          .filter((event) => {
            const eventContractId = typeof event.contractId === "string" ? event.contractId : "";
            return eventContractId === contractId;
          })
          .filter((event) => matchesEventFilter(event, filter));

        evictSeenEvents(seenEventIds, deduplicationTtlMs, deduplicationMaxSize);

        const newEvents = events.filter((event) => {
          const id = String(event.id ?? `${event.contractId ?? ""}:${event.name ?? ""}`);
          if (!id || seenEventIds.has(id)) return false;
          seenEventIds.set(id, Date.now());
          return true;
        });

        if (newEvents.length > 0) {
          yield newEvents;
        }
      }
    } catch {
      // Ignore transient polling failures and continue the stream.
    }

    if (signal?.aborted) return;

    await new Promise<void>((resolve, reject) => {
      const timer = setTimeout(resolve, intervalMs);
      signal?.addEventListener("abort", () => {
        clearTimeout(timer);
        resolve();
      }, { once: true });
    });
  }
}

export async function queryContractEvents(
  contractId: string,
  filter?: ContractEventFilter | EventFilterPredicate,
  options?: ContractEventSubscriptionOptions,
): Promise<ContractEvent[]> {
  const requestFetch = options?.fetch ?? globalThis.fetch;

  try {
    const horizonUrl = options?.horizonUrl ?? "https://horizon-testnet.stellar.org";
    const endpoint = new URL(`${horizonUrl.replace(/\/$/, "")}/events`);
    endpoint.searchParams.set("contractId", contractId);
    endpoint.searchParams.set("order", "desc");
    if (options?.limit !== undefined) {
      endpoint.searchParams.set("limit", String(options.limit));
    }

    const response = await requestFetch(endpoint.toString());
    if (!response.ok) {
      return [];
    }

    const payload = await response.json();
    const events = readRecords(payload)
      .filter((event) => matchesEventFilter(event, filter));

    return events;
  } catch {
    return [];
  }
}
