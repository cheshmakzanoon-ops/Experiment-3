export interface BrandHit {
  /** The deny-list category. */
  label: string;
  /** The matched words, canonical form (lower case, single spaces). */
  word: string;
  /** Canonical text around the match. */
  around: string;
}
export const FORBIDDEN: readonly (readonly [label: string, source: string])[];
export const FORBIDDEN_RE: readonly (readonly [label: string, pattern: RegExp])[];
export const SOFT: RegExp;
/** Words split, separators unified, lower case: the form the patterns run on. */
export function canonicalise(text: string): string;
/** Every brand hit in `text` (separator-, case- and camelCase-insensitive), at most `limit`. */
export function findBrands(text: string, limit?: number): BrandHit[];
