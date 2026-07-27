export interface ContractEvent {
  id?: string;
  contractId?: string;
  contract_id?: string;
  name?: string;
  topics?: Array<string | null | undefined>;
  topic?: Array<string | null | undefined>;
  value?: unknown;
  [key: string]: unknown;
}

export interface ContractEventFilter {
  name?: string;
  topicPatterns?: Array<string | RegExp>;
  contractId?: string;
}

export interface ContractEventSubscriptionOptions {
  horizonUrl: string;
  intervalMs?: number;
  fetch?: typeof fetch;
  limit?: number;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function readEventRecord(raw: unknown): ContractEvent | null {
  if (!isRecord(raw)) return null;

  const topics = Array.isArray(raw.topics)
    ? raw.topics.filter((topic): topic is string => typeof topic === "string")
    : Array.isArray(raw.topic)
      ? raw.topic.filter((topic): topic is string => typeof topic === "string")
      : [];

  return {
    ...(raw as Record<string, unknown>),
    id: String(raw.id ?? raw.event_id ?? raw.eventId ?? raw.paging_token ?? ""),
    contractId: String(raw.contractId ?? raw.contract_id ?? raw.contractID ?? ""),
    name: String(raw.name ?? raw.event_type ?? raw.eventType ?? ""),
    topics,
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
  if (pattern instanceof RegExp) return pattern.test(topic);
  return topic === pattern;
}

function matchesFilter(event: ContractEvent, filter?: ContractEventFilter): boolean {
  if (!filter) return true;

  if (filter.name) {
    const eventName = typeof event.name === "string" ? event.name : "";
    if (eventName !== filter.name) return false;
  }

  if (filter.contractId) {
    const eventContractId = typeof event.contractId === "string" ? event.contractId : "";
    if (eventContractId !== filter.contractId) return false;
  }

  if (filter.topicPatterns?.length) {
    const topics = Array.isArray(event.topics) ? event.topics : [];
    const matchesTopic = topics.some((topic) =>
      topic != null && filter.topicPatterns!.some((pattern) => matchesTopicPattern(topic, pattern)),
    );
    if (!matchesTopic) return false;
  }

  return true;
}

export function subscribeContractEvents(
  contractId: string,
  eventFilter: ContractEventFilter | undefined,
  callback: (events: ContractEvent[]) => void,
  options: ContractEventSubscriptionOptions,
): () => void {
  const intervalMs = options.intervalMs ?? 1500;
  const requestFetch = options.fetch ?? fetch;
  const seenEventIds = new Set<string>();
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
        .filter((event) => matchesFilter(event, eventFilter));

      const newEvents = events.filter((event) => {
        const id = String(event.id ?? `${event.contractId ?? ""}:${event.name ?? ""}`);
        if (!id || seenEventIds.has(id)) return false;
        seenEventIds.add(id);
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
  filter: ContractEventFilter | undefined,
  options: ContractEventSubscriptionOptions,
  signal?: AbortSignal,
): AsyncGenerator<ContractEvent[]> {
  const intervalMs = options.intervalMs ?? 1500;
  const requestFetch = options.fetch ?? fetch;
  const seenEventIds = new Set<string>();

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
          .filter((event) => matchesFilter(event, filter));

        const newEvents = events.filter((event) => {
          const id = String(event.id ?? `${event.contractId ?? ""}:${event.name ?? ""}`);
          if (!id || seenEventIds.has(id)) return false;
          seenEventIds.add(id);
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
  filter?: ContractEventFilter,
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
      .filter((event) => matchesFilter(event, filter));

    return events;
  } catch {
    return [];
  }
}
