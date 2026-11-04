export type Viewer = 'normal' | 'protan' | 'deutan' | 'tritan';
export const MATRICES: Record<Viewer, number[][]>;
export const PALETTES: Record<string, Record<string, string>>;
export function parse(hex: string): number[];
export function simulate(hex: string, kind: Viewer): number[];
export function lab(rgb: number[]): number[];
export function deltaE(a: number[], b: number[]): number;
export function worstPair(colours: Record<string, string>, kind: Viewer): { de: number; pair: string };
