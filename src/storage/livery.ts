import { clamp } from '../core/math.ts';
export interface DecalSlot {
  id: number;
  side: 'left' | 'right';
  text: string;
  color: string;
  x: number;
  y: number;
  scale: number;
  rotation: number;
}
export const DECAL_LIMIT = 10;
export function emptyDecal(id: number): DecalSlot {
  const bounded = Number.isFinite(id) ? clamp(Math.round(id), 1, DECAL_LIMIT) : 1;
  return {
    id: bounded,
    side: bounded <= 5 ? 'left' : 'right',
    text: 'APEX',
    color: '#f6f1e3',
    x: (((bounded - 1) % 3) - 1) * 0.65,
    y: (bounded - 1) % 5 < 3 ? -0.85 : 0.85,
    scale: 1,
    rotation: 0,
  };
}
export function validateDecals(value: unknown): DecalSlot[] {
  if (!Array.isArray(value)) return [];
  const result: DecalSlot[] = [];
  const ids = new Set<number>();
  const finite = (v: unknown, fallback: number, min: number, max: number) =>
    typeof v === 'number' && Number.isFinite(v) ? clamp(v, min, max) : fallback;
  // Bound hostile or corrupt saves before iterating. The first valid slot wins.
  for (const row of value.slice(0, 100)) {
    if (
      !row ||
      typeof row !== 'object' ||
      !Number.isInteger(row.id) ||
      row.id < 1 ||
      row.id > DECAL_LIMIT ||
      ids.has(row.id)
    )
      continue;
    const base = emptyDecal(row.id);
    result.push({
      id: row.id,
      side: row.side === 'right' ? 'right' : 'left',
      text:
        typeof row.text === 'string'
          ? row.text
              .toUpperCase()
              .replace(/[^A-Z0-9 .-]/g, '')
              .trim()
              .slice(0, 14) || 'APEX'
          : base.text,
      color:
        typeof row.color === 'string' && /^#[a-f0-9]{6}$/i.test(row.color)
          ? row.color.toLowerCase()
          : base.color,
      x: finite(row.x, base.x, -1, 1),
      y: finite(row.y, base.y, -1, 1),
      scale: finite(row.scale, 1, 0.35, 1.75),
      rotation: finite(row.rotation, 0, -90, 90),
    });
    ids.add(row.id);
  }
  return result.sort((a, b) => a.id - b.id);
}
/** Original editable identity. No commercial logos, screenshots or licensed liveries. */
export interface Livery {
  primary: string;
  accent: string;
  number: number;
  sponsor: string;
  pattern: 'sweep' | 'split' | 'minimal';
  /** Sparse slots: disabled slots are omitted; old saves need no migration. */
  decals?: DecalSlot[];
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
  const decals = validateDecals(p.decals);
  return {
    ...(decals.length ? { decals } : {}),
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
