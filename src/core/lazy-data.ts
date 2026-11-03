/**
 * Build-time lazy datasets.
 *
 * Authored geometry tables (crowd, start/finish, crew, motocross kit ...) are
 * large generated JSON documents. Imported statically they land in the entry
 * chunk and every player parses them before the first screen, although a
 * circuit session reads most of them. In production builds
 * `scripts/vite-lazy-data.ts` rewrites the listed JSON imports into
 * `lazyDataset(...)` facades:
 *
 * - small top-level keys (versions, units, rest poses) stay inline, so module
 *   level code such as `source.rest.map(...)` keeps working;
 * - large top-level keys move to a separate chunk and are exposed as getters
 *   that throw until `loadLazyData()` has resolved.
 *
 * Consumers are unchanged and stay synchronous. The contract is: await
 * `loadLazyData(group)` before building anything that reads those keys. Every
 * dataset belongs to a group naming the first place that needs it:
 *
 * - `showroom`: read while the menu showroom renderer is constructed;
 * - `circuit`: read only by a circuit or festival session.
 *
 * Source and test builds do not use the plugin, so the same call is a no-op
 * there and the tables are plain imports.
 */
export class LazyDataNotLoadedError extends Error {
  constructor(dataset: string, key: string) {
    super(
      `Lazy dataset "${dataset}" was read (.${key}) before loadLazyData() resolved. ` +
        'Await loadLazyData() before building anything that uses it.',
    );
    this.name = 'LazyDataNotLoadedError';
  }
}

interface Entry {
  group: string;
  loaded: boolean;
  load: () => Promise<void>;
}
const datasets = new Map<string, Entry>();

/**
 * Build the facade for one dataset. `inline` is the always-present part;
 * `keys` name the properties served from `load()`'s default export.
 */
export function lazyDataset<Inline extends object, Lazy extends object>(
  id: string,
  group: string,
  inline: Inline,
  keys: readonly (keyof Lazy & string)[],
  load: () => Promise<{ default: Lazy }>,
): Inline & Lazy {
  const view = { ...inline } as Inline & Lazy;
  let payload: Lazy | null = null;
  let pending: Promise<void> | null = null;
  for (const key of keys)
    Object.defineProperty(view, key, {
      enumerable: true,
      get() {
        if (!payload) throw new LazyDataNotLoadedError(id, key);
        return payload[key];
      },
    });
  datasets.set(id, {
    group,
    get loaded() {
      return payload !== null;
    },
    load: () =>
      (pending ??= load().then(
        (module) => {
          payload = module.default;
        },
        (error) => {
          pending = null; // A failed fetch can be retried by the next session start.
          throw error;
        },
      )),
  });
  return view;
}

/**
 * Load the registered lazy datasets of the given groups (all when omitted).
 * Concurrent and repeated calls share one fetch per dataset.
 */
export async function loadLazyData(...groups: string[]): Promise<void> {
  const wanted = [...datasets.values()].filter(
    (entry) => !groups.length || groups.includes(entry.group),
  );
  await Promise.all(wanted.map((entry) => entry.load()));
}

/** Registered datasets and whether their payload is resident (diagnostics, tests). */
export function lazyDataStatus(): { id: string; group: string; loaded: boolean }[] {
  return [...datasets].map(([id, entry]) => ({ id, group: entry.group, loaded: entry.loaded }));
}
