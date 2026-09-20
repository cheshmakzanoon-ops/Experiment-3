/** Original editable identity. No commercial logos, screenshots or licensed liveries. */
export interface Livery {
  primary: string;
  accent: string;
  number: number;
  sponsor: string;
  pattern: 'sweep' | 'split' | 'minimal';
}
export const DEFAULT_LIVERY: Readonly<Livery> = Object.freeze({
  primary: '#c97235',
  accent: '#e3ddc9',
  number: 7,
  sponsor: 'APEX',
  pattern: 'sweep',
});
export const LIVERY_PRESETS = {
  copper: { ...DEFAULT_LIVERY },
  nocturne: {
    primary: '#132a41',
    accent: '#69d3d0',
    number: 7,
    sponsor: 'AUREL',
    pattern: 'split',
  },
  orchid: { primary: '#392447', accent: '#f1c54a', number: 7, sponsor: 'VECTOR', pattern: 'sweep' },
  glacier: {
    primary: '#dde4e4',
    accent: '#238888',
    number: 7,
    sponsor: 'NORTH',
    pattern: 'minimal',
  },
} satisfies Record<string, Livery>;
export function validateLivery(value: unknown): Livery {
  const p = value && typeof value === 'object' ? (value as Partial<Livery>) : {};
  const color = (v: unknown, fallback: string) =>
    typeof v === 'string' && /^#[0-9a-f]{6}$/i.test(v) ? v.toLowerCase() : fallback;
  return {
    primary: color(p.primary, DEFAULT_LIVERY.primary),
    accent: color(p.accent, DEFAULT_LIVERY.accent),
    number:
      typeof p.number === 'number' && Number.isFinite(p.number)
        ? Math.max(1, Math.min(99, Math.round(p.number)))
        : 7,
    sponsor:
      typeof p.sponsor === 'string'
        ? p.sponsor
            .toUpperCase()
            .replace(/[^A-Z0-9 .-]/g, '')
            .trim()
            .slice(0, 14) || 'APEX'
        : 'APEX',
    pattern: p.pattern === 'split' || p.pattern === 'minimal' ? p.pattern : 'sweep',
  };
}
