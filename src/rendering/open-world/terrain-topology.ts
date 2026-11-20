/** Fine and parent material inputs drawn on the same native terrain mesh. */
interface TileSurface {
  position: Float32Array;
  normal: Float32Array;
  splat: Float32Array;
  shade: Float32Array;
}

interface Field {
  data: Float32Array;
  stride: number;
  first: number;
  end: number;
  tolerance: number;
}
function fields(surface: TileSurface): Field[] {
  return [
    { data: surface.position, stride: 3, first: 1, end: 2, tolerance: 0.00075 },
    { data: surface.normal, stride: 3, first: 0, end: 3, tolerance: 0.004 },
    { data: surface.splat, stride: 4, first: 0, end: 4, tolerance: 0.006 },
    { data: surface.shade, stride: 4, first: 0, end: 4, tolerance: 0.006 },
  ];
}
/** Bound the error over every fine triangle, not only an averaged height.
 * Each old and new triangle is within tolerance of the same affine plane,
 * hence their difference anywhere is at most twice the tolerance. Testing
 * both morph endpoints bounds every blend between them as well. */
function planar(inputs: readonly Field[], row: number, origin: number, span: number) {
  for (const f of inputs) {
    const stride = f.stride,
      first = origin * stride,
      across = span * stride,
      down = across * row;
    for (let c = f.first; c < f.end; c++) {
      const base = f.data[first + c],
        dx = (f.data[first + across + c] - base) / span,
        dz = (f.data[first + down + c] - base) / span;
      for (let z = 0; z <= span; z++) {
        let at = first + z * row * stride + c,
          predicted = base + dz * z;
        for (let x = 0; x <= span; x++, at += stride, predicted += dx) {
          if (!(Math.abs(f.data[at] - predicted) <= f.tolerance)) return false;
        }
      }
    }
  }
  return true;
}

/** Replace planar 8x8 or 4x4 patches with centre fans. All edge vertices
 * remain, including both sides of every coarse/fine boundary and all skirts.
 * Tiles with little to gain keep using the renderer's shared grid index. */
export function terrainPatchIndex(
  res: number,
  full: Uint16Array,
  fine: TileSurface,
  parent?: TileSurface,
) {
  if (res % 8 !== 0) return full;
  const row = res + 1,
    input = fields(fine);
  if (parent) input.push(...fields(parent));
  const out = new Uint16Array(full.length);
  let used = 0;
  function block(x: number, z: number, span: number) {
    const origin = z * row + x;
    if (planar(input, row, origin, span)) {
      const centre = origin + (span / 2) * (row + 1);
      const edge = (a: number, b: number) => {
        out[used++] = centre;
        out[used++] = b;
        out[used++] = a;
      };
      for (let k = 0; k < span; k++) {
        edge(origin + k, origin + k + 1);
        edge(origin + span + k * row, origin + span + (k + 1) * row);
        edge(origin + span * row + span - k, origin + span * row + span - k - 1);
        edge(origin + (span - k) * row, origin + (span - k - 1) * row);
      }
    } else if (span === 8) {
      block(x, z, 4);
      block(x + 4, z, 4);
      block(x, z + 4, 4);
      block(x + 4, z + 4, 4);
    } else {
      for (let j = z; j < z + span; j++) {
        const start = (j * res + x) * 6;
        out.set(full.subarray(start, start + span * 6), used);
        used += span * 6;
      }
    }
  }
  for (let z = 0; z < res; z += 8) for (let x = 0; x < res; x += 8) block(x, z, 8);
  const core = res * res * 6;
  if (core - used < core * 0.04) return full;
  out.set(full.subarray(core), used);
  return out.slice(0, used + full.length - core);
}
