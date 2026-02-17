interface CacheEntry<T> {
  expiresAt: number;
  value?: T;
  inflight?: Promise<T>;
}

export class MemoryCache {
  private readonly map = new Map<string, CacheEntry<unknown>>();

  async getOrSet<T>(key: string, ttlMs: number, producer: () => Promise<T>): Promise<T> {
    const now = Date.now();
    const existing = this.map.get(key) as CacheEntry<T> | undefined;

    if (existing?.value !== undefined && existing.expiresAt > now) {
      return existing.value;
    }

    if (existing?.inflight) {
      return existing.inflight;
    }

    const inflight = producer();
    this.map.set(key, { expiresAt: now + ttlMs, inflight });

    try {
      const value = await inflight;
      this.map.set(key, { expiresAt: Date.now() + ttlMs, value });
      return value;
    } catch (error) {
      this.map.delete(key);
      throw error;
    }
  }
}
