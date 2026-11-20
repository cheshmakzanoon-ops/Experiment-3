import * as T from 'three';
import { Random, clamp } from '../../core/math.ts';
import { mxAuthoredGeometry } from './authored-kit.ts';

const WIDTH = 512,
  HEIGHT = 256,
  GUTTER = 4;
const PANELS = [
  { x: 0, y: 0, w: WIDTH, h: 128, metresX: 2.1, metresY: 0.58 }, // side
  { x: 0, y: 128, w: 384, h: 128, metresX: 2.1, metresY: 0.68 }, // crown
  { x: 384, y: 128, w: 128, h: 128, metresX: 0.68, metresY: 0.58 }, // end
] as const;

/** Keep the Blender cage and its normals. Its six UV islands each use the
 * full square. Give the two long sides, crown/base and end gussets their own
 * cut of cloth. Split a UV vertex only when two panels actually share it. */
export function mxPaddingGeometry(finish: 'race' | 'post' = 'race') {
  const g = mxAuthoredGeometry('safety-pad', 'mid');
  const position = g.getAttribute('position'),
    normal = g.getAttribute('normal'),
    uv = g.getAttribute('uv');
  const source = g.index!,
    positions: number[] = [],
    normals: number[] = [],
    uvs: number[] = [],
    indices: number[] = [];
  const variants = new Map<number, number>();
  const a = new T.Vector3(),
    b = new T.Vector3(),
    c = new T.Vector3();
  for (let face = 0; face < source.count; face += 3) {
    const ia = source.getX(face),
      ib = source.getX(face + 1),
      ic = source.getX(face + 2);
    a.fromBufferAttribute(position, ia);
    b.fromBufferAttribute(position, ib).sub(a);
    c.fromBufferAttribute(position, ic).sub(a);
    b.cross(c);
    const x = Math.abs(b.x),
      y = Math.abs(b.y),
      z = Math.abs(b.z);
    const panel = finish === 'post' ? 1 : x > y && x > z ? 0 : y > z ? 1 : 2,
      tile = PANELS[panel];
    for (const i of [ia, ib, ic]) {
      const key = i * 3 + panel;
      let index = variants.get(key);
      if (index === undefined) {
        index = positions.length / 3;
        variants.set(key, index);
        positions.push(position.getX(i), position.getY(i), position.getZ(i));
        normals.push(normal.getX(i), normal.getY(i), normal.getZ(i));
        uvs.push(
          (tile.x + GUTTER + uv.getX(i) * (tile.w - 2 * GUTTER)) / WIDTH,
          1 - (tile.y + GUTTER + (1 - uv.getY(i)) * (tile.h - 2 * GUTTER)) / HEIGHT,
        );
      }
      indices.push(index);
    }
  }
  g.setAttribute('position', new T.Float32BufferAttribute(positions, 3));
  g.setAttribute('normal', new T.Float32BufferAttribute(normals, 3));
  g.setAttribute('uv', new T.Float32BufferAttribute(uvs, 2));
  g.setIndex(indices);
  return g;
}

function paddingPrint(pale: boolean) {
  if (typeof document === 'undefined') return null;
  const canvas = document.createElement('canvas');
  canvas.width = WIDTH;
  canvas.height = HEIGHT;
  const c = canvas.getContext('2d');
  if (!c) throw new Error('Motocross canvas padding requires a 2D canvas');
  const random = new Random(pale ? 1003 : 1002);
  const base = pale ? '#c4bfab' : '#384941',
    ink = pale ? '#344238' : '#dfddca';
  PANELS.forEach((tile, panel) => {
    c.save();
    c.translate(tile.x, tile.y);
    c.beginPath();
    c.rect(0, 0, tile.w, tile.h);
    c.clip();
    c.fillStyle = base;
    c.fillRect(0, 0, tile.w, tile.h);
    const x = GUTTER,
      y = GUTTER,
      w = tile.w - 2 * x,
      h = tile.h - 2 * y;
    c.translate(x, y);
    c.strokeStyle = pale ? '#aba896' : '#4c5950';
    c.lineWidth = 2;
    c.strokeRect(w * 0.035, h * 0.075, w * 0.93, h * 0.85);
    c.lineWidth = 0.9;
    c.setLineDash([2.5, 2]);
    c.strokeRect(w * 0.038, h * 0.094, w * 0.924, h * 0.812);
    c.setLineDash([]);
    if (panel === 0) {
      // The visible long faces carry the event print. Leave both end caps
      // and the top panel free of stretched duplicates of the wordmark.
      c.fillStyle = ink;
      c.save();
      c.translate(w * 0.205, h * 0.46);
      c.transform(1, 0, -0.31, 1, 0, 0);
      c.fillRect(-16, -11, 6, 22);
      c.fillRect(-6, -11, 11, 22);
      c.restore();
      c.textAlign = 'left';
      c.font = 'italic 800 32px sans-serif';
      c.fillText('MOTOBOUND', w * 0.245, h * 0.55, w * 0.52);
    }
    const bands = panel < 2 ? [0.11, 0.89] : [];
    for (const u of bands) {
      c.fillStyle = pale ? '#938f7e' : '#26342e';
      c.fillRect((u - 0.016) * w, 0, 0.032 * w, h);
      c.strokeStyle = pale ? '#bbb7a4' : '#657065';
      c.setLineDash([2, 2]);
      for (const edge of [-0.011, 0.011]) {
        c.beginPath();
        c.moveTo((u + edge) * w, 0);
        c.lineTo((u + edge) * w, h);
        c.stroke();
      }
      c.setLineDash([]);
    }
    if (panel === 2) {
      // Folded webbing handle and two reinforcement boxes on the end gusset.
      c.fillStyle = pale ? '#938f7f' : '#26332e';
      c.fillRect(w * 0.23, h * 0.36, w * 0.54, h * 0.12);
      c.strokeStyle = pale ? '#cac6b6' : '#6d766b';
      for (const at of [0.23, 0.66]) {
        c.strokeRect(w * at, h * 0.35, w * 0.11, h * 0.14);
        c.beginPath();
        c.moveTo(w * at, h * 0.35);
        c.lineTo(w * (at + 0.11), h * 0.49);
        c.moveTo(w * at, h * 0.49);
        c.lineTo(w * (at + 0.11), h * 0.35);
        c.stroke();
      }
    }
    // Damp earth darkens the portion touching the soil. Scrapes on the
    // crown are sparse, while the bottom edges carry a heavier spray.
    const count = panel === 0 ? 420 : 220;
    for (let i = 0; i < count; i++) {
      const px = random.next() * w,
        py = (panel === 1 ? random.next() : Math.sqrt(random.next())) * h;
      c.fillStyle =
        'rgba(53,38,23,' +
        ((panel === 1 ? 0.035 : 0.15 * (py / h) ** 2) * (0.2 + random.next())).toFixed(3) +
        ')';
      c.beginPath();
      c.ellipse(
        px,
        py,
        1 + random.next() * 8,
        0.5 + random.next() * 3,
        random.next() - 0.5,
        0,
        2 * Math.PI,
      );
      c.fill();
    }
    c.restore();
  });
  const map = new T.CanvasTexture(canvas);
  map.name = 'MX safety padding panel print';
  map.colorSpace = T.SRGBColorSpace;
  map.anisotropy = 4;
  return map;
}

/** Bake the sewing, handle stand-off and fabric wrinkles in panel metres.
 * The same height field shapes highlights on the printed sides and blank
 * ends. Only the surface maps change, so rain, floodlights and shadows all
 * light the same solid mesh that defines the edge of the course. */
function paddingSurface() {
  const normal = new Uint8Array(WIDTH * HEIGHT * 4);
  const rough = new Uint8Array(WIDTH * HEIGHT * 2);
  PANELS.forEach((tile, panel) => {
    const { w, h } = tile;
    const scaleX = tile.metresX / (w - 2 * GUTTER),
      scaleY = tile.metresY / (h - 2 * GUTTER);
    const heights = new Float32Array(w * h);
    for (let y = 0; y < h; y++)
      for (let x = 0; x < w; x++) {
        const u = clamp((x - GUTTER) / (w - 2 * GUTTER), 0, 1),
          v = clamp((y - GUTTER) / (h - 2 * GUTTER), 0, 1);
        const edge = Math.min(
          Math.abs(Math.min(u, 1 - u) - 0.035) * tile.metresX,
          Math.abs(Math.min(v, 1 - v) - 0.075) * tile.metresY,
        );
        const hem = Math.exp(-((edge / 0.007) ** 2));
        const web =
          panel < 2
            ? 1 - T.MathUtils.smoothstep(Math.abs(Math.min(u, 1 - u) - 0.11), 0.013, 0.018)
            : 0;
        const handle =
          panel === 2
            ? T.MathUtils.smoothstep(u, 0.221, 0.247) *
              (1 - T.MathUtils.smoothstep(u, 0.753, 0.779)) *
              T.MathUtils.smoothstep(v, 0.344, 0.373) *
              (1 - T.MathUtils.smoothstep(v, 0.467, 0.494))
            : 0;
        // The cover is tight below the retaining straps; creases fan out
        // near each corner and fade over the broad, tensioned centre.
        const nearEnd = 1 - T.MathUtils.smoothstep(Math.min(u, 1 - u), 0.02, 0.33);
        const crease = Math.sin(43 * v + 24 * Math.min(u, 1 - u) + 3.6 * Math.sin(v * 5)) * nearEnd;
        const fibre = Math.sin(x * 1.72 + 0.7 * Math.sin(y * 1.34)) * Math.cos(y * 1.34);
        heights[y * w + x] =
          0.0024 * hem +
          0.0026 * web +
          0.009 * handle +
          (1 - web) * (0.0023 * crease + 0.0004 * fibre);
        const k = ((HEIGHT - 1 - tile.y - y) * WIDTH + tile.x + x) * 2;
        rough[k + 1] = Math.round(204 + 18 * web + 7 * fibre + (panel === 1 ? -12 : 18 * v * v));
      }
    for (let y = 0; y < h; y++)
      for (let x = 0; x < w; x++) {
        const l = Math.max(0, x - 1),
          r = Math.min(w - 1, x + 1);
        const t = Math.max(0, y - 1),
          b = Math.min(h - 1, y + 1);
        const dx = (heights[y * w + r] - heights[y * w + l]) / ((r - l) * scaleX);
        // V points upward in the authored UVs, y grows down the canvas.
        const dy = (heights[t * w + x] - heights[b * w + x]) / ((b - t) * scaleY);
        const inv = 1 / Math.hypot(dx, dy, 1);
        const k = ((HEIGHT - 1 - tile.y - y) * WIDTH + tile.x + x) * 4;
        normal[k] = Math.round(127.5 * (1 - dx * inv));
        normal[k + 1] = Math.round(127.5 * (1 - dy * inv));
        normal[k + 2] = Math.round(127.5 * (1 + inv));
        normal[k + 3] = 255;
      }
  });
  return { normal, rough };
}

// Both colourways and the SX dividers use the same cut and surface finish.
// Share CPU pixels; each material owns and disposes its own texture handles.
let surface: ReturnType<typeof paddingSurface> | undefined;
export function mxPaddingMaterial(pale = false) {
  const map = paddingPrint(pale);
  surface ??= paddingSurface();
  const weave = new T.DataTexture(surface.normal, WIDTH, HEIGHT);
  const roughness = new T.DataTexture(surface.rough, WIDTH, HEIGHT, T.RGFormat);
  for (const texture of [weave, roughness]) {
    texture.magFilter = T.LinearFilter;
    texture.minFilter = T.LinearMipmapLinearFilter;
    texture.generateMipmaps = true;
    texture.anisotropy = 4;
    texture.needsUpdate = true;
  }
  return new T.MeshStandardMaterial({
    name: 'MX stitched and scuffed canvas padding',
    color: map ? 0xffffff : pale ? 0xc4bda7 : 0x344541,
    map,
    roughness: 1,
    roughnessMap: roughness,
    normalMap: weave,
  });
}
