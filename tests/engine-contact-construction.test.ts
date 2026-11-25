import { Buffer } from 'node:buffer';
import { describe, expect, it, vi } from 'vitest';
import { clamp, Vec3 } from '../src/core/math.ts';
import { circuitDefinition } from '../src/simulation/circuits.ts';
import { TrackContactMesh, kerbHeight, trackHeight } from '../src/simulation/contact.ts';
import { apronWidth, GP_KERB_WIDTH } from '../src/simulation/gp-course-edges.ts';
import { Track } from '../src/simulation/track.ts';

const BANDS = [-35, -12, -4, -1.1, -0.55, 0, 0.18, 100, 0.18, 0, 0.55, 1.1, 4, 12, 35];
const COLUMNS = BANDS.length;

/** Frozen geometry loop from 1c609bf. Keep its original array/set operations
 * independent of the scalar stores under test. The unchanged height helpers
 * are shared so this isolates construction, not authored venue content. */
function originalGeometry(track: Track, rows: number) {
  const p = { ...track.points[0] };
  const bands = BANDS,
    columns = COLUMNS;
  const vertices = new Float64Array((rows + 1) * columns * 3);
  const normals = new Float64Array(vertices.length);
  const indices = new Uint32Array(rows * (columns - 1) * 6);
  const n = new Vec3();
  for (let row = 0; row <= rows; row++) {
    track.at((row * track.length) / rows, p);
    const left = track.gpEdges?.at(p.s, -1) ?? 1;
    const right = track.gpEdges?.at(p.s, 1) ?? 1;
    for (let col = 0; col < columns; col++) {
      const amount = col < 7 ? left : right;
      let lateral: number;
      if (col === 0 || col === columns - 1) lateral = bands[col];
      else if (col === 7) lateral = 0;
      else if (col < 7) lateral = -p.width + bands[col];
      else lateral = p.width + bands[col];
      if (amount < 1) {
        const side = col < 7 ? -1 : 1;
        if (col === 2 || col === 12) lateral = side * (p.width + apronWidth(amount));
        if (col === 3 || col === 4 || col === 10 || col === 11)
          lateral = side * (p.width + Math.abs(bands[col]) * Math.max(0.04, amount));
      }
      // Asphalt/paint bands approach the kerb from the inside.
      if (col === 6) lateral = -p.width + 0.18;
      if (col === 8) lateral = p.width - 0.18;
      const inPit = track.inPitLane(p.s, lateral);
      const height = inPit
        ? p.y + p.bank * clamp(lateral, -12, 12)
        : trackHeight(p.y, p.bank, p.s, lateral, p.width, amount);
      const i = (row * columns + col) * 3;
      vertices[i] = p.x + p.nx * lateral;
      vertices[i + 1] = height;
      vertices[i + 2] = p.z + p.nz * lateral;
      const across = Math.abs(lateral) - p.width;
      const sideDerivative =
        !inPit && across > 0 && across < GP_KERB_WIDTH * amount
          ? ((kerbHeight(p.s, across + 0.005, amount) - kerbHeight(p.s, across - 0.005, amount)) /
              0.01) *
            Math.sign(lateral)
          : 0;
      const alongDerivative =
        !inPit && across > 0 && across < GP_KERB_WIDTH * amount
          ? (kerbHeight(p.s + 0.005, across, track.gpEdges?.at(p.s + 0.005, lateral) ?? 1) -
              kerbHeight(p.s - 0.005, across, track.gpEdges?.at(p.s - 0.005, lateral) ?? 1)) /
            0.01
          : 0;
      const bank = Math.abs(lateral) < 12 ? p.bank : 0;
      n.set(
        -p.tx * (p.gradient + alongDerivative) - p.nx * (bank + sideDerivative),
        1,
        -p.tz * (p.gradient + alongDerivative) - p.nz * (bank + sideDerivative),
      ).normalize();
      normals.set([n.x, n.y, n.z], i);
      if (row < rows && col < columns - 1) {
        const a = row * columns + col,
          b = a + 1,
          c = a + columns,
          d = c + 1;
        indices.set([a, c, b, b, c, d], (row * (columns - 1) + col) * 6);
      }
    }
  }
  return { vertices, normals, indices };
}

function bytes(array: Float64Array | Uint32Array) {
  return Buffer.from(array.buffer, array.byteOffset, array.byteLength);
}

function arraySetWork(run: () => void) {
  const work = { normalArrays: 0, normalEntries: 0, indexArrays: 0, indexEntries: 0 };
  const floatSet = Float64Array.prototype.set;
  const uintSet = Uint32Array.prototype.set;
  const normals = vi.spyOn(Float64Array.prototype, 'set').mockImplementation(function (
    this: Float64Array,
    source: ArrayLike<number>,
    offset?: number,
  ) {
    if (Array.isArray(source)) {
      work.normalArrays++;
      work.normalEntries += source.length;
    }
    floatSet.call(this, source, offset);
  });
  const indices = vi.spyOn(Uint32Array.prototype, 'set').mockImplementation(function (
    this: Uint32Array,
    source: ArrayLike<number>,
    offset?: number,
  ) {
    if (Array.isArray(source)) {
      work.indexArrays++;
      work.indexEntries += source.length;
    }
    uintSet.call(this, source, offset);
  });
  try {
    run();
    return work;
  } finally {
    normals.mockRestore();
    indices.mockRestore();
  }
}

describe('contact ribbon scalar construction', () => {
  it.each([
    ['aurel', 1],
    ['aurel', 2],
    ['aurel', 31],
    ['poggio-alto', 257],
    ['ardennes', 128],
    ['aurel', 8192],
  ] as const)('preserves all geometry bytes for %s at %i rows', (id, rows) => {
    const track = new Track('rain', false, undefined, circuitDefinition(id));
    const expected = originalGeometry(track, rows);
    // Exercise the actual default parameter at production resolution.
    const mesh = rows === 8192 ? new TrackContactMesh(track) : new TrackContactMesh(track, rows);
    expect(mesh.rows).toBe(rows);
    for (const name of ['vertices', 'normals', 'indices'] as const) {
      expect(mesh[name].byteLength).toBe(expected[name].byteLength);
      expect(Buffer.compare(bytes(mesh[name]), bytes(expected[name])), name).toBe(0);
    }
  });

  it('closes the terminal row and keeps both triangles facing the original way', () => {
    const mesh = new TrackContactMesh(new Track(), 32);
    const rowSize = COLUMNS * 3;
    for (const array of [mesh.vertices, mesh.normals])
      expect(
        Buffer.compare(bytes(array.subarray(0, rowSize)), bytes(array.subarray(-rowSize))),
      ).toBe(0);
    expect(Array.from(mesh.indices.subarray(0, 6))).toEqual([0, 15, 1, 1, 15, 16]);
    expect(Array.from(mesh.indices.subarray(-6))).toEqual([478, 493, 479, 479, 493, 494]);
    expect(mesh.indices.length).toBe(32 * 14 * 6);
  });

  it('eliminates the original per-vertex and per-cell temporary arrays', () => {
    const track = new Track('clear', false, undefined, circuitDefinition('poggio-alto'));
    const rows = 17;
    const before = arraySetWork(() => {
      originalGeometry(track, rows);
    });
    const after = arraySetWork(() => {
      new TrackContactMesh(track, rows);
    });
    expect(before).toEqual({
      normalArrays: (rows + 1) * 15,
      normalEntries: (rows + 1) * 15 * 3,
      indexArrays: rows * 14,
      indexEntries: rows * 14 * 6,
    });
    expect(after).toEqual({ normalArrays: 0, normalEntries: 0, indexArrays: 0, indexEntries: 0 });
  });
});
