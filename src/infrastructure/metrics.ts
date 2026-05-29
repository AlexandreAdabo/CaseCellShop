export type MetricsSnapshot = {
  cacheHit: number;
  cacheMiss: number;
  checkoutAccepted: number;
  checkoutEnqueued: number;
  checkoutProcessing: number;
  checkoutCompleted: number;
  checkoutFailed: number;
};

export class Metrics {
  private readonly counters: MetricsSnapshot = {
    cacheHit: 0,
    cacheMiss: 0,
    checkoutAccepted: 0,
    checkoutEnqueued: 0,
    checkoutProcessing: 0,
    checkoutCompleted: 0,
    checkoutFailed: 0,
  };

  increment(counter: keyof MetricsSnapshot, amount = 1): void {
    this.counters[counter] += amount;
  }

  snapshot(): MetricsSnapshot {
    return { ...this.counters };
  }
}
