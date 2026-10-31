/** Browser-only graphics evidence. Install before engine construction. Session
 * storage carries document identities across same-origin navigation; unavailable,
 * corrupt or overflowing history fails closed rather than silently resetting.
 * pagehide is lifecycle evidence, not a context loss. A loss during teardown is
 * still retained: timing alone cannot prove an intentional loss was harmless. */
export interface GraphicsDocument {
  id: string;
  url: string;
  losses: number;
  ended: boolean;
}
export interface GraphicsObservation {
  version: 1;
  documents: GraphicsDocument[];
  observationErrors: string[];
}
const KEY = 'motobound.graphics-observation.v1';
export function newGraphicsObservation(
  previous: string | null,
  id: string,
  url: string,
): GraphicsObservation {
  let documents: GraphicsDocument[] = [];
  let observationErrors: string[] = [];
  if (previous !== null) {
    try {
      const parsed = JSON.parse(previous) as GraphicsObservation;
      if (
        parsed.version !== 1 ||
        !Array.isArray(parsed.documents) ||
        parsed.documents.length > 32 ||
        !Array.isArray(parsed.observationErrors) ||
        parsed.observationErrors.length > 8 ||
        !parsed.observationErrors.every((error) => typeof error === 'string') ||
        !parsed.documents.every(
          (doc) =>
            typeof doc.id === 'string' &&
            typeof doc.url === 'string' &&
            Number.isSafeInteger(doc.losses) &&
            doc.losses >= 0 &&
            typeof doc.ended === 'boolean',
        )
      )
        throw new Error('Invalid history');
      documents = parsed.documents;
      observationErrors = parsed.observationErrors;
    } catch {
      observationErrors = ['Graphics document history is unreadable'];
    }
  }
  if (documents.length === 32) {
    documents.shift();
    observationErrors = [
      ...new Set([...observationErrors, 'Graphics document history overflow']),
    ].slice(0, 8);
  }
  documents.push({ id, url: url.slice(0, 2048), losses: 0, ended: false });
  return { version: 1, documents, observationErrors };
}
declare global {
  interface Window {
    motoboundGraphicsObservation?: () => GraphicsObservation;
  }
}
export function installGraphicsObservation(): void {
  if (window.motoboundGraphicsObservation) return;
  let previous: string | null = null;
  let storageFailed = false;
  try {
    previous = sessionStorage.getItem(KEY);
  } catch {
    storageFailed = true;
  }
  const state = newGraphicsObservation(previous, crypto.randomUUID(), location.href);
  const current = state.documents[state.documents.length - 1];
  const unavailable = () => {
    if (!state.observationErrors.includes('Graphics history storage unavailable'))
      state.observationErrors.push('Graphics history storage unavailable');
  };
  if (storageFailed) unavailable();
  const persist = () => {
    try {
      sessionStorage.setItem(KEY, JSON.stringify(state));
    } catch {
      unavailable();
    }
  };
  window.addEventListener(
    'webglcontextlost',
    () => {
      current.losses++;
      persist();
    },
    true,
  );
  window.addEventListener('pagehide', () => {
    current.ended = true;
    persist();
  });
  Object.defineProperty(window, 'motoboundGraphicsObservation', {
    value: () => structuredClone(state),
    writable: false,
    configurable: false,
  });
  persist();
}
