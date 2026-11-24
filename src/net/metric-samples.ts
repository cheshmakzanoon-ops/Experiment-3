/** Recent observations per metric and client/predictor instance. At 60 Hz
 * this covers about 68 seconds; it is a sample window, not a duration window. */
export const NETWORK_METRIC_CAPACITY = 4096;

export interface MetricTotals {
  /** Every recorded observation, including a non-finite diagnostic value. */
  observations: number;
  /** Finite observations used by the lifetime sum, mean and maximum.
   * Recent snapshots still retain non-finite values for diagnostics. */
  samples: number;
  sum: number;
  mean: number;
  max: number;
}

export type SampleStats<K extends string> = {
  /** Detached chronological recent samples. Mutating a snapshot changes no history. */
  readonly [P in K]: number[];
} & {
  readonly sampleCapacity: number;
  /** Detached lifetime summaries; eviction never resets these counters. */
  readonly sampleTotals: Readonly<Record<K, MetricTotals>>;
};

interface Window {
  values: Float64Array;
  observations: number;
  samples: number;
  sum: number;
  max: number;
}

/** Constant retained storage and O(1) recording. Only an explicit stats read
 * allocates a snapshot; no per-observation shifts, copies or objects. */
export class MetricSamples<K extends string> {
  private readonly windows = Object.create(null) as Record<K, Window>;
  readonly stats: SampleStats<K>;

  constructor(keys: readonly K[]) {
    const stats = {} as SampleStats<K>,
      metricKeys = [...keys];
    for (const key of metricKeys) {
      const window: Window = {
        values: new Float64Array(NETWORK_METRIC_CAPACITY),
        observations: 0,
        samples: 0,
        sum: 0,
        max: -Infinity,
      };
      this.windows[key] = window;
      Object.defineProperty(stats, key, {
        enumerable: true,
        get: () => {
          const length = Math.min(window.observations, NETWORK_METRIC_CAPACITY),
            start = window.observations > length ? window.observations % length : 0;
          return Array.from(
            { length },
            (_, i) => window.values[(start + i) % NETWORK_METRIC_CAPACITY],
          );
        },
      });
    }
    Object.defineProperties(stats, {
      sampleCapacity: { enumerable: true, value: NETWORK_METRIC_CAPACITY },
      sampleTotals: {
        enumerable: true,
        get: () => {
          const totals = {} as Record<K, MetricTotals>;
          for (const key of metricKeys) {
            const { observations, samples, sum, max } = this.windows[key];
            totals[key] = {
              observations,
              samples,
              sum,
              mean: samples ? sum / samples : 0,
              max: samples ? max : 0,
            };
          }
          return totals;
        },
      },
    });
    this.stats = stats;
  }

  record(key: K, value: number) {
    const window = this.windows[key];
    window.values[window.observations % NETWORK_METRIC_CAPACITY] = value;
    window.observations++;
    if (Number.isFinite(value)) {
      window.samples++;
      window.sum += value;
      window.max = Math.max(window.max, value);
    }
  }
}
