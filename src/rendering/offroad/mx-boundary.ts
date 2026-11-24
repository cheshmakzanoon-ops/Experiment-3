import * as T from 'three';
import { mxFootprintMatrix } from './mx-ground-pose.ts';
import { mxPaddingGeometry, mxPaddingMaterial } from './mx-padding.ts';
import { fitMxPadContact, prepareMxPadContact } from './mx-pad-contact.ts';
import { mod } from '../../core/math.ts';
import { TrackTerrainSurface } from '../../simulation/offroad/course-terrain.ts';
import { Track, trackPoint } from '../../simulation/track.ts';

export const MX_BOUNDARY = Object.freeze({
  width: 0.68,
  height: 0.58,
  length: 2.1,
  spacing: 2.5,
});

export function isMotocrossVenue(track: Track) {
  const kind = track.circuit.offroad?.kind;
  return kind === 'motocross' || kind === 'supercross';
}

/** Low canvas-covered pads mark the actual collision boundary. A complete
 * footprint check prevents a neighboring hairpin's boundary from drawing
 * walls across a rideable SX lane. The nearer stakes still mark legal track
 * width; this outer row marks the hard limit beyond the shoulder. */
export function buildMotocrossBoundary(track: Track) {
  const surface = Track.offroadOf(track);
  if (!(surface instanceof TrackTerrainSurface) || !isMotocrossVenue(track))
    throw new Error('Motocross boundary requires an MX or SX terrain course');
  const root = new T.Group();
  root.name = 'MX physical boundary padding';
  const p = trackPoint(),
    q = trackPoint(),
    sections = [new Map<string, T.Matrix4[]>(), new Map<string, T.Matrix4[]>()];
  let rejected = 0, pads = 0;
  const { width, height, length, spacing } = MX_BOUNDARY;
  // The wider outdoor sight lines benefit from fewer, larger batches.
  const cellSize = surface.course.kind === 'motocross' ? 64 : 48;
  for (let s = spacing / 2; s < track.length; s += spacing) {
    track.at(s, p);
    for (const side of [-1, 1] as const) {
      const lateral = side * (track.boundaryAt(p, side) + width / 2),
        x = p.x + p.nx * lateral,
        z = p.z + p.nz * lateral;
      let clear = true;
      // Include the centre and all four horizontal corners, independently
      // of the source station: short-radius curves can fold into another lane.
      for (const [along, across] of [
        [0, 0],
        [-length / 2, -width / 2],
        [-length / 2, width / 2],
        [length / 2, -width / 2],
        [length / 2, width / 2],
      ]) {
        const l = track.nearest(
          x + p.tx * along + p.nx * across,
          z + p.tz * along + p.nz * across,
          q,
        );
        const gap = Math.abs(mod(q.s - s + track.length / 2, track.length) - track.length / 2);
        if (gap > 8 && Math.abs(l) < surface.course.legalWidth(q.width, q.s, l) + 0.15) {
          clear = false;
          break;
        }
      }
      if (!clear) {
        rejected++;
        continue;
      }
      // The canvas sits slightly into the soil along its surface normal.
      // On a takeoff or berm all four corners follow the course grade.
      const family = sections[Math.floor(s / (spacing * 3)) % 2];
      const key = Math.floor(x / cellSize) + ',' + Math.floor(z / cellSize);
      let run = family.get(key);
      if (!run) {
        run = [];
        family.set(key, run);
      }
      run.push(mxFootprintMatrix(track, x, z, Math.atan2(p.tx, p.tz), width, length, height / 2 - 0.012));
      pads++;
    }
  }
  // Each camera and each directional shadow can reject an entire area
  // before evaluating its six fitted hem morphs. All sections share the
  // original cage and the two printed fabrics, including in reflections.
  const geometry = mxPaddingGeometry();
  prepareMxPadContact(geometry);
  for (const [tint, cells] of sections.entries()) {
    if (!cells.size) continue;
    const material = mxPaddingMaterial(tint === 1);
    for (const [cell, matrices] of cells) {
      const mesh = new T.InstancedMesh(geometry, material, matrices.length);
      mesh.name = `MX boundary pads ${tint ? 'pale' : 'dark'} · ${cell}`;
      fitMxPadContact(track, mesh, matrices);
      mesh.castShadow = mesh.receiveShadow = true;
      mesh.computeBoundingSphere();
      root.add(mesh);
    }
  }
  root.userData.boundaryPads = pads;
  root.userData.rejectedLaneFootprints = rejected;
  return root;
}
