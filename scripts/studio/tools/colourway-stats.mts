import { COLOURWAYS, COLOURWAY_IDS } from '../../../src/rendering/vehicle-bodies/colourways.ts';

// Prints how the default colourways spread over the colour wheel and which layers they use.
//   npx vite-node scripts/studio/tools/colourway-stats.mts
const hue = (hex: number) => {
  const r = ((hex >> 16) & 255) / 255,
    g = ((hex >> 8) & 255) / 255,
    b = (hex & 255) / 255;
  const max = Math.max(r, g, b),
    min = Math.min(r, g, b),
    d = max - min;
  if (d < 0.08) return -1;
  const h = max === r ? ((g - b) / d + 6) % 6 : max === g ? (b - r) / d + 2 : (r - g) / d + 4;
  return h * 60;
};
const buckets = new Map<string, string[]>();
const layers = new Map<string, number>();
for (const id of COLOURWAY_IDS) {
  const way = COLOURWAYS[id];
  const h = hue(way.primary);
  const name = h < 0 ? 'neutral' : `${Math.floor(h / 30) * 30}-${Math.floor(h / 30) * 30 + 30} deg`;
  buckets.set(name, [...(buckets.get(name) ?? []), id]);
  for (const layer of way.layers ?? []) layers.set(layer, (layers.get(layer) ?? 0) + 1);
}
console.log(
  `machines ${COLOURWAY_IDS.length}, distinct primaries ${new Set(COLOURWAY_IDS.map((i) => COLOURWAYS[i].primary)).size}`,
);
for (const [name, ids] of [...buckets].sort())
  console.log(name.padEnd(12), ids.length, ids.join(' '));
console.log('layers', Object.fromEntries(layers));
