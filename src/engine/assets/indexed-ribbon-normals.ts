/* Adapted from Three.js r180 BufferGeometry.computeVertexNormals / Vector3.
The MIT License

Copyright © 2010-2025 three.js authors

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in
all copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN
THE SOFTWARE.
*/

/** Area-weighted indexed normals with Three's Float32 accumulation and final
 * reciprocal-square-root order. Positions must already be Float32 converted.
 * No welding or cross-chunk smoothing: authored seams remain unchanged. */
export function indexedRibbonNormals(positions: Float32Array, indices: Uint16Array | Uint32Array) {
  if (positions.length % 3 || indices.length % 3) throw new Error('Invalid indexed ribbon buffers');
  const normals = new Float32Array(positions.length);
  for (let i = 0; i < indices.length; i += 3) {
    const a = indices[i] * 3,
      b = indices[i + 1] * 3,
      c = indices[i + 2] * 3;
    if (Math.max(a, b, c) >= positions.length) throw new Error('Ribbon index out of range');
    const cbx = positions[c] - positions[b],
      cby = positions[c + 1] - positions[b + 1],
      cbz = positions[c + 2] - positions[b + 2];
    const abx = positions[a] - positions[b],
      aby = positions[a + 1] - positions[b + 1],
      abz = positions[a + 2] - positions[b + 2];
    const x = cby * abz - cbz * aby,
      y = cbz * abx - cbx * abz,
      z = cbx * aby - cby * abx;
    // Read all three before writing, as Three does (also matters for repeated indices).
    const ax = normals[a] + x,
      ay = normals[a + 1] + y,
      az = normals[a + 2] + z;
    const bx = normals[b] + x,
      by = normals[b + 1] + y,
      bz = normals[b + 2] + z;
    const cx = normals[c] + x,
      cy = normals[c + 1] + y,
      cz = normals[c + 2] + z;
    normals[a] = ax;
    normals[a + 1] = ay;
    normals[a + 2] = az;
    normals[b] = bx;
    normals[b + 1] = by;
    normals[b + 2] = bz;
    normals[c] = cx;
    normals[c + 1] = cy;
    normals[c + 2] = cz;
  }
  for (let i = 0; i < normals.length; i += 3) {
    const x = normals[i],
      y = normals[i + 1],
      z = normals[i + 2];
    const reciprocal = 1 / (Math.sqrt(x * x + y * y + z * z) || 1);
    normals[i] = x * reciprocal;
    normals[i + 1] = y * reciprocal;
    normals[i + 2] = z * reciprocal;
  }
  return normals;
}
