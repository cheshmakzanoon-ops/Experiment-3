/** CI evidence must reject a recovered GPU crash too: PNG encoding alone is
 * not evidence that a healthy WebGL scene was captured. No driver flags change. */
export function graphicsFaults(
  processLog: readonly string[],
  consoleLog: readonly { type: string; text: string }[],
  contextLosses: number,
): string[] {
  const faults = new Set<string>();
  for (const line of processLog.join('').match(/GPU process exited unexpectedly:[^\r\n]*/g) ?? [])
    faults.add(line);
  for (const { text } of consoleLog)
    if (/CONTEXT_LOST_WEBGL|THREE\.WebGLRenderer:\s*Context Lost\./i.test(text)) faults.add(text);
  if (!Number.isInteger(contextLosses) || contextLosses < 0)
    faults.add('WebGL context-health observation is unavailable');
  else if (contextLosses > 0) faults.add(`Observed ${contextLosses} WebGL context-loss event(s)`);
  return [...faults];
}

export interface ProcessGraphicsObservation {
  observed: true;
  gpuExits: number;
  faults: string[];
}
/** Fixed-size diagnostics with a sticky failure count; clean exits are recorded
 * but are not crashes. Installed before the first window, not by the smoke client. */
export function createProcessGraphicsObservation() {
  let gpuExits = 0;
  const faults: string[] = [];
  return {
    record(details: { type: string; reason: string; exitCode: number }) {
      if (details.type !== 'GPU') return;
      gpuExits++;
      if (details.reason !== 'clean-exit' && faults.length < 32)
        faults.push(`GPU process gone: ${details.reason}; exitCode=${details.exitCode}`);
    },
    read(): ProcessGraphicsObservation {
      return { observed: true, gpuExits, faults: [...faults] };
    },
  };
}

/** Inspect complete chunks before any log truncation. Keep a small overlap so
 * a split marker is detected; no requirement to retain unbounded stderr. */
export function createGraphicsLogScanner() {
  let tail = '';
  let crashed = false;
  return {
    push(chunk: string) {
      const text = tail + chunk;
      if (text.includes('GPU process exited unexpectedly:')) crashed = true;
      tail = text.slice(-64);
    },
    faults: () => (crashed ? ['GPU process exited unexpectedly (process log)'] : []),
  };
}

export function observationFaults(process: unknown, document: unknown): string[] {
  const faults: string[] = [];
  const p = process as ProcessGraphicsObservation | undefined;
  if (
    !p ||
    p.observed !== true ||
    !Number.isSafeInteger(p.gpuExits) ||
    p.gpuExits < 0 ||
    !Array.isArray(p.faults) ||
    !p.faults.every((fault) => typeof fault === 'string')
  )
    faults.push('Main-process graphics observation is unavailable');
  else faults.push(...p.faults);
  const d = document as
    | {
        version?: number;
        documents?: { id: string; url: string; losses: number; ended: boolean }[];
        observationErrors?: string[];
      }
    | undefined;
  if (
    !d ||
    d.version !== 1 ||
    !Array.isArray(d.documents) ||
    !d.documents.length ||
    !Array.isArray(d.observationErrors) ||
    !d.observationErrors.every((error) => typeof error === 'string') ||
    !d.documents.every(
      (entry) =>
        typeof entry.id === 'string' &&
        typeof entry.url === 'string' &&
        Number.isSafeInteger(entry.losses) &&
        entry.losses >= 0 &&
        typeof entry.ended === 'boolean',
    )
  ) {
    faults.push('Document graphics observation is unavailable');
  } else {
    faults.push(...d.observationErrors);
    for (const entry of d.documents)
      if (entry.losses)
        faults.push(
          `Document ${entry.id} (${entry.url}): ${entry.losses} context loss(es); ended=${entry.ended}`,
        );
  }
  return faults;
}
