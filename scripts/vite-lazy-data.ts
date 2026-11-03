import { readFileSync } from 'node:fs';
import { relative, resolve } from 'node:path';
import type { Plugin } from 'vite';

/**
 * Production-build plugin: serve selected large JSON documents as lazy
 * datasets (see src/core/lazy-data.ts for the runtime contract).
 *
 * Only the listed files are rewritten. Source (vitest, dev server) and fixture
 * builds keep the plain JSON import, so nothing but the shipped bundle changes.
 */
export interface LazyDataOptions {
  /** Repository root; `files` and the runtime module resolve against it. */
  root: string;
  /** JSON documents (root-relative) to serve lazily, each with the load group that needs it first. */
  files: Readonly<Record<string, string>>;
  /** Top-level keys whose serialised JSON is at least this large load lazily. */
  minBytes?: number;
  /** The runtime module the facades import (default `src/core/lazy-data.ts`). */
  runtime?: string;
}

export const LAZY_KEY_BYTES = 16 * 1024;

/** Split a document's top-level keys into the inline part and the lazy part. */
export function splitDataset(
  document: unknown,
  minBytes = LAZY_KEY_BYTES,
): { inline: Record<string, unknown>; lazy: Record<string, unknown> } {
  if (!document || typeof document !== 'object' || Array.isArray(document))
    throw new Error('A lazy dataset must be a JSON object');
  const inline: Record<string, unknown> = {};
  const lazy: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(document))
    (JSON.stringify(value).length >= minBytes ? lazy : inline)[key] = value;
  return { inline, lazy };
}

/** A JS string literal that `JSON.parse` turns back into `value` (fast path for big tables). */
function jsonLiteral(value: unknown) {
  return `JSON.parse(${JSON.stringify(JSON.stringify(value))})`;
}

// Virtual ids must not end in `.json` or Vite's own JSON transform would parse our JS.
const FACADE = '\0lazy-data-facade:';
const PAYLOAD = '\0lazy-data-payload:';
const SUFFIX = '.js';
const PAYLOAD_SPECIFIER = 'virtual:lazy-data-payload/';

export function lazyData(options: LazyDataOptions): Plugin {
  const root = resolve(options.root);
  const minBytes = options.minBytes ?? LAZY_KEY_BYTES;
  const targets = new Map(
    Object.entries(options.files).map(([file, group]) => [resolve(root, file), group]),
  );
  const runtime = resolve(root, options.runtime ?? 'src/core/lazy-data.ts');
  const idOf = (file: string) => relative(root, file).replaceAll('\\', '/');
  return {
    name: 'apex-lazy-data',
    apply: 'build',
    enforce: 'pre',
    async resolveId(source, importer, resolveOptions) {
      if (source.startsWith(PAYLOAD_SPECIFIER))
        return PAYLOAD + resolve(root, source.slice(PAYLOAD_SPECIFIER.length)) + SUFFIX;
      if (!source.endsWith('.json') || source.startsWith('\0')) return null;
      const resolved = await this.resolve(source, importer, { ...resolveOptions, skipSelf: true });
      if (!resolved || !targets.has(resolve(resolved.id))) return null;
      return FACADE + resolve(resolved.id) + SUFFIX;
    },
    load(id) {
      if (id.startsWith(FACADE)) {
        const file = id.slice(FACADE.length, -SUFFIX.length);
        this.addWatchFile(file);
        const { inline, lazy } = splitDataset(JSON.parse(readFileSync(file, 'utf8')), minBytes);
        const keys = Object.keys(lazy);
        // Nothing large: behave as a plain JSON import.
        if (!keys.length)
          return { code: `export default ${jsonLiteral(inline)};`, map: { mappings: '' } };
        const payload = JSON.stringify(PAYLOAD_SPECIFIER + idOf(file));
        return {
          code: [
            `import { lazyDataset } from ${JSON.stringify(runtime)};`,
            `export default lazyDataset(${JSON.stringify(idOf(file))}, ${JSON.stringify(targets.get(file))}, ${jsonLiteral(inline)}, ${JSON.stringify(keys)}, () => import(${payload}));`,
          ].join('\n'),
          map: { mappings: '' },
        };
      }
      if (id.startsWith(PAYLOAD)) {
        const file = id.slice(PAYLOAD.length, -SUFFIX.length);
        const { lazy } = splitDataset(JSON.parse(readFileSync(file, 'utf8')), minBytes);
        return { code: `export default ${jsonLiteral(lazy)};`, map: { mappings: '' } };
      }
      return null;
    },
  };
}
