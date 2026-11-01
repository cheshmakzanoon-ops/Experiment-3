/** Host-side brackets around existing operations only. No renderer calls, timers,
 * delays or retries. Diagnostic failures never replace an operation's result. */
export function createNativeActionMarks(clock = Date.now) {
  const records = [];
  let evicted = 0;
  const now = () => {
    try {
      const value = clock();
      return Number.isFinite(value) ? value : null;
    } catch {
      return null;
    }
  };
  return {
    async run(action, operation) {
      const row = {
        action: typeof action === 'string' ? action.slice(0, 64) : 'unknown',
        hostBefore: now(),
        hostAfter: null,
        outcome: 'pending',
      };
      records.push(row);
      if (records.length > 64) {
        records.shift();
        evicted++;
      }
      try {
        const result = await operation();
        row.outcome = 'fulfilled';
        return result;
      } catch (error) {
        row.outcome = 'rejected';
        throw error;
      } finally {
        row.hostAfter = now();
      }
    },
    snapshot() {
      return { version: 1, limit: 64, evicted, records: records.map((row) => ({ ...row })) };
    },
  };
}
