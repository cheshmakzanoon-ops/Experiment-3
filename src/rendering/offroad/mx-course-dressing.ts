import * as T from 'three';
import { MxTracksideFurniture } from './mx-trackside-furniture.ts';
import { mxAuthoredGeometry } from './authored-kit.ts';
import { mxPaddingMaterial } from './mx-padding.ts';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { mod, Random } from '../../core/math.ts';
import { TrackTerrainSurface } from '../../simulation/offroad/course-terrain.ts';
import { Track, trackPoint } from '../../simulation/track.ts';
import { inStandFootprint } from '../grandstand.ts';
import { installScannedMaps, libraryAlbedo } from '../ground/scanned-ground.ts';
import { terrainFor } from '../terrain.ts';
import { valueNoise } from '../terrain-profile.ts';
import {
  mxShoulderPlantGeometry,
  mxShoulderPlantMaterial,
  MX_SHOULDER_WIND_RADIUS,
  type MxPlantKind,
} from './mx-shoulder-plants.ts';

/** Original event graphics, shared by the course/stadium. Four horizontal
 * rows, individually mapped onto cloth/signs. No source-image pixels, real
 * sponsor marks or extra downloaded assets are used. */
export function mxEventAtlas(indoor: boolean): T.Texture {
  if (typeof document === 'undefined') {
    const t = new T.DataTexture(new Uint8Array([230, 220, 190, 255]), 1, 1);
    t.needsUpdate = true;
    return t;
  }
  const canvas = document.createElement('canvas');
  canvas.width = 2048;
  canvas.height = 512;
  const c = canvas.getContext('2d');
  if (!c) throw new Error('MX event graphics require a 2D canvas');
  const labels = [
    'MOTOBOUND  /  ' + (indoor ? 'SUPERCROSS' : 'MX NATIONAL'),
    indoor ? 'ARENA NORD  //  MAIN EVENT' : 'VALLEY RIDGE  //  NATIONAL',
    'HOLESHOT  /  MOTOBOUND',
    'TRACK CREW     //     RIDE THE LINE',
  ];
  const backgrounds = ['#1b2527', '#d3d7bb', '#e8ddbd', '#b7c644'];
  const foregrounds = ['#f1e9d6', '#263b37', '#27332f', '#25352d'];
  for (let row = 0; row < 4; row++) {
    const y = row * 128;
    c.fillStyle = backgrounds[row];
    c.fillRect(0, y, 2048, 128);
    c.fillStyle = foregrounds[row];
    c.font = 'italic 800 70px Saira, Arial, sans-serif';
    c.textBaseline = 'middle';
    c.fillText(labels[row], 104, y + 64, 1810);
    c.fillStyle = row === 0 ? '#e17c40' : '#5c7253';
    c.fillRect(0, y + 118, 2048, 10);
    for (let k = 0; k < 3; k++) {
      c.beginPath();
      c.moveTo(24 + k * 18, y + 32);
      c.lineTo(34 + k * 18, y + 32);
      c.lineTo(18 + k * 18, y + 96);
      c.lineTo(8 + k * 18, y + 96);
      c.fill();
    }
  }
  // A little real-scale handling wear remains below the lettering.
  const r = new Random(71268);
  c.globalAlpha = 0.1;
  for (let i = 0; i < 3400; i++) {
    c.fillStyle = i % 2 ? '#34291d' : '#ffffff';
    c.fillRect(r.next() * 2048, r.next() * 512, 1 + r.next() * 3, 1 + r.next() * 2);
  }
  const texture = new T.CanvasTexture(canvas);
  texture.colorSpace = T.SRGBColorSpace;
  texture.wrapS = T.RepeatWrapping;
  texture.anisotropy = 8;
  return texture;
}

/** Assign an atlas row to a normalised-UV geometry. */
export function mxAtlasRow(g: T.BufferGeometry, row: number) {
  const uv = g.getAttribute('uv');
  for (let i = 0; i < uv.count; i++) uv.setY(i, (3 - row + uv.getY(i)) / 4);
  return g;
}

export interface MxDressingStats {
  stakes: number;
  blocks: number;
  banners: number;
  jumpMarkers: number;
  grassClumps: number;
  fernClumps: number;
  shrubs: number;
  stones: number;
  canopies: number;
}

/** The racing corridor remains defined by OffroadCourse. All solid dressing
 * is outside its legal edge; there are no decorative jumps or hidden rocks
 * in rideable lines. Course-nearest rejection protects adjacent SX lanes. */
export class MxCourseDressing {
  readonly trackside: MxTracksideFurniture;
  readonly root = new T.Group();
  readonly stats: MxDressingStats = {
    stakes: 0,
    blocks: 0,
    banners: 0,
    jumpMarkers: 0,
    grassClumps: 0,
    fernClumps: 0,
    shrubs: 0,
    stones: 0,
    canopies: 0,
  };
  private readonly ownedTextures = new Set<T.Texture>();
  private readonly batches = new Map<T.Material, T.BufferGeometry[]>();
  private readonly point = trackPoint();
  private readonly nearby = trackPoint();
  private readonly frame = new T.Matrix4();
  private readonly object = new T.Object3D();
  private readonly surface: TrackTerrainSurface;
  private readonly plantTime = { value: 0 };
  constructor(private readonly track: Track) {
    const surface = Track.offroadOf(track);
    if (
      !(surface instanceof TrackTerrainSurface) ||
      !['motocross', 'supercross'].includes(surface.kind)
    )
      throw new Error('MX dressing requires a motocross or supercross course');
    this.surface = surface;
    const indoor = surface.kind === 'supercross',
      course = surface.course;
    this.root.name = 'MOTOBOUND MX course furniture and shoulders';
    const atlas = mxEventAtlas(indoor);
    this.ownedTextures.add(atlas);
    const cloth = new T.MeshStandardMaterial({
      map: atlas,
      roughness: 0.91,
      side: T.DoubleSide,
      name: 'MX printed woven barriers',
    });
    const yellow = new T.MeshStandardMaterial({
      color: 0xc8cf56,
      roughness: 0.68,
      name: 'MX flexible course stakes',
    });
    const orange = new T.MeshStandardMaterial({
      color: 0xc97542,
      roughness: 0.72,
      name: 'MX jump crest markers',
    });
    const steel = new T.MeshStandardMaterial({
      color: 0x475050,
      metalness: 0.68,
      roughness: 0.49,
      name: 'MX galvanised event frames',
    });
    const pad = mxPaddingMaterial(false);
    for (const texture of [pad.map, pad.normalMap, pad.roughnessMap])
      if (texture) this.ownedTextures.add(texture);
    const r = new Random(36072);
    const stakes: T.Matrix4[] = [],
      blocks: T.Matrix4[] = [],
      markers: T.Matrix4[] = [];
    const pole = new T.CylinderGeometry(0.027, 0.034, 0.82, 7).translate(0, 0.41, 0);
    const block = mxAuthoredGeometry('safety-pad', 'mid')
      .scale(0.55 / 0.68, 0.38 / 0.58, 1.6 / 2.1)
      .rotateY(Math.PI / 2)
      .translate(0, 0.19, 0);
    for (let s = 4; s < track.length - 3; s += indoor ? 7 : 8) {
      track.at(s, this.point);
      for (const side of [-1, 1] as const) {
        const l = side * (course.legalWidth(this.point.width, s, side) + 0.18);
        if (!this.clear(s, l, 0.12)) continue;
        this.pose(s, l);
        this.object.rotateZ((r.next() - 0.5) * 0.13);
        this.object.updateMatrix();
        stakes.push(this.object.matrix.clone());
        if (indoor && Math.floor(s / 7) % 2 === 0) {
          this.pose(s, l + side * 0.54);
          this.object.rotateY(Math.PI / 2);
          this.object.updateMatrix();
          blocks.push(this.object.matrix.clone());
        }
      }
    }
    this.stats.stakes = stakes.length;
    this.stats.blocks = blocks.length;
    this.instances('MX course-edge stakes', pole, yellow, stakes);
    this.instances('SX padded lane dividers', block, pad, blocks);
    // Paired tall, warm markers mark the actual take-off. Short pale stakes
    // at the surveyed landing distinguish front and back faces at speed.
    for (const jump of course.jumps) {
      for (const s of [jump.takeoff, jump.landing]) {
        track.at(s, this.point);
        for (const side of [-1, 1] as const) {
          const l = side * (course.legalWidth(this.point.width, s, side) + 0.45);
          if (!this.clear(s, l, 0.2)) continue;
          this.pose(s, l);
          this.object.scale.set(1, s === jump.takeoff ? 1 : 0.55, 1);
          this.object.updateMatrix();
          markers.push(this.object.matrix.clone());
        }
      }
    }
    this.stats.jumpMarkers = markers.length;
    this.instances(
      'Surveyed jump lip and landing markers',
      new T.CylinderGeometry(0.075, 0.1, 1.3, 8).translate(0, 0.65, 0),
      orange,
      markers,
    );
    if (!indoor) {
      for (let s = 136; s < track.length - 100; s += 24) {
        const side = Math.floor(s / 24) % 2 ? 1 : -1;
        track.at(s, this.point);
        const l =
          side *
          Math.max(this.point.width + 3.6, course.legalWidth(this.point.width, s, side) + 0.75);
        if (!this.clear(s - 4, l, 0.2) || !this.clear(s + 4, l, 0.2)) continue;
        this.banner(s, l, cloth, Math.floor(s / 24) % 2);
        for (const ds of [-4, 4]) {
          this.pose(s + ds, l);
          this.part(new T.CylinderGeometry(0.022, 0.025, 0.96, 6).translate(0, 0.48, 0), steel);
        }
        this.stats.banners++;
      }
      this.shoulders(r);
    }
    this.trackside = new MxTracksideFurniture(track);
    this.root.add(this.trackside.root);
    this.stats.canopies = this.trackside.stats.canopy;
    // The arch is a sporting landmark at the actual holeshot timing line.
    if (course.spec.gate) {
      const s = course.spec.gate.holeshot;
      track.at(s, this.point);
      const span = this.point.width + 3.1;
      if (this.clear(s, -span, 0.7) && this.clear(s, span, 0.7)) {
        this.pose(s, 0);
        for (const side of [-1, 1]) {
          this.part(
            new T.CylinderGeometry(0.11, 0.14, 5.8, 10).translate(side * span, 2.9, 0),
            steel,
          );
          this.part(new T.BoxGeometry(0.58, 1.65, 0.55).translate(side * span, 0.825, 0), pad);
        }
        this.part(new T.BoxGeometry(span * 2 + 0.4, 0.18, 0.22).translate(0, 5.72, 0), steel);
        this.part(
          mxAtlasRow(
            new T.PlaneGeometry(Math.min(11, span * 1.65), 0.88)
              .rotateY(Math.PI)
              .translate(0, 5.15, -0.12),
            2,
          ),
          cloth,
        );
      }
    }
    for (const [material, geometries] of this.batches) {
      const geometry = mergeGeometries(geometries, false);
      for (const g of geometries) g.dispose();
      if (!geometry) throw new Error('MX static batch contains incompatible geometry');
      const mesh = new T.Mesh(geometry, material);
      mesh.name = material.name;
      mesh.castShadow = mesh.receiveShadow = true;
      geometry.computeBoundingSphere();
      this.root.add(mesh);
    }
    // Materials created for an empty batch still have a lifecycle.
    for (const m of [cloth, yellow, orange, steel, pad]) {
      if (
        ![...this.batches.keys()].includes(m) &&
        !this.root.children.some((o) => o instanceof T.Mesh && o.material === m)
      )
        m.dispose();
    }
    this.batches.clear();
  }
  private clear(s: number, lateral: number, margin: number) {
    const p = this.track.at(s, this.point),
      q = this.nearby;
    const x = p.x + p.nx * lateral,
      z = p.z + p.nz * lateral;
    const l = this.track.nearest(x, z, q),
      gap = Math.abs(
        mod(q.s - s + this.track.length / 2, this.track.length) - this.track.length / 2,
      );
    return gap < 8 || Math.abs(l) > this.surface.course.legalWidth(q.width, q.s, l) + margin;
  }
  private pose(s: number, lateral: number) {
    const p = this.track.at(s, this.point);
    const object = this.object;
    object.position.set(
      p.x + p.nx * lateral,
      this.surface.terrain.baseHeight(s, lateral),
      p.z + p.nz * lateral,
    );
    object.rotation.set(0, Math.atan2(p.tx, p.tz), 0);
    object.scale.set(1, 1, 1);
    object.updateMatrix();
    this.frame.copy(object.matrix);
  }
  private part(g: T.BufferGeometry, material: T.Material) {
    g.applyMatrix4(this.frame);
    const list = this.batches.get(material);
    if (list) list.push(g);
    else this.batches.set(material, [g]);
  }
  private instances(
    name: string,
    geometry: T.BufferGeometry,
    material: T.Material,
    poses: T.Matrix4[],
    colours?: T.Color[],
  ) {
    if (!poses.length) {
      geometry.dispose();
      return;
    }
    const mesh = new T.InstancedMesh(geometry, material, poses.length);
    poses.forEach((m, i) => {
      mesh.setMatrixAt(i, m);
      if (colours) mesh.setColorAt(i, colours[i]);
    });
    mesh.name = name;
    mesh.receiveShadow = true;
    mesh.castShadow = name.includes('stones');
    mesh.computeBoundingSphere();
    this.root.add(mesh);
  }
  private banner(s: number, lateral: number, material: T.Material, row: number) {
    const g = new T.PlaneGeometry(8, 0.6, 16, 2);
    const p = g.getAttribute('position');
    for (let i = 0; i < p.count; i++) {
      const x = p.getX(i),
        fraction = (x + 4) / 8;
      const station = s + x,
        at = this.track.at(station, this.point);
      const y =
        this.surface.terrain.baseHeight(station, lateral) +
        0.55 +
        p.getY(i) -
        0.075 * Math.sin(fraction * Math.PI);
      const flutter = 0.035 * Math.sin(fraction * Math.PI * 6);
      p.setXYZ(i, at.x + at.nx * (lateral + flutter), y, at.z + at.nz * (lateral + flutter));
    }
    g.computeVertexNormals();
    mxAtlasRow(g, row);
    this.frame.identity();
    this.part(g, material);
  }
  private shoulders(random: Random) {
    const track = this.track,
      surface = this.surface;
    const grassPoses: T.Matrix4[] = [],
      grassColours: T.Color[] = [],
      fernPoses: T.Matrix4[] = [],
      fernColours: T.Color[] = [],
      shrubPoses: T.Matrix4[] = [],
      shrubColours: T.Color[] = [],
      stonePoses: T.Matrix4[] = [];
    const ground = terrainFor(track),
      plantGeometry = {
        grass: mxShoulderPlantGeometry('grass'),
        fern: mxShoulderPlantGeometry('fern'),
        scrub: mxShoulderPlantGeometry('scrub'),
      };
    // The same low-frequency field clusters all three plant layers. Bare
    // loam gaps and short inner tufts leave room for the outside berm line.
    const patchAt = (x: number, z: number) => valueNoise(x * 0.055 + 7.2, z * 0.055 - 3.4);
    const normal = new T.Vector3(),
      up = new T.Vector3(0, 1, 0),
      origin = new T.Vector3(),
      corner = new T.Vector3(),
      nearest = trackPoint();
    const plantPose = (s: number, lateral: number, scale: number, kind: MxPlantKind) => {
      const at = track.at(s, this.point),
        x = at.x + at.nx * lateral,
        z = at.z + at.nz * lateral;
      // The course render mesh clips its inside band before it folds over a
      // hairpin. A root cannot be grounded to that removed part of the mesh.
      const l = track.nearest(x, z, nearest);
      if (Math.abs(mod(nearest.s - s + track.length / 2, track.length) - track.length / 2) > 3)
        return false;
      const ds = 0.18,
        across =
          (surface.terrain.baseHeight(s, lateral + ds) -
            surface.terrain.baseHeight(s, lateral - ds)) /
          (2 * ds),
        along =
          (surface.terrain.baseHeight(s + ds, lateral) -
            surface.terrain.baseHeight(s - ds, lateral)) /
          (2 * ds);
      track.at(s, this.point);
      normal
        .set(
          -across * this.point.nx - along * this.point.tx,
          1,
          -across * this.point.nz - along * this.point.tz,
        )
        .normalize();
      if (normal.y < 0.72 || Math.abs(l - lateral) > 0.25) return false;
      origin.set(x, surface.terrain.baseHeight(s, lateral) - 0.025, z);
      this.object.position.copy(origin);
      this.object.quaternion.setFromUnitVectors(up, normal);
      this.object.rotateY(random.next() * Math.PI * 2);
      this.object.scale.setScalar(scale);
      this.object.updateMatrix();
      // Bound the actual sloped, rotated geometry, including maximum wind
      // travel. A guessed radius misses tall leaves leaning toward the lane.
      const box = plantGeometry[kind].boundingBox!;
      let radius = 0;
      for (const cx of [box.min.x, box.max.x])
        for (const cy of [box.min.y, box.max.y])
          for (const cz of [box.min.z, box.max.z]) {
            corner.set(cx, cy, cz).applyMatrix4(this.object.matrix);
            radius = Math.max(radius, Math.hypot(corner.x - x, corner.z - z));
          }
      radius += scale * MX_SHOULDER_WIND_RADIUS;
      const side = Math.sign(lateral);
      // TerrainView stops the inside band at 85% of the curvature radius.
      // Check the adjoining render rows too: nearest-lane agreement alone
      // can still leave a root standing over a clipped hairpin triangle.
      for (const station of [s - radius - 1, s, s + radius + 1]) {
        track.at(station, nearest);
        if (
          nearest.curvature * lateral > 0 &&
          Math.abs(nearest.curvature) > 1e-4 &&
          Math.abs(lateral) + radius + 0.12 > 0.85 / Math.abs(nearest.curvature)
        )
          return false;
      }
      if (
        Math.abs(lateral) + radius > -surface.terrain.lateralMin - 0.12 ||
        Math.abs(Math.abs(lateral) - track.boundaryAt(this.point, side)) < radius + 0.4 ||
        (side === track.pit.side && track.isPitSection(s)) ||
        inStandFootprint(track, x, z, radius + 0.4)
      )
        return false;
      // The margin also covers the chord between the eight footprint probes.
      for (let k = 0; k < 8; k++) {
        const a = (k * Math.PI) / 4,
          l = track.nearest(x + Math.cos(a) * radius, z + Math.sin(a) * radius, nearest);
        if (Math.abs(l) < surface.course.legalWidth(nearest.width, nearest.s, l) + 0.25)
          return false;
      }
      return true;
    };
    for (let i = 0; i < 3900; i++) {
      const s = random.next() * track.length,
        side = random.next() < 0.5 ? -1 : 1;
      const p = track.at(s, this.point);
      const outer = random.next(),
        l = side * (surface.course.legalWidth(p.width, s, side) + 0.85 + outer * 4.4),
        x = p.x + p.nx * l,
        z = p.z + p.nz * l,
        patch = patchAt(x, z),
        scale = 0.36 + outer * 0.25 + patch * 0.3;
      if (random.next() > 0.48 + patch * 0.64 || !plantPose(s, l, scale, 'grass')) continue;
      grassPoses.push(this.object.matrix.clone());
      grassColours.push(
        new T.Color().setHSL(
          0.18 + random.next() * 0.055,
          0.24 + random.next() * 0.16,
          0.31 + random.next() * 0.12,
        ),
      );
      if (i % 13 !== 0) continue;
      track.at(s, this.point);
      const far = side * (p.width + 9 + random.next() * 12),
        rockX = p.x + p.nx * far,
        rockZ = p.z + p.nz * far;
      if (
        !this.clear(s, far, 4) ||
        inStandFootprint(track, rockX, rockZ, 4) ||
        track.isPitSection(s)
      )
        continue;
      this.object.position.set(rockX, ground.height(rockX, rockZ) + 0.3, rockZ);
      this.object.rotation.set(
        random.next() * 0.7,
        random.next() * Math.PI * 2,
        random.next() * 0.5,
      );
      const rock = 0.5 + random.next() * 1.6;
      this.object.scale.set(rock, rock * 0.65, rock * 0.9);
      this.object.updateMatrix();
      stonePoses.push(this.object.matrix.clone());
    }
    // Darker intermediate-height plants sit behind the cropped grass, in
    // connected patches rather than a uniform strip of identical bushes.
    for (let i = 0; i < 1150; i++) {
      const s = random.next() * track.length,
        side = random.next() < 0.5 ? -1 : 1,
        p = track.at(s, this.point),
        l = side * (surface.course.legalWidth(p.width, s, side) + 2.4 + random.next() * 3.1),
        patch = patchAt(p.x + p.nx * l, p.z + p.nz * l);
      if (patch < 0.46 || random.next() > patch * 0.9) continue;
      const fern = i % 3 !== 0,
        scale = (fern ? 0.66 : 0.85) + random.next() * 0.4;
      if (!plantPose(s, l, scale, fern ? 'fern' : 'scrub')) continue;
      (fern ? fernPoses : shrubPoses).push(this.object.matrix.clone());
      (fern ? fernColours : shrubColours).push(
        new T.Color().setHSL(
          0.21 + random.next() * 0.055,
          0.25 + random.next() * 0.16,
          0.25 + random.next() * 0.11,
        ),
      );
    }
    const grassMaterial = mxShoulderPlantMaterial(this.plantTime);
    const rockMaterial = new T.MeshStandardMaterial({
      color: 0x807a68,
      roughness: 0.92,
      name: 'MX weathered shoulder stones',
    });
    installScannedMaps(rockMaterial, 'rock', libraryAlbedo(rockMaterial));
    this.instances(
      'MX shoulder grass islands',
      plantGeometry.grass,
      grassMaterial,
      grassPoses,
      grassColours,
    );
    this.instances(
      'MX shoulder fern fans',
      plantGeometry.fern,
      grassMaterial,
      fernPoses,
      fernColours,
    );
    this.instances(
      'MX shoulder broadleaf scrub',
      plantGeometry.scrub,
      grassMaterial,
      shrubPoses,
      shrubColours,
    );
    this.instances('MX shoulder stones', new T.IcosahedronGeometry(1, 1), rockMaterial, stonePoses);
    if (!grassPoses.length && !fernPoses.length && !shrubPoses.length) grassMaterial.dispose();
    if (!stonePoses.length) rockMaterial.dispose();
    this.stats.grassClumps = grassPoses.length;
    this.stats.fernClumps = fernPoses.length;
    this.stats.shrubs = shrubPoses.length;
    this.stats.stones = stonePoses.length;
  }
  update(time: number) {
    if (Number.isFinite(time)) this.plantTime.value = Math.max(0, time);
  }
  dispose() {
    this.root.remove(this.trackside.root);
    this.trackside.dispose();
    const geometries = new Set<T.BufferGeometry>(),
      materials = new Set<T.Material>();
    this.root.traverse((o) => {
      if (!(o instanceof T.Mesh)) return;
      // Instance buffers belong to the mesh, separately from shared geometry
      // and materials; releasing only those leaves GPU instance data resident.
      if (o instanceof T.InstancedMesh) o.dispose();
      geometries.add(o.geometry);
      for (const m of Array.isArray(o.material) ? o.material : [o.material]) materials.add(m);
    });
    geometries.forEach((g) => g.dispose());
    materials.forEach((m) => m.dispose());
    this.ownedTextures.forEach((t) => t.dispose());
    this.root.clear();
  }
}
