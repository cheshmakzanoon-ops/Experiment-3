import * as T from 'three';
import { mxAtlasRow, mxEventAtlas } from './mx-event-graphics.ts';
import { mxOutdoorFinish } from './mx-finish-line.ts';
import { MxVenueWind } from './mx-venue-wind.ts';
import { disposeOffroadResources } from './owned-resources.ts';
import { MxTracksideFurniture } from './mx-trackside-furniture.ts';
import { mxFootprintMatrix, mxFurnitureGround } from './mx-ground-pose.ts';
import { mxFieldstoneGeometry } from './mx-fieldstone.ts';
import { planMxCourseSites } from './mx-course-sites.ts';
import { attachMxClothShadows, installMxClothWind } from './mx-event-cloth.ts';
import { mxStrawBale } from './mx-straw-bale.ts';
import { mxTeamVanGeometry, mxTeamVanMaterial } from './mx-paddock-models.ts';
import { mxPaddingGeometry, mxPaddingMaterial } from './mx-padding.ts';
import { onMxDetail } from './mx-quality.ts';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { mod, Random } from '../../core/math.ts';
import { TrackTerrainSurface } from '../../simulation/offroad/course-terrain.ts';
import { Track, trackPoint } from '../../simulation/track.ts';
import { inStandFootprint } from '../grandstand.ts';
import { installScannedMaps, libraryAlbedo } from '../ground/scanned-ground.ts';
import { valueNoise } from '../terrain-profile.ts';
import {
  MxShoulderView,
  mxShoulderPlantGeometry,
  mxShoulderPlantMaterial,
  MX_SHOULDER_WIND_RADIUS,
} from './mx-shoulder-plants.ts';

/** Thin, gently bowed plastic blades catch the light like the flexible
 * course markers in the reference banks. The complete silhouette stays
 * inside the former tapered pole, preserving adjacent-lane clearance. */
function mxCourseStakeGeometry() {
  const outline = new T.Shape()
    .moveTo(-0.014, 0)
    .lineTo(0.014, 0)
    .lineTo(0.026, 0.6)
    .lineTo(0.026, 0.755)
    .lineTo(0.018, 0.82)
    .lineTo(-0.018, 0.82)
    .lineTo(-0.026, 0.755)
    .lineTo(-0.026, 0.6)
    .closePath();
  const geometry = new T.ExtrudeGeometry(outline, {
    depth: 0.009,
    bevelEnabled: false,
    steps: 1,
    curveSegments: 1,
  }).translate(0, 0, -0.0045);
  const position = geometry.getAttribute('position');
  for (let i = 0; i < position.count; i++)
    position.setZ(i, position.getZ(i) + 0.006 * Math.sin((Math.PI * position.getY(i)) / 0.82));
  geometry.computeVertexNormals();
  geometry.computeBoundingBox();
  geometry.computeBoundingSphere();
  return geometry;
}

export interface MxDressingStats {
  stakes: number;
  blocks: number;
  banners: number;
  bermScrimSpans: number;
  jumpMarkers: number;
  grassClumps: number;
  fernClumps: number;
  tufts: number;
  tapeSpans: number;
  shrubs: number;
  stones: number;
  canopies: number;
  flags: number;
  bales: number;
  vans: number;
}

/** The racing corridor remains defined by OffroadCourse. All solid dressing
 * is outside its legal edge; there are no decorative jumps or hidden rocks
 * in rideable lines. Course-nearest rejection protects adjacent SX lanes. */
export class MxCourseDressing {
  readonly trackside: MxTracksideFurniture;
  readonly root = new T.Group();
  /** Boundary tape and close-cropped shoulder turf, outside `root`'s pinned batch budget. */
  readonly turf = new T.Group();
  readonly stats: MxDressingStats = {
    stakes: 0,
    blocks: 0,
    banners: 0,
    bermScrimSpans: 0,
    jumpMarkers: 0,
    grassClumps: 0,
    fernClumps: 0,
    tufts: 0,
    tapeSpans: 0,
    shrubs: 0,
    stones: 0,
    canopies: 0,
    flags: 0,
    bales: 0,
    vans: 0,
  };
  readonly courseSites: ReturnType<typeof planMxCourseSites>;
  private readonly ownedTextures = new Set<T.Texture>();
  private readonly batches = new Map<T.Material, T.BufferGeometry[]>();
  private readonly point = trackPoint();
  private readonly nearby = trackPoint();
  private readonly frame = new T.Matrix4();
  private readonly object = new T.Object3D();
  private readonly surface: TrackTerrainSurface;
  private readonly venueTime = { value: 0 };
  private readonly shoulderViews: MxShoulderView[] = [];
  private stopTufts: (() => void) | null = null;
  private disposed = false;
  constructor(private readonly track: Track, private readonly wind = new MxVenueWind()) {
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
    if (!indoor) installMxClothWind(cloth, this.venueTime, true, this.wind);
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
    const pole = mxCourseStakeGeometry();
    const staked: Record<'-1' | '1', number[]> = { '-1': [], '1': [] };
    for (let s = 4; s < track.length - 3; s += indoor ? 7 : 8) {
      track.at(s, this.point);
      for (const side of [-1, 1] as const) {
        const l = side * (course.legalWidth(this.point.width, s, side) + 0.18);
        if (!this.clear(s, l, 0.12)) continue;
        this.pose(s, l);
        this.object.rotateZ((r.next() - 0.5) * 0.13);
        this.object.updateMatrix();
        stakes.push(this.object.matrix.clone());
        if (!indoor) staked[String(side) as '-1' | '1'].push(s);
        if (indoor && Math.floor(s / 7) % 2 === 0) {
          this.pose(s, l + side * 0.54);
          const { x, z } = this.object.position;
          blocks.push(mxFootprintMatrix(track, x, z, this.object.rotation.y, 0.55, 1.6, -0.012));
        }
      }
    }
    this.stats.stakes = stakes.length;
    this.stats.blocks = blocks.length;
    this.instances('MX course-edge stakes', pole, yellow, stakes);
    if (!indoor) this.boundaryTape(staked);
    if (blocks.length) {
      const block = mxPaddingGeometry()
        .scale(0.55 / 0.68, 0.38 / 0.58, 1.6 / 2.1)
        .translate(0, 0.19, 0);
      this.instances('SX padded lane dividers', block, pad, blocks);
    }
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
      this.shoulders(r);
    }
    this.trackside = new MxTracksideFurniture(track, this.venueTime, this.wind);
    this.courseSites = planMxCourseSites(track, this.trackside.plan.sites);
    this.root.add(this.trackside.root);
    this.stats.canopies = this.trackside.stats.canopy;
    if (!indoor) {
      this.raceBanners(cloth, steel);
      this.featherFlags(cloth, steel);
      this.paddockLife();
    }
    if (!indoor) {
      this.frame.identity();
      const finish = mxOutdoorFinish(track);
      for (const g of finish.metal) this.part(g, steel);
      for (const g of finish.print) this.part(g, cloth);
      for (const g of finish.padding) this.part(g, pad);
    }
    // The arch is a sporting landmark at the actual holeshot timing line.
    if (course.spec.gate) {
      const s = course.spec.gate.holeshot;
      track.at(s, this.point);
      const span = this.point.width + 3.1;
      if (this.clear(s, -span, 0.7) && this.clear(s, span, 0.7)) {
        this.pose(s, 0);
        // A box-truss gantry, as an event rigs over a timing line: four-chord
        // legs and bridge with ladder rungs, padded feet, the event banner
        // printed on both faces and plain scrim down the legs.
        const half = 0.26,
          top = 6.3,
          bridge = 1.5,
          chord = (length: number) => new T.CylinderGeometry(0.034, 0.034, length, 6);
        for (const side of [-1, 1]) {
          for (const cx of [-half, half])
            for (const cz of [-half, half])
              this.part(chord(top).translate(side * span + cx, top / 2, cz), steel);
          for (let y = 1.9; y < top - 0.2; y += 0.88) {
            this.part(
              new T.BoxGeometry(half * 2, 0.04, 0.04).translate(side * span, y, -half),
              steel,
            );
            this.part(
              new T.BoxGeometry(half * 2, 0.04, 0.04).translate(side * span, y, half),
              steel,
            );
            for (const cx of [-half, half])
              this.part(
                new T.BoxGeometry(0.04, 0.04, half * 2).translate(side * span + cx, y, 0),
                steel,
              );
          }
          // These upright column covers are unprinted. Two webbing bands
          // wrap around the shaft, with the base seated at the timing line.
          const cover = mxPaddingGeometry('post').rotateX(Math.PI / 2)
            .scale(0.78 / 0.68, 1.65 / 2.1, 0.78 / 0.58)
            .translate(side * span, 0.825, 0);
          this.part(cover, pad);
          // Scrim on the approach and exit faces of each leg: the atlas row's
          // plain leading field, without lettering turned on its side.
          for (const face of [-1, 1]) {
            const scrim = new T.PlaneGeometry(half * 2 - 0.04, top - bridge - 1.75);
            const uv = scrim.getAttribute('uv');
            for (let i = 0; i < uv.count; i++) uv.setXY(i, 0.955 + uv.getX(i) * 0.03, uv.getY(i));
            if (face < 0) scrim.rotateY(Math.PI);
            this.part(
              mxAtlasRow(scrim, 0).translate(
                side * span,
                1.7 + (top - bridge - 1.75) / 2,
                face * (half + 0.012),
              ),
              cloth,
            );
          }
        }
        const reach = span * 2 + half * 2;
        for (const cy of [top - bridge, top])
          for (const cz of [-half, half])
            this.part(
              chord(reach)
                .rotateZ(Math.PI / 2)
                .translate(0, cy, cz),
              steel,
            );
        for (let x = -span + 0.9; x < span - 0.4; x += 1.05)
          for (const cz of [-half, half])
            this.part(
              new T.BoxGeometry(0.04, bridge, 0.04).translate(x, top - bridge / 2, cz),
              steel,
            );
        const width = Math.min(13, span * 2 - half * 2 - 0.3);
        for (const face of [-1, 1]) {
          const banner = new T.PlaneGeometry(width, bridge - 0.16);
          if (face < 0) banner.rotateY(Math.PI);
          this.part(
            mxAtlasRow(banner, 2).translate(0, top - bridge / 2, face * (half + 0.014)),
            cloth,
          );
        }
      }
    }
    for (const [material, geometries] of this.batches) {
      if (material === cloth && !indoor) {
        // Banners bolted to the gantry share the cloth material but do
        // not move. All geometries need the same schema for one batch.
        for (const part of geometries)
          if (!part.hasAttribute('mxCloth')) {
            part.setAttribute(
              'mxCloth',
              new T.Float32BufferAttribute(
                new Float32Array(part.getAttribute('position').count * 3),
                3,
              ),
            );
          }
      }
      const geometry = mergeGeometries(geometries, false);
      for (const g of geometries) g.dispose();
      if (!geometry) throw new Error('MX static batch contains incompatible geometry');
      const mesh = new T.Mesh(geometry, material);
      mesh.name = material.name;
      mesh.castShadow = mesh.receiveShadow = true;
      geometry.computeBoundingSphere();
      if (material === cloth && !indoor) attachMxClothShadows(mesh, this.venueTime, this.wind);
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
  /** Barrier tape strung between consecutive course-edge stakes: a narrow red
   * and white ribbon at knee height that sags a few centimetres between posts.
   * It follows the same edge and the same clearance as the stakes, never
   * crossing a gap where a stake was refused. Its own group and one draw. */
  private boundaryTape(staked: Record<'-1' | '1', number[]>) {
    const course = this.surface.course,
      positions: number[] = [],
      uvs: number[] = [],
      indices: number[] = [],
      normals: number[] = [];
    const segments = 8,
      height = 0.58,
      half = 0.022,
      stripe = 0.42;
    let spans = 0;
    for (const key of ['-1', '1'] as const) {
      const side = Number(key) as -1 | 1,
        list = staked[key];
      for (let i = 0; i + 1 < list.length; i++) {
        const from = list[i],
          to = list[i + 1];
        if (to - from > 8.6) continue;
        const first = positions.length / 3;
        let run = 0,
          previous: T.Vector3 | null = null;
        for (let k = 0; k <= segments; k++) {
          const t = k / segments,
            s = from + (to - from) * t,
            at = this.track.at(s, this.point);
          const lateral = side * (course.legalWidth(at.width, s, side) + 0.18),
            x = at.x + at.nx * lateral,
            z = at.z + at.nz * lateral,
            sag = 0.05 * Math.sin(Math.PI * t),
            y = this.surface.terrain.baseHeight(s, lateral) + height - sag;
          const here = new T.Vector3(x, y, z);
          if (previous) run += here.distanceTo(previous);
          previous = here;
          // The ribbon's face looks across the course: normal along the lateral.
          positions.push(x, y + half, z, x, y - half, z);
          normals.push(at.nx, 0, at.nz, at.nx, 0, at.nz);
          uvs.push(run / stripe, 1, run / stripe, 0);
          if (k > 0) {
            const a = first + (k - 1) * 2;
            indices.push(a, a + 1, a + 2, a + 1, a + 3, a + 2);
          }
        }
        spans++;
      }
    }
    if (!spans) return;
    const geometry = new T.BufferGeometry();
    geometry.setAttribute('position', new T.Float32BufferAttribute(positions, 3));
    geometry.setAttribute('normal', new T.Float32BufferAttribute(normals, 3));
    geometry.setAttribute('uv', new T.Float32BufferAttribute(uvs, 2));
    geometry.setIndex(indices);
    geometry.computeBoundingSphere();
    // Alternating red and white, eight centimetres at a time, crisp.
    const data = new Uint8Array(16 * 4);
    for (let i = 0; i < 16; i++) data.set(i < 8 ? [226, 222, 212, 255] : [196, 44, 34, 255], i * 4);
    const map = new T.DataTexture(data, 16, 1, T.RGBAFormat);
    map.colorSpace = T.SRGBColorSpace;
    map.wrapS = T.RepeatWrapping;
    map.magFilter = T.NearestFilter;
    map.minFilter = T.LinearMipmapLinearFilter;
    map.generateMipmaps = true;
    map.needsUpdate = true;
    this.ownedTextures.add(map);
    const material = new T.MeshStandardMaterial({
      map,
      roughness: 0.5,
      side: T.DoubleSide,
      name: 'MX boundary tape',
    });
    const mesh = new T.Mesh(geometry, material);
    mesh.name = 'MX boundary tape';
    mesh.receiveShadow = true;
    this.turf.add(mesh);
    this.stats.tapeSpans = spans;
  }
  /** Event feather flags in clusters of three on the outside of the turns,
   * where a rider's eye goes on corner entry. Printed with the event atlas
   * (lettering reads up the sail, as on a real feather flag) and merged into
   * the existing cloth and steel batches: no extra draw or texture. They stay
   * clear of the course, its neighbouring lanes and every planned service
   * site, marshal post and landmark. */
  private featherFlags(cloth: T.Material, steel: T.Material) {
    const track = this.track,
      course = this.surface.course,
      ahead = trackPoint(),
      behind = trackPoint(),
      occupied = [...this.trackside.plan.sites, ...this.courseSites.landmarks];
    const sail = (row: number, phase: number) => {
      const columns = 6,
        rows = 10,
        g = new T.PlaneGeometry(1, 1, columns, rows),
        p = g.getAttribute('position'),
        uv = g.getAttribute('uv');
      const wind = new Float32Array(p.count * 3);
      // The mast sleeve and curved head batten take the fabric tension.
      // The trailing lower half carries most of the wave.
      const nx = this.frame.elements[8],
        nz = this.frame.elements[10];
      for (let i = 0; i < p.count; i++) {
        const u = p.getX(i) + 0.5,
          v = p.getY(i) + 0.5,
          // A tall sail whose free edge sweeps back into a rounded head.
          bottom = 0.62 + 0.12 * u * u,
          top = 3.12 - 0.62 * u * u * u,
          y = bottom + (top - bottom) * v,
          width = 0.72 * (1 - 0.25 * v * v);
        p.setXYZ(i, 0.03 + u * width, y, 0.07 * Math.sin(Math.PI * u) * (0.6 + 0.4 * v));
        const deflection = 0.15 * u * u * (1 - v * v);
        wind.set([nx * deflection, nz * deflection, phase + 4.3 * u + 2.1 * y], i * 3);
        // Atlas along the height (text reads upward), across the row's band.
        uv.setXY(i, 0.04 + v * 0.62, u);
      }
      g.computeVertexNormals();
      g.setAttribute('mxCloth', new T.Float32BufferAttribute(wind, 3));
      return mxAtlasRow(g, row);
    };
    const pole = () => new T.CylinderGeometry(0.014, 0.02, 3.18, 6).translate(0, 1.59, 0);
    let clusters = 0;
    for (let s = 20; s < track.length - 20 && clusters < 14; s += 9) {
      track.at(s + 6, ahead);
      track.at(s - 6, behind);
      const p = track.at(s, this.point),
        turn = (ahead.tx - behind.tx) * p.nx + (ahead.tz - behind.tz) * p.nz;
      if (Math.abs(turn) < 0.42) continue;
      const side = turn > 0 ? -1 : 1,
        lateral = side * (course.legalWidth(p.width, s, side) + 3.4);
      let fits = true;
      for (const ds of [-3, 0, 3]) if (!this.clear(s + ds, lateral, 2)) fits = false;
      const x = p.x + p.nx * lateral,
        z = p.z + p.nz * lateral;
      if (!fits || occupied.some((q) => Math.hypot(q.x - x, q.z - z) < q.radius + 2.5)) continue;
      for (const [k, ds] of [-3, 0, 3].entries()) {
        this.pose(s + ds, lateral);
        // Sails trail downwind together; the cluster alternates its prints.
        this.object.rotateY(0.9 + 0.15 * k);
        this.object.updateMatrix();
        this.frame.copy(this.object.matrix);
        this.part(pole(), steel);
        this.part(sail(k === 1 ? 3 : (clusters + k) % 2 ? 0 : 1, (s + ds) * 0.21), cloth);
        this.stats.flags++;
      }
      clusters++;
      s += 40;
    }
  }
  /** Trackside life: round straw bales stacked in front of the turn-outside
   * flag clusters (between the flags and the tape) and team vans parked
   * behind each service canopy, side-on to the course. One instanced draw
   * each, with a shared straw atlas and per-team van paint. */
  private paddockLife() {
    const track = this.track,
      course = this.surface.course,
      bales: T.Matrix4[] = [],
      vans: T.Matrix4[] = [],
      vanColours: T.Color[] = [],
      vanCrews: number[] = [],
      sites = this.trackside.plan.sites,
      landmarks = this.courseSites.landmarks,
      random = new Random(52811);
    const free = (x: number, z: number, r: number) =>
      !sites.some((q) => Math.hypot(q.x - x, q.z - z) < q.radius + r) &&
      !landmarks.some((q) => Math.hypot(q.x - x, q.z - z) < q.radius + r) &&
      !inStandFootprint(track, x, z, r);
    // Bales: on every tight turn's outside, a short row lying on their sides.
    const ahead = trackPoint(),
      behind = trackPoint();
    for (let s = 24; s < track.length - 24; s += 11) {
      track.at(s + 6, ahead);
      track.at(s - 6, behind);
      const p = track.at(s, this.point),
        turn = (ahead.tx - behind.tx) * p.nx + (ahead.tz - behind.tz) * p.nz;
      if (Math.abs(turn) < 0.38) continue;
      const side = turn > 0 ? -1 : 1,
        lateral = side * (course.legalWidth(p.width, s, side) + 1.9);
      for (const ds of [-2.6, -1.3, 0, 1.3, 2.6]) {
        if (!this.clear(s + ds, lateral, 1.2)) continue;
        this.pose(s + ds, lateral);
        const x = this.object.position.x,
          z = this.object.position.z;
        if (!free(x, z, 1)) continue;
        const yaw = this.object.rotation.y + (random.next() - 0.5) * 0.3;
        const base = mxFootprintMatrix(track, x, z, yaw, 1.05, 0.58, 0.603);
        bales.push(base.multiply(new T.Matrix4().makeRotationZ(Math.PI / 2)));
      }
      s += 26;
    }
    // Vans: behind each service canopy, away from the course.
    const near = trackPoint();
    for (const [index, site] of sites.entries()) {
      if (site.type !== 'service') continue;
      const lateral = track.nearest(site.x, site.z, near),
        out = Math.sign(lateral) || 1;
      for (const along of [-3.2, 3.2]) {
        const x = site.x + near.nx * out * (site.radius + 3) + near.tx * along,
          z = site.z + near.nz * out * (site.radius + 3) + near.tz * along;
        const l = track.nearest(x, z, this.nearby);
        if (Math.abs(l) < course.legalWidth(this.nearby.width, this.nearby.s, l) + 6) continue;
        if (!free(x, z, 2.6) || inStandFootprint(track, x, z, 3)) continue;
        const yaw = Math.atan2(near.tx, near.tz) + (along > 0 ? 0 : Math.PI);
        vans.push(mxFootprintMatrix(track, x, z, yaw, 1.792, 3.36, -0.012));
        vanCrews.push(index % 4);
        vanColours.push(
          new T.Color([0xe9ebe8, 0x2b3a46, 0xc9ccc7, 0x5d1f22, 0x1f2224][vans.length % 5]),
        );
      }
    }
    if (bales.length) {
      const { geometry, material } = mxStrawBale();
      this.instances('MX round straw bales', geometry, material, bales);
    }
    const van = mxTeamVanGeometry(vanCrews);
    const paint = mxTeamVanMaterial();
    this.instances('MX team vans', van, paint, vans, vanColours);
    const mesh = this.root.getObjectByName('MX team vans');
    if (mesh) mesh.castShadow = true;
    if (!vans.length) paint.dispose();
    this.stats.bales = bales.length;
    this.stats.vans = vans.length;
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
    parent: T.Group = this.root,
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
    parent.add(mesh);
  }
  /** Pinned fabric follows the outside of the bank like the continuous
   * spectator screens in references 035 and 037. Keep access gaps at both
   * ends and beside service sites; check the full chord on tight switchbacks. */
  private raceBanners(material: T.Material, hardware: T.Material) {
    const track = this.track, course = this.surface.course;
    const occupied = [...this.trackside.plan.sites, ...this.courseSites.landmarks];
    const panels: T.Vector3[] = [];
    const pin = (s: number, side: number, setback: number) => {
      const p = track.at(s, this.point);
      const l = side * Math.max(p.width + 3.6, course.legalWidth(p.width, s, side) + setback);
      const x = p.x + p.nx * l, z = p.z + p.nz * l;
      return new T.Vector3(x, mxFurnitureGround(track, x, z), z);
    };
    const point = new T.Vector3();
    const safe = (a: T.Vector3, b: T.Vector3) => {
      for (const t of [0, 0.25, 0.5, 0.75, 1]) {
        point.lerpVectors(a, b, t);
        const { x, y, z } = point, p = this.nearby;
        const l = track.nearest(x, z, p);
        if (Math.abs(l) < course.legalWidth(p.width, p.s, l) + 0.65 ||
            mxFurnitureGround(track, x, z) > y + 0.11 ||
            inStandFootprint(track, x, z, 0.45) ||
            occupied.some(site => Math.hypot(x - site.x, z - site.z) < site.radius + 0.9)) return false;
      }
      point.lerpVectors(a, b, 0.5);
      return !panels.some(mid => mid.distanceToSquared(point) < 20);
    };
    this.frame.identity();
    const stake = ({ x, y, z }: T.Vector3) => {
      this.part(new T.CylinderGeometry(0.024, 0.031, 1.12, 7).translate(x, y + 0.50, z), hardware);
      for (const height of [0.26, 0.96]) {
        const tie = new T.TorusGeometry(0.039, 0.009, 4, 9).rotateX(Math.PI / 2);
        this.part(tie.translate(x, y + height, z), hardware);
      }
    };
    const run = (start: number, step: number, count: number, side: number, banked: boolean) => {
      const setback = banked ? 3.55 : 1.45;
      let a = pin(start, side, setback), previousMounted = false;
      for (let i = 0; i < count; i++) {
        const s = start + i * step, b = pin(s + step, side, setback), mounted = safe(a, b);
        if (mounted) {
          if (!previousMounted) stake(a);
          stake(b);
          this.banner(s + step / 2, side, [a, b], material, this.stats.banners % 2);
          panels.push(new T.Vector3().lerpVectors(a, b, 0.5));
          this.stats.banners++;
          if (banked) this.stats.bermScrimSpans++;
        }
        previousMounted = mounted;
        a = b;
      }
    };
    for (const berm of course.spec.berms) {
      if (!berm.side) continue;
      const arc = mod(berm.to - berm.from, track.length);
      const span = Math.min(arc * 0.8, 58), count = Math.floor(span / 8);
      if (count >= 2) run(berm.from + (arc - span) / 2, span / count, count, berm.side, true);
    }
    for (let s = 136; s < track.length - 100; s += 24)
      run(s - 4, 8, 1, Math.floor(s / 24) % 2 ? 1 : -1, false);
  }
  private banner(s: number, side: number, ends: [T.Vector3, T.Vector3], material: T.Material, row: number) {
    const along = ends[1].clone().sub(ends[0]);
    const normal = new T.Vector3(along.z, 0, -along.x).normalize();
    // Present the correctly printed face to the active racing lane on each
    // side. The reverse of a single-layer trackside banner transmits its ink.
    const g = new T.PlaneGeometry(1, 1, 24, 5);
    const p = g.getAttribute('position'), uv = g.getAttribute('uv');
    const wind = new Float32Array(p.count * 3);
    for (let i = 0; i < p.count; i++) {
      const u = uv.getX(i), v = uv.getY(i);
      const t = side < 0 ? 1 - u : u;
      const belly = 4 * t * (1 - t), hem = Math.sin(Math.PI * v);
      const y = T.MathUtils.lerp(ends[0].y, ends[1].y, t) + 0.25 + 0.72 * v
        - belly * (0.095 - 0.035 * hem);
      const crease = Math.sin((t * 5.4 + v * 0.48) * Math.PI * 2)
        + 0.32 * Math.sin((t * 10.8 - v * 0.65) * Math.PI * 2);
      const fold = belly * (0.036 + 0.062 * hem) * crease;
      // Ties hold each corner off the pole so the hems don't pass through it.
      const chordT = 0.004 + 0.992 * t;
      p.setXYZ(i, ends[0].x + along.x * chordT + normal.x * fold, y,
        ends[0].z + along.z * chordT + normal.z * fold);
      const deflection = belly * (0.030 + 0.041 * hem);
      wind.set([normal.x * deflection, normal.z * deflection, s * 0.21 + t * 12.4 + 2.1 * y], i * 3);
    }
    g.setAttribute('mxCloth', new T.Float32BufferAttribute(wind, 3));
    g.computeVertexNormals();
    this.part(mxAtlasRow(g, row), material);
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
    const plantGeometry = {
      grass: mxShoulderPlantGeometry('grass'),
      fern: mxShoulderPlantGeometry('fern'),
      scrub: mxShoulderPlantGeometry('scrub'),
      tuft: mxShoulderPlantGeometry('tuft'),
    };
    // The same low-frequency field clusters all three plant layers. Bare
    // loam gaps and short inner tufts leave room for the outside berm line.
    const patchAt = (x: number, z: number) => valueNoise(x * 0.055 + 7.2, z * 0.055 - 3.4);
    const normal = new T.Vector3(),
      up = new T.Vector3(0, 1, 0),
      origin = new T.Vector3(),
      corner = new T.Vector3(),
      nearest = trackPoint();
    const plantPose = (
      s: number,
      lateral: number,
      scale: number,
      kind: keyof typeof plantGeometry,
    ) => {
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
      // A convex crest renders as chords below the analytic surface; a root
      // sunk only 25 mm there would hover over the drawn triangle.
      const centre = surface.terrain.baseHeight(s, lateral),
        bulge =
          (surface.terrain.baseHeight(s, lateral - 0.5) +
            surface.terrain.baseHeight(s, lateral + 0.5) +
            surface.terrain.baseHeight(s - 1, lateral) +
            surface.terrain.baseHeight(s + 1, lateral)) /
            4 -
          centre;
      if (bulge < -0.018) return false;
      // 35 mm: the denser verge also samples triangle edges where the drawn
      // facet sits a few millimetres under the analytic height.
      origin.set(x, centre - 0.035, z);
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
    // Tall grass islands along the shoulder, about twice the earlier
    // density so the course edge reads as uncut verge rather than lawn.
    for (let i = 0; i < 9100; i++) {
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
      // Field stones keep their earlier count (one attempt per ~300 rolls).
      if (i % 30 !== 0) continue;
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
      this.object.rotation.set(
        random.next() * 0.7,
        random.next() * Math.PI * 2,
        random.next() * 0.5,
      );
      const rock = 0.5 + random.next() * 1.6;
      this.object.scale.set(rock, rock * 0.65, rock * 0.9);
      this.object.position.set(rockX, mxFurnitureGround(track, rockX, rockZ) + rock * 0.14, rockZ);
      this.object.updateMatrix();
      stonePoses.push(this.object.matrix.clone());
    }
    // Darker intermediate-height plants sit behind the cropped grass, in
    // connected patches rather than a uniform strip of identical bushes.
    for (let i = 0; i < 2100; i++) {
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
    // Close-cropped turf along the course edge: a dense, low band that the tall
    // grass islands above leave bare. The same grounding and clearance rules apply.
    const tuftPoses: T.Matrix4[] = [],
      tuftColours: T.Color[] = [];
    for (let i = 0; i < 28000; i++) {
      const s = random.next() * track.length,
        side = random.next() < 0.5 ? -1 : 1,
        p = track.at(s, this.point),
        outer = Math.pow(random.next(), 1.6),
        l = side * (surface.course.legalWidth(p.width, s, side) + 0.2 + outer * 3.6),
        patch = patchAt(p.x + p.nx * l, p.z + p.nz * l);
      if (random.next() > 0.5 + patch * 0.5 - outer * 0.25) continue;
      // Short blades cannot hide a root hovering over the rendered facets of a
      // crest or lip: keep to ground the one-by-half-metre grid follows closely.
      const ground = surface.terrain,
        bulge =
          (ground.baseHeight(s, l - 0.5) +
            ground.baseHeight(s, l + 0.5) +
            ground.baseHeight(s - 1, l) +
            ground.baseHeight(s + 1, l)) /
            4 -
          ground.baseHeight(s, l);
      const slope =
        Math.hypot(
          ground.baseHeight(s, l + 0.25) - ground.baseHeight(s, l - 0.25),
          ground.baseHeight(s + 0.25, l) - ground.baseHeight(s - 0.25, l),
        ) / 0.5;
      if (Math.abs(bulge) > 0.012 || slope > 0.2) continue;
      if (!plantPose(s, l, 0.7 + random.next() * 0.7, 'tuft')) continue;
      tuftPoses.push(this.object.matrix.clone());
      tuftColours.push(
        new T.Color().setHSL(
          0.17 + random.next() * 0.06,
          0.22 + random.next() * 0.14,
          0.2 + random.next() * 0.12 + patch * 0.05,
        ),
      );
    }
    const grassMaterial = mxShoulderPlantMaterial(this.venueTime, this.wind);
    const rockMaterial = new T.MeshStandardMaterial({
      color: 0x8b8376,
      vertexColors: true,
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
    // Their own group: the furniture root keeps its pinned submission budget.
    this.instances(
      'MX shoulder grass tufts',
      plantGeometry.tuft,
      grassMaterial,
      tuftPoses,
      tuftColours,
      this.turf,
    );
    const tufts = tuftPoses.length
      ? (this.turf.children.find((o) => o.name === 'MX shoulder grass tufts') as T.InstancedMesh)
      : null;
    // Low and Medium draw the earlier verge density (a uniform subset: the
    // poses are in random station order); High and Ultra draw it all.
    const verge = (
      ['MX shoulder grass islands', 'MX shoulder fern fans', 'MX shoulder broadleaf scrub'] as const
    )
      .map((name) => this.root.children.find((o) => o.name === name))
      .filter((o): o is T.InstancedMesh => o instanceof T.InstancedMesh)
      .map((mesh) => ({ mesh, full: mesh.count }));
    for (const { mesh } of verge) this.shoulderViews.push(new MxShoulderView(mesh));
    if (tufts) this.shoulderViews.push(new MxShoulderView(tufts));
    if (tufts || verge.length)
      this.stopTufts = onMxDetail((high) => {
        if (tufts) tufts.count = high ? tuftPoses.length : Math.floor(tuftPoses.length * 0.3);
        for (const { mesh, full } of verge) mesh.count = high ? full : Math.floor(full * 0.45);
      });
    this.instances('MX shoulder stones', mxFieldstoneGeometry(), rockMaterial, stonePoses);
    if (!grassPoses.length && !fernPoses.length && !shrubPoses.length && !tuftPoses.length)
      grassMaterial.dispose();
    if (!stonePoses.length) rockMaterial.dispose();
    this.stats.grassClumps = grassPoses.length;
    this.stats.fernClumps = fernPoses.length;
    this.stats.tufts = tuftPoses.length;
    this.stats.shrubs = shrubPoses.length;
    this.stats.stones = stonePoses.length;
  }
  /** Other eyes, reflections and survey tools see the complete original plants. */
  inCameraView(camera: T.Camera, draw: () => void) {
    if (this.shoulderViews.length === 0) return draw();
    camera.updateWorldMatrix(true, false);
    try {
      for (const family of this.shoulderViews) family.begin(camera);
      draw();
    } finally {
      for (const family of this.shoulderViews) family.end();
    }
  }
  update(time: number) {
    if (!this.disposed && Number.isFinite(time)) this.venueTime.value = Math.max(0, time);
  }
  dispose() {
    if (this.disposed) return;
    this.disposed = true;
    for (const family of this.shoulderViews) family.dispose();
    this.stopTufts?.();
    this.stopTufts = null;
    this.root.remove(this.trackside.root);
    this.trackside.dispose();
    disposeOffroadResources([this.root, this.turf], [], this.ownedTextures);
    this.ownedTextures.clear();
  }
}
