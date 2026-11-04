/** Marks an English string that is data (a table entry, a constant) so the extraction
 * (scripts/i18n-extract.ts) finds it; it returns the text unchanged and costs nothing.
 * Translate it where it is shown: `t(entry.label)`.
 *
 * It lives apart from the language core so simulation data that the worker also bundles
 * can mark its words without pulling the dictionary loaders into the worker. */
export const N_ = <T extends string>(source: T): T => source;
