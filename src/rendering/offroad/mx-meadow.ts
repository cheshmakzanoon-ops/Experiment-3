import * as T from 'three';
import { mod, Random } from '../../core/math.ts';
import { TrackTerrainSurface } from '../../simulation/offroad/course-terrain.ts';
import { Track, trackPoint } from '../../simulation/track.ts';
import { inStandFootprint } from '../grandstand.ts';
import { valueNoise } from '../terrain-profile.ts';
import { onMxDetail } from './mx-quality.ts';
import { mxShoulderPlantGeometry, mxShoulderPlantMaterial } from './mx-shoulder-plants.ts';
import { mxFurnitureGround, type MxFurnitureSite } from './mx-trackside-furniture.ts';

/** Uncut field grass beyond the shoulder, where the photographed meadow alone
 * left the fields flat: leaning fans of blades scattered in patches from the
 * outer edge of the tall-grass band out to tens of metres, thinning with
 * distance. High and Ultra only (nothing is drawn on Low and Medium). It stands
 * on the visible ground (`mxFurnitureGround`), never on a course, a stand, or a
 * service site. */
export interface MxMeadowStats {
  clumps: number;
  chunks: number;
}

const CHUNK = 110;
/** Metres beyond the legal edge where the field begins and ends. */
export const MX_MEADOW_BAND = Object.freeze({ near: 5.2, far: 34 });
const MAX_SLOPE = 0.4;

export class MxMeadow {
  readonly root = new T.Group();
  readonly stats: MxMeadowStats = { clumps: 0, chunks: 0 };
  private readonly time = { value: 0 };
  private readonly meshes: T.InstancedMesh[] = [];
  private readonly material: T.MeshStandardMaterial;
  private readonly geometry: T.BufferGeometry;
  private readonly unsubscribe: () => void;
  constructor(track: Track, furniture: readonly MxFurnitureSite[] = []) {
    const surface = Track.offroadOf(track);
    if (!(surface instanceof TrackTerrainSurface) || surface.kind !== 'motocross')
      throw new Error('Meadow grass needs an outdoor motocross course');
    this.root.name = 'MX field grass';
    this.material = mxShoulderPlantMaterial(this.time);
    this.geometry = mxShoulderPlantGeometry('meadow');
    const course = surface.course,
      random = new Random(77213),
      point = trackPoint(),
      nearby = trackPoint(),
      object = new T.Object3D(),
      up = new T.Vector3(0, 1, 0),
      normal = new T.Vector3();
    const chunks = Math.ceil(track.length / CHUNK);
    const poses: T.Matrix4[][] = Array.from({ length: chunks }, () => []);
    const colours: T.Color[][] = Array.from({ length: chunks }, () => []);
    const patchAt = (x: number, z: number) => valueNoise(x * 0.045 + 3.1, z * 0.045 - 9.4);
    const slopeAt = (x: number, z: number) => {
      const h = 0.5,
        gx = (mxFurnitureGround(track, x + h, z) - mxFurnitureGround(track, x - h, z)) / (2 * h),
        gz = (mxFurnitureGround(track, x, z + h) - mxFurnitureGround(track, x, z - h)) / (2 * h);
      return { gx, gz };
    };
    // Dense enough that the field reads as standing grass, not dots on a
    // lawn, from the chase camera's height (High/Ultra only, instanced).
    for (let i = 0; i < 58000; i++) {
      const s = random.next() * track.length,
        side = random.next() < 0.5 ? -1 : 1;
      const at = track.at(s, point);
      // Denser by the shoulder, a thinning field beyond.
      const reach = Math.pow(random.next(), 1.35);
      const lateral =
        side *
        (course.legalWidth(at.width, s, side) +
          MX_MEADOW_BAND.near +
          reach * (MX_MEADOW_BAND.far - MX_MEADOW_BAND.near));
      const x = at.x + at.nx * lateral,
        z = at.z + at.nz * lateral;
      const patch = patchAt(x, z);
      if (random.next() > 0.18 + patch * 0.95 - reach * 0.32) continue;
      // The nearest road must be this one, and well clear of it.
      const l = track.nearest(x, z, nearby),
        gap = Math.abs(mod(nearby.s - s + track.length / 2, track.length) - track.length / 2);
      if (gap > 12) continue;
      if (Math.abs(l) < course.legalWidth(nearby.width, nearby.s, l) + MX_MEADOW_BAND.near - 0.6)
        continue;
      if (inStandFootprint(track, x, z, 3)) continue;
      if (furniture.some((site) => Math.hypot(site.x - x, site.z - z) < site.radius + 1.5))
        continue;
      const { gx, gz } = slopeAt(x, z);
      if (Math.hypot(gx, gz) > MAX_SLOPE) continue;
      normal.set(-gx, 1, -gz).normalize();
      object.position.set(x, mxFurnitureGround(track, x, z) - 0.045, z);
      object.quaternion.setFromUnitVectors(up, normal);
      object.rotateY(random.next() * Math.PI * 2);
      // Taller where the field has gone to seed, shorter at the margin.
      object.scale.setScalar(0.75 + patch * 0.7 + random.next() * 0.35 - reach * 0.2);
      object.updateMatrix();
      const chunk = Math.min(chunks - 1, Math.floor(s / CHUNK));
      poses[chunk].push(object.matrix.clone());
      // Linear-light tints: cool fresh green to straw (setHSL reads linear).
      colours[chunk].push(
        new T.Color().setHSL(
          0.15 + random.next() * 0.075 - patch * 0.02,
          0.2 + random.next() * 0.16,
          0.2 + random.next() * 0.1 + patch * 0.05,
        ),
      );
    }
    for (let c = 0; c < chunks; c++) {
      if (!poses[c].length) continue;
      const mesh = new T.InstancedMesh(this.geometry, this.material, poses[c].length);
      poses[c].forEach((m, k) => {
        mesh.setMatrixAt(k, m);
        mesh.setColorAt(k, colours[c][k]);
      });
      mesh.name = `MX field grass ${c * CHUNK}-${(c + 1) * CHUNK} m`;
      mesh.castShadow = false;
      mesh.receiveShadow = true;
      mesh.computeBoundingSphere();
      this.root.add(mesh);
      this.meshes.push(mesh);
      this.stats.clumps += poses[c].length;
    }
    this.stats.chunks = this.meshes.length;
    this.unsubscribe = onMxDetail((high) => {
      this.root.visible = high;
    });
  }
  /** Absolute simulation time only: a held frame is still. */
  update(time: number) {
    if (Number.isFinite(time)) this.time.value = Math.max(0, time);
  }
  dispose() {
    this.unsubscribe();
    for (const mesh of this.meshes) mesh.dispose();
    this.geometry.dispose();
    this.material.dispose();
    this.root.clear();
    this.meshes.length = 0;
  }
}
