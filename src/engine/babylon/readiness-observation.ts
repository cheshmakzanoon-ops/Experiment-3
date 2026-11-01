/** Plain observation only: never prepare, poll, dispose or publish owner state.
 * Some readiness getters reject an expired owner. Reporting that rejection must
 * not change application control flow or turn an unknown field into false. */
export function observePreparationReadiness(owner?: {
  readonly completed: boolean;
  readonly canDraw: boolean;
}) {
  const errors: string[] = [];
  const read = (key: 'completed' | 'canDraw') => {
    if (!owner) return null;
    try {
      const value = owner[key];
      if (typeof value === 'boolean') return value;
      errors.push(`${key}: unavailable boolean`);
    } catch (error) {
      try {
        errors.push(`${key}: ${String(error).slice(0, 256)}`);
      } catch {
        errors.push(`${key}: unreadable diagnostic error`);
      }
    }
    return null;
  };
  return { exists: !!owner, completed: read('completed'), canDraw: read('canDraw'), errors };
}

/** Isolate ONLY newly added diagnostic metadata. Existing graphics-query errors
 * stay outside this boundary and must retain their original failure semantics. */
export function observeReadinessSnapshot<T>(read: () => T) {
  try {
    return { readiness: read(), readinessError: null };
  } catch (error) {
    let message: string;
    try {
      message = String(error).slice(0, 256);
    } catch {
      message = 'Unprintable readiness observation error';
    }
    return { readiness: null, readinessError: message };
  }
}
