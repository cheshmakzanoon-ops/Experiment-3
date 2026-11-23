import { Mesh, PerspectiveCamera, Sphere, Vector3 } from 'three';
import { cameraDetailDistance } from './camera-detail.ts';

const bounds = new Sphere();
const eye = new Vector3();

/** A GP kerb has sixteen-centimetre rows to resolve tyre-scale corrugations.
 * Keep the surveyed cross-section, endpoints and pit cut-outs at every lens
 * distance. The fragment material supplies the metre-locked paint and ridges. */
export function installGpKerbDetail(
  mesh: Mesh,
  original: number[],
  rows: number,
  columns: number,
  ascending: boolean,
  field?: { value: number },
) {
  const full = original.length;
  if (full === 0 || rows < 12) return;
  const rowStart = new Uint32Array(rows + 1);
  let cursor = 0;
  for (let row = 0; row < rows; row++) {
    rowStart[row] = cursor;
    while (cursor < full && Math.floor(original[cursor] / (columns + 1)) === row) cursor += 6;
  }
  rowStart[rows] = full;
  const append = (stride: number) => {
    const start = original.length;
    for (let row = 0; row < rows; ) {
      if (rowStart[row + 1] - rowStart[row] !== columns * 6) {
        // Copy every surviving cell on a partially clipped row.
        for (let i = rowStart[row]; i < rowStart[row + 1]; i++) original.push(original[i]);
        row++;
        continue;
      }
      let end = row + 1;
      while (end < rows && end - row < stride && rowStart[end + 1] - rowStart[end] === columns * 6)
        end++;
      for (let col = 0; col < columns; col++) {
        const a = row * (columns + 1) + col;
        const b = end * (columns + 1) + col;
        if (ascending) original.push(a, b, a + 1, b, b + 1, a + 1);
        else original.push(a, a + 1, b, b, a + 1, b + 1);
      }
      row = end;
    }
    return original.length - start;
  };
  const mid = append(3);
  const far = append(9);
  const g = mesh.geometry;
  // All passes share the resident vertex attributes and one GPU index buffer.
  // Full-density normals have already been computed on the physical grid.
  g.setIndex(original);
  g.setDrawRange(0, full);
  g.computeBoundingSphere();
  mesh.onBeforeRender = (_renderer, _scene, camera) => {
    let distance = 0;
    if ((!field || field.value > 0) && camera instanceof PerspectiveCamera) {
      bounds.copy(g.boundingSphere!).applyMatrix4(mesh.matrixWorld);
      eye.setFromMatrixPosition(camera.matrixWorld);
      distance = cameraDetailDistance(Math.max(0, bounds.distanceToPoint(eye)), camera);
    }
    if (distance >= 85) g.setDrawRange(full + mid, far);
    else if (distance >= 25) g.setDrawRange(full, mid);
    else g.setDrawRange(0, full);
  };
}
