export interface CursorStore {
  save(key: string, cursor: string): Promise<void>;
  load(key: string): Promise<string | undefined>;
  clear(key?: string): Promise<void>;
}

/** In-memory implementation for SSR, tests, and applications without storage. */
export class MemoryCursorStore implements CursorStore {
  private readonly cursors = new Map<string, string>();
  async save(key: string, cursor: string): Promise<void> { this.cursors.set(key, cursor); }
  async load(key: string): Promise<string | undefined> { return this.cursors.get(key); }
  async clear(key?: string): Promise<void> { key === undefined ? this.cursors.clear() : this.cursors.delete(key); }
}

/** localStorage-backed cursor store. It never throws when storage is unavailable. */
export class LocalStorageCursorStore implements CursorStore {
  constructor(private readonly storage: Storage = globalThis.localStorage, private readonly prefix = "sorokit:cursor:") {}
  async save(key: string, cursor: string): Promise<void> { this.storage.setItem(this.prefix + key, cursor); }
  async load(key: string): Promise<string | undefined> { return this.storage.getItem(this.prefix + key) ?? undefined; }
  async clear(key?: string): Promise<void> {
    if (key !== undefined) { this.storage.removeItem(this.prefix + key); return; }
    const keys: string[] = [];
    for (let i = 0; i < this.storage.length; i++) { const item = this.storage.key(i); if (item?.startsWith(this.prefix)) keys.push(item); }
    keys.forEach((item) => this.storage.removeItem(item));
  }
}

/** Creates localStorage persistence in browsers and memory persistence elsewhere. */
export function createCursorStore(storage?: Storage): CursorStore {
  if (storage) return new LocalStorageCursorStore(storage);
  if (typeof globalThis.localStorage !== "undefined") return new LocalStorageCursorStore(globalThis.localStorage);
  return new MemoryCursorStore();
}

export interface EventDeduplicationStore {
  has(id: string): Promise<boolean>;
  add(id: string): Promise<void>;
  clear(): Promise<void>;
}

/** Persistent bounded event IDs prevent duplicate delivery after reconnects. */
export class PersistentEventDeduplicationStore implements EventDeduplicationStore {
  private readonly ids = new Map<string, number>();
  constructor(private readonly maxSize = 10_000, private readonly ttlMs = 60 * 60 * 1000, private readonly now = Date.now) {}
  async has(id: string): Promise<boolean> { this.evict(); return this.ids.has(id); }
  async add(id: string): Promise<void> { this.evict(); this.ids.set(id, this.now()); this.evict(); }
  async clear(): Promise<void> { this.ids.clear(); }
  private evict(): void {
    const cutoff = this.now() - this.ttlMs;
    for (const [id, timestamp] of this.ids) if (timestamp < cutoff) this.ids.delete(id);
    while (this.ids.size > this.maxSize) this.ids.delete(this.ids.keys().next().value as string);
  }
}

export default CursorStore;
