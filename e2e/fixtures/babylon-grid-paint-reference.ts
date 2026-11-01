import * as T from 'three';
import { GridPaintPresentation } from '../../src/rendering/grid-paint.ts';
import { installCircuitFinish } from '../../src/rendering/circuit-finish.ts';
import { surfaceGridFor } from '../../src/rendering/studio/road-detail.ts';
import { clamp } from '../../src/core/math.ts';
import { trackPoint, type Track } from '../../src/simulation/track.ts';
import { circuitRibbonData } from '../../src/engine/assets/circuit-ribbon-data.ts';
import { apexLineAt } from '../../src/engine/assets/circuit-line-profile.ts';

/** Fixture-only setup transaction: retain partial reports and drain each exact
 * registered owner even when setup/cleanup throws a falsy value. */
export async function gridProbeTransaction<T extends { failure: string | null }>(
  report: T,
  work: (cleanup: (() => void)[]) => Promise<void>,
) {
  const cleanup: (() => void)[] = [];
  try {
    await work(cleanup);
  } catch (error) {
    report.failure = error instanceof Error ? (error.stack ?? error.message) : String(error);
  } finally {
    for (const dispose of cleanup)
      try {
        dispose();
      } catch (error) {
        report.failure ??= String(error);
      }
  }
  return report;
}

export const GRID_FACTOR_LIMITS = Object.freeze({ max: 2, mean: 0.25, coverageMismatchPixels: 8 });
export const GRID_VIEWS = [
  { name: 'front-top', row: 0, eye: [0, 12, -0.01], extent: 7, depth: true },
  { name: 'rear-top', row: 4, eye: [0, 12, -0.01], extent: 7, depth: true },
  { name: 'middle-oblique', row: 2, eye: [5, 12, -7], extent: 7, depth: false },
  { name: 'rear-underside', row: 5, eye: [0, -12, -0.01], extent: 7, depth: false },
] as const;
export const GRID_DEPTH_COUNTS = Object.freeze({
  'front-top': { visible: 162, occluded: 0, total: 162 },
  'rear-top': { visible: 153, occluded: 9, total: 162 },
});
export function gridRoadRange(track: Track) {
  const grid = surfaceGridFor(track),
    count = Math.ceil(track.length / 80);
  const first = Math.floor(
    ((track.length - grid.front - (grid.rows - 1) * grid.spacing - 8) * count) / track.length,
  );
  const last = Math.min(count, Math.ceil(((track.length - grid.front + 8) * count) / track.length));
  return {
    start: (track.length * first) / count,
    end: (track.length * last) / count,
    first,
    last,
    count,
  };
}
export function gridViewPose(track: Track, row: number, eye: readonly number[]) {
  const grid = surfaceGridFor(track),
    p = track.at(track.length - grid.front - row * grid.spacing, trackPoint());
  const root = new T.Matrix4().makeRotationY(Math.atan2(p.tx, p.tz));
  root.setPosition(p.x, p.y, p.z);
  return {
    eye: new T.Vector3(eye[0], eye[1], eye[2]).applyMatrix4(root),
    target: new T.Vector3(0, 0.012, 0).applyMatrix4(root),
  };
}
/** Actual original Three presentation, not reconstructed from candidate buffers.
 * The pre-existing frozen originalGrid CPU oracle independently guards this helper. */
export function originalGridReference(track: Track) {
  const material = new T.MeshStandardMaterial({ color: 0xe9e7e0, roughness: 0.55 });
  const root = new T.Group(),
    meshes: T.Mesh<T.BufferGeometry, T.MeshStandardMaterial>[] = [];
  let disposed = false;
  const dispose = () => {
    if (disposed) return;
    disposed = true;
    const errors: unknown[] = [];
    const geometry = new Set<T.BufferGeometry>();
    root.traverse((node) => {
      if (node instanceof T.Mesh) geometry.add(node.geometry);
    });
    for (const owned of [...geometry, material])
      try {
        owned.dispose();
      } catch (error) {
        errors.push(error);
      }
    if (errors.length) throw errors[0];
  };
  try {
    installCircuitFinish(material, 'paint');
    const presentation = new GridPaintPresentation(track, material);
    presentation.build(root);
    root.updateMatrixWorld(true);
    root.traverseVisible((node) => {
      if (node instanceof T.Mesh) meshes.push(node);
    });
    return { root, material, meshes, dispose };
  } catch (error) {
    try {
      dispose();
    } catch {
      /* preserve original failure */
    }
    throw error;
  }
}
/** Original ribbon producer with unchanged range/step/columns. Its independent
 * frozen CPU oracles establish producer equivalence; no native geometry readback. */
export function originalGridRoadReference(track: Track) {
  const point = trackPoint(),
    range = gridRoadRange(track),
    root = new T.Group(),
    meshes: T.Mesh<T.BufferGeometry, T.MeshBasicMaterial>[] = [],
    owned: { dispose(): void }[] = [];
  let disposed = false;
  const dispose = () => {
    if (disposed) return;
    disposed = true;
    const errors: unknown[] = [];
    for (const resource of owned)
      try {
        resource.dispose();
      } catch (error) {
        errors.push(error);
      }
    if (errors.length) throw errors[0];
  };
  try {
    for (let part = range.first; part < range.last; part++) {
      const data = circuitRibbonData(
        track,
        {
          start: (track.length * part) / range.count,
          end: (track.length * (part + 1)) / range.count,
          columns: 14,
          road: true,
          step: 1.8,
          offset: (s, t) => (t * 2 - 1) * track.at(s, point).width,
        },
        {
          hasGpDesign: () => false,
          apex: (s, l, out, motorcycle) => apexLineAt(track, s, l, out, motorcycle),
          color: () => ({ r: 0, g: 0, b: 0 }),
          kerbStyle: () => {
            throw new Error('Unexpected reference kerb');
          },
          runoffStyle: () => {
            throw new Error('Unexpected reference runoff');
          },
          usage: () => {
            throw new Error('Unexpected reference usage');
          },
          gpPaint: () => {
            throw new Error('Unexpected reference GP paint');
          },
          gpGravel: () => {
            throw new Error('Unexpected reference gravel');
          },
        },
      );
      const geometry = new T.BufferGeometry();
      owned.push(geometry);
      geometry.setAttribute('position', new T.BufferAttribute(new Float32Array(data.vertices), 3));
      geometry.setIndex(data.indices);
      const material = new T.MeshBasicMaterial({ color: 0xff00ff, toneMapped: false });
      owned.push(material);
      const mesh = new T.Mesh(geometry, material);
      root.add(mesh);
      meshes.push(mesh);
    }
    root.updateMatrixWorld(true);
    return { root, meshes, dispose };
  } catch (error) {
    try {
      dispose();
    } catch {
      /* preserve original failure */
    }
    throw error;
  }
}
/** Preregistered stroke-centre coordinates, all 3x3 pixels retained. No pixel
 * selection from candidate colors or observed errors. Missing/tied rays fail. */
export function gridDepthSamples(
  track: Track,
  row: number,
  camera: T.OrthographicCamera,
  meshes: T.Mesh[],
  road: T.Object3D,
  width: number,
  height: number,
) {
  const grid = surfaceGridFor(track),
    station = track.length - grid.front - row * grid.spacing;
  const p = track.at(station, trackPoint()),
    ray = new T.Raycaster();
  const samples: {
    slot: number;
    x: number;
    z: number;
    px: number;
    py: number;
    gap: number;
    visible: boolean;
  }[] = [];
  for (const side of [-1, 1]) {
    const lateral = side * grid.lateral,
      matrix = new T.Matrix4().makeRotationY(Math.atan2(p.tx, p.tz));
    matrix.setPosition(
      p.x + p.nx * lateral,
      p.y + p.bank * clamp(lateral, -12, 12) + 0.012,
      p.z + p.nz * lateral,
    );
    const points = [-1.1, 1.1]
      .flatMap((x) => [-1, 0, 1].map((z) => ({ x, z })))
      .concat([-0.65, 0, 0.65].map((x) => ({ x, z: 2 })));
    for (const { x, z } of points) {
      const ndc = new T.Vector3(x, 0.005, z).applyMatrix4(matrix).project(camera);
      const cx = Math.floor(((ndc.x + 1) * width) / 2),
        cy = Math.floor(((ndc.y + 1) * height) / 2);
      for (let dy = -1; dy <= 1; dy++)
        for (let dx = -1; dx <= 1; dx++) {
          const px = cx + dx,
            py = cy + dy;
          if (px < 0 || py < 0 || px >= width || py >= height)
            throw new Error('Fixed grid patch outside viewport');
          ray.setFromCamera(
            new T.Vector2(((px + 0.5) / width) * 2 - 1, ((py + 0.5) / height) * 2 - 1),
            camera,
          );
          const paintHit = ray.intersectObjects(meshes, false)[0],
            roadHit = ray.intersectObject(road, true)[0];
          if (!paintHit || !roadHit) throw new Error('Fixed grid patch missing original triangle');
          const gap = roadHit.distance - paintHit.distance;
          if (Math.abs(gap) <= 1e-5)
            throw new Error('Fixed grid patch has ambiguous original depth');
          samples.push({
            slot: row * 2 + (side === -1 ? 0 : 1),
            x,
            z,
            px,
            py,
            gap,
            visible: gap > 0,
          });
        }
    }
  }
  return samples;
}
