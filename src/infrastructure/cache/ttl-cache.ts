type CacheEntry<T> = {
  value: T;
  expiresAt: number;
};

export class TTLCache<T> {
  private entry: CacheEntry<T> | null = null;

  constructor(private readonly ttlMs: number) {}

  get(now = Date.now()): T | null {
    if (!this.entry) {
      return null;
    }

    if (this.entry.expiresAt <= now) {
      this.entry = null;
      return null;
    }

    return this.entry.value;
  }

  set(value: T, now = Date.now()): void {
    this.entry = {
      value,
      expiresAt: now + this.ttlMs,
    };
  }

  clear(): void {
    this.entry = null;
  }
}
