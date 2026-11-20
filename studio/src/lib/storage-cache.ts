// A small per-user cache for the storage numbers (lib/server/storage.ts). Plain TypeScript, so the Node
// tests check it: entries last a minute, one user's entry never answers for another, and the map stays
// bounded (the oldest entry goes first).

export interface StorageCache<T> {
  get(userId: string): T | null;
  set(userId: string, value: T): void;
  /** One user's entry, or every entry when no user is given. */
  forget(userId?: string): void;
  size(): number;
}

export function createStorageCache<T>(o: { ttlMs?: number; max?: number; now?: () => number } = {}): StorageCache<T> {
  const ttl = o.ttlMs ?? 60_000;
  const max = o.max ?? 500;
  const now = o.now ?? (() => Date.now());
  const entries = new Map<string, { at: number; value: T }>();
  return {
    get(userId) {
      const hit = entries.get(userId);
      if (!hit) return null;
      if (now() - hit.at >= ttl) { entries.delete(userId); return null; }
      return hit.value;
    },
    set(userId, value) {
      entries.delete(userId);
      if (entries.size >= max) entries.delete(entries.keys().next().value!);
      entries.set(userId, { at: now(), value });
    },
    forget(userId) {
      if (userId === undefined) entries.clear();
      else entries.delete(userId);
    },
    size: () => entries.size,
  };
}
