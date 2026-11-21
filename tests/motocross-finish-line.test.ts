import * as T from 'three';
import { expect, it } from 'vitest';
import { mxOutdoorFinish, mxArenaFinish } from '../src/rendering/offroad/mx-finish-line.ts';
import { rigTrack } from '../src/simulation/offroad/jump-rig.ts';
import { Track, trackPoint } from '../src/simulation/track.ts';
import { TrackTerrainSurface } from '../src/simulation/offroad/course-terrain.ts';

for (const id of ['valley-ridge-mx', 'arena-nord-sx'] as const)
  it(`places two readable finish faces at the ${id} scoring loop with clear lanes under the span`, () => {
    const track = rigTrack(id),
      p = track.at(0, trackPoint()),
      q = trackPoint();
    const course = (Track.offroadOf(track) as TrackTerrainSurface).course;
    const roof = { minZ: -80, spanZ: 155, chordY: 31.2 };
    const indoor = id === 'arena-nord-sx';
    const rig = indoor ? mxArenaFinish(track, roof) : mxOutdoorFinish(track);
    const material = new T.MeshBasicMaterial();
    try {
      const eye = new T.Vector3(p.x, p.y + 5.9, p.z),
        nose = new T.Vector3(p.tx, 0, p.tz);
      for (const side of [-1, 1]) {
        const eyeToBoard = new T.Raycaster(
          eye.clone().addScaledVector(nose, 10 * side),
          nose.clone().multiplyScalar(-side),
        );
        const face = rig.print.flatMap((g) =>
          eyeToBoard.intersectObject(new T.Mesh(g, material)),
        )[0];
        expect(face).toBeDefined();
        expect(face.distance).toBeCloseTo(10, 0);
        const lateral = new T.Vector3(p.nx, 0, p.nz);
        eyeToBoard.ray.origin.addScaledVector(lateral, 0.6 * side);
        const second = rig.print.flatMap((g) =>
          eyeToBoard.intersectObject(new T.Mesh(g, material)),
        )[0];
        expect(second.uv!.x).toBeGreaterThan(face.uv!.x);
      }
      for (const g of Object.values(rig).flat()) {
        const pos = g.getAttribute('position');
        for (let i = 0; i < pos.count; i++) {
          const x = pos.getX(i),
            y = pos.getY(i),
            z = pos.getZ(i);
          expect(Number.isFinite(x + y + z)).toBe(true);
          if (y < p.y + 4.8) {
            expect(indoor).toBe(false);
            const l = track.nearest(x, z, q);
            expect(Math.abs(l)).toBeGreaterThan(course.legalWidth(q.width, q.s, l) + 0.7);
          }
        }
      }
      if (indoor) {
        const hangers = rig.metal.flatMap((g) => {
          g.computeBoundingBox();
          const b = g.boundingBox!;
          return b.min.y > roof.chordY - 0.2 ? [b.getCenter(new T.Vector3())] : [];
        });
        expect(hangers).toHaveLength(2);
        for (const clamp of hangers) {
          const bay = ((clamp.z - roof.minZ) * 5) / roof.spanZ - 0.5;
          expect(bay).toBeCloseTo(Math.round(bay), 5);
          expect(clamp.y).toBeCloseTo(roof.chordY, 5);
        }
      }
    } finally {
      for (const g of Object.values(rig).flat()) g.dispose();
      material.dispose();
    }
  });
