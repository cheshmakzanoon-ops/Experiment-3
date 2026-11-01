export function createNativeActionMarks(clock?: () => number): {
  run<T>(action: string, operation: () => T | Promise<T>): Promise<T>;
  snapshot(): {
    version: number;
    limit: number;
    evicted: number;
    records: {
      action: string;
      hostBefore: number | null;
      hostAfter: number | null;
      outcome: string;
    }[];
  };
};
