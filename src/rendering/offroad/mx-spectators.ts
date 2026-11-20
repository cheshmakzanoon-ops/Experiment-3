import * as T from 'three';
import { disposeOffroadResources } from './owned-resources.ts';
import { mod, Random } from '../../core/math.ts';
import { TrackTerrainSurface } from '../../simulation/offroad/course-terrain.ts';
import { Track, trackPoint } from '../../simulation/track.ts';
import { installCrowdShader, spectatorGeometry, spectatorVariation } from '../crowd.ts';
import { inStandFootprint } from '../grandstand.ts';
import { tagWeatherSurface } from '../weather-presentation.ts';
import { onMxDetail } from './mx-quality.ts';
import {
  mxFurnitureGround,
  mxMarshalLocations,
  type MxFurnitureSite,
} from './mx-trackside-furniture.ts';

/** Who stands where at an outdoor motocross: groups of onlookers behind the
 * tape at the jumps, the start and the turns, and a flag marshal at each
 * marshal post. Presentation only: nobody stands on the course, in a rider's
 * run-off, in the stands' footprint or among the service furniture, and the
 * simulation never sees them. Deterministic per course. */
export interface MxSpectatorPlacement {
  kind: 'spectator' | 'marshal';
  x: number;
  y: number;
  z: number;
  /** Yaw about +Y of the local +Z facing, toward the course. */
  yaw: number;
  station: number;
  side: 1 | -1;
}

/** Lateral clearance beyond the legal edge (m): tape, then the run-off a
 * rider may use when a line goes wide. */
export const MX_SPECTATOR_SETBACK = 3.2;
const MAX_SLOPE = 0.32;
/** Share kept on Low and Medium. */
const LOW_SHARE = 0.35;

export function planMxSpectators(track: Track, furniture: readonly MxFurnitureSite[]) {
  const surface = Track.offroadOf(track);
  if (!(surface instanceof TrackTerrainSurface) || surface.kind !== 'motocross')
    return { placements: [] as MxSpectatorPlacement[], groups: 0 };
  const course = surface.course,
    random = new Random(60217),
    point = trackPoint(),
    nearby = trackPoint(),
    placements: MxSpectatorPlacement[] = [];
  const marshals = mxMarshalLocations(track, furniture);
  const taken: { x: number; z: number }[] = [...marshals];
  const slope = (x: number, z: number) => {
    const h = 0.4;
    return (
      Math.hypot(
        mxFurnitureGround(track, x + h, z) - mxFurnitureGround(track, x - h, z),
        mxFurnitureGround(track, x, z + h) - mxFurnitureGround(track, x, z - h),
      ) /
      (2 * h)
    );
  };
  const accept = (x: number, z: number, stationHint: number) => {
    const lateral = track.nearest(x, z, nearby),
      gap = Math.abs(
        mod(nearby.s - stationHint + track.length / 2, track.length) - track.length / 2,
      );
    // The nearest road must be the one this viewpoint was chosen for, and the
    // person must be well outside it (and its legal edge, jumps' side fall-away).
    if (gap > 10) return null;
    if (
      Math.abs(lateral) <
      course.legalWidth(nearby.width, nearby.s, lateral) + MX_SPECTATOR_SETBACK
    )
      return null;
    if (
      inStandFootprint(track, x, z, 3) ||
      (track.isPitSection(nearby.s) && lateral * track.pit.side > 0)
    )
      return null;
    for (const site of furniture)
      if (Math.hypot(site.x - x, site.z - z) < site.radius + 0.7) return null;
    for (const other of taken) if (Math.hypot(other.x - x, other.z - z) < 0.72) return null;
    if (slope(x, z) > MAX_SLOPE) return null;
    // Face the nearest part of the course, with a little individual drift.
    const toward = Math.atan2(nearby.x - x, nearby.z - z);
    taken.push({ x, z });
    return {
      kind: 'spectator',
      x,
      y: mxFurnitureGround(track, x, z),
      z,
      yaw: toward + (random.next() - 0.5) * 0.9,
      station: nearby.s,
      side: (lateral < 0 ? -1 : 1) as 1 | -1,
    } satisfies MxSpectatorPlacement;
  };
  // Viewpoints: where an event draws a crowd.
  const views: { s: number; side: 1 | -1 | 0; size: number }[] = [];
  for (const jump of course.jumps) {
    // Jumps draw the deepest crowds: a packed bank at every landing and,
    // usually, a second one watching the take-off.
    views.push({ s: jump.landing + 2, side: 0, size: 15 + Math.floor(random.next() * 8) });
    if (random.next() < 0.7)
      views.push({ s: jump.takeoff - 3, side: 0, size: 8 + Math.floor(random.next() * 6) });
  }
  const gate = course.spec.gate;
  if (gate) {
    views.push({ s: gate.s - 20, side: 0, size: 14 }, { s: gate.s - 8, side: 0, size: 12 });
    views.push({ s: gate.holeshot, side: 0, size: 14 });
  }
  for (let s = 20; s < track.length - 10; s += 24 + random.next() * 18)
    views.push({ s, side: 0, size: 3 + Math.floor(random.next() * 5) });
  let groups = 0;
  for (const view of views) {
    const side = view.side || (random.next() < 0.5 ? -1 : 1);
    const at = track.at(mod(view.s, track.length), point);
    const legal = course.legalWidth(at.width, at.s, side);
    const back = MX_SPECTATOR_SETBACK + 0.8 + random.next() * 6;
    const cx = at.x + at.nx * side * (legal + back),
      cz = at.z + at.nz * side * (legal + back);
    let added = 0;
    for (let k = 0; k < view.size * 6 && added < view.size; k++) {
      const a = random.next() * Math.PI * 2,
        r = Math.sqrt(random.next()) * (1.1 + view.size * 0.28);
      const along = Math.cos(a) * r * 1.5,
        across = Math.sin(a) * r;
      const x = cx + at.tx * along + at.nx * across,
        z = cz + at.tz * along + at.nz * across;
      const found = accept(x, z, at.s);
      if (!found) continue;
      placements.push(found);
      added++;
    }
    if (added) groups++;
  }
  for (const { s, x, y, z, side, yaw } of marshals)
    placements.push({ kind: 'marshal', station: s, x, y, z, side, yaw });
  return { placements, groups };
}

const WARDROBE = [
  0x27313d, 0x252a2d, 0x314655, 0x45463f, 0x4a3934, 0x444f3f, 0x686b66, 0x817c6e, 0xb4afa2,
  0xd6d0be, 0x923f37, 0x426889, 0x6a7a4e, 0x8d5f3a,
];
const SKIN = [0xe0b497, 0xc39473, 0xa77454, 0x85573d, 0x61412f, 0x422c21];

/** Station span of one instanced draw: culling works on whole meshes. */
const CHUNK = 140;

export class MxSpectators {
  readonly root = new T.Group();
  readonly stats = { spectators: 0, marshals: 0, groups: 0, triangles: 0, draws: 0 };
  readonly plan: ReturnType<typeof planMxSpectators>;
  private readonly crowds: { mesh: T.InstancedMesh; total: number }[] = [];
  private readonly uniforms = {
    crowdClock: { value: new T.Vector2() },
    crowdMotion: { value: 0.28 },
    crowdReaction: { value: new T.Vector2(0.5, 0.3) },
  };
  private readonly unsubscribe: (() => void) | null = null;
  private disposed = false;
  constructor(track: Track, furniture: readonly MxFurnitureSite[]) {
    this.root.name = 'MX spectators and flag marshals';
    this.plan = planMxSpectators(track, furniture);
    // Race officials render through the articulated marshal rig at every
    // graphics preset. Only the public is part of the thinned crowd.
    const placements = this.plan.placements.filter((p) => p.kind === 'spectator');
    this.stats.marshals = this.plan.placements.length - placements.length;
    if (!placements.length) return;
    const random = new Random(31337);
    const wardrobe = WARDROBE.map((c) => new T.Color(c)),
      skinTones = SKIN.map((c) => new T.Color(c));
    const material = new T.MeshStandardMaterial({
      color: 0xffffff,
      roughness: 0.94,
      vertexColors: true,
      name: 'MX spectator fabric, skin and hair',
    });
    // Outdoors, unlike the covered bowl: damp cloth in rain, as the stands' crowd.
    tagWeatherSurface(material, 'fabric', 0.55, 'spectator');
    installCrowdShader(material, this.uniforms, true);
    const depth = new T.MeshDepthMaterial({ depthPacking: T.RGBADepthPacking });
    installCrowdShader(depth, this.uniforms, false);
    const standing = new T.Matrix4().makeRotationY(Math.PI / 2).setPosition(0, 0.3, 0.02),
      base = new T.Matrix4(),
      pose = new T.Matrix4(),
      colour = new T.Color();
    const kit = spectatorGeometry(1);
    // One draw per stretch of course. A random order inside each, so the
    // Low/Medium subset thins every group evenly.
    const chunks = new Map<number, MxSpectatorPlacement[]>();
    for (const p of placements) {
      const key = Math.floor(p.station / CHUNK);
      const list = chunks.get(key);
      if (list) list.push(p);
      else chunks.set(key, [p]);
    }
    let identity = 0;
    for (const [key, list] of chunks) {
      for (let i = list.length - 1; i > 0; i--) {
        const j = Math.floor(random.next() * (i + 1));
        [list[i], list[j]] = [list[j], list[i]];
      }
      const count = list.length,
        phase = new Float32Array(count),
        skin = new Float32Array(count * 3),
        style = new Float32Array(count * 4);
      const geometry = kit.clone();
      const mesh = new T.InstancedMesh(geometry, material, count);
      list.forEach((p, slot) => {
        phase[slot] = random.next() * Math.PI * 2;
        const tone = skinTones[Math.floor(random.next() * skinTones.length)];
        skin.set([tone.r, tone.g, tone.b], slot * 3);
        // Everyone stands: this is a field, not a bowl of seats.
        const variation = spectatorVariation(identity++, 60217, true);
        style.set([variation[0], variation[1], 1, variation[3]], slot * 4);
        base.makeRotationY(p.yaw).setPosition(p.x, p.y, p.z);
        pose.multiplyMatrices(base, standing);
        mesh.setMatrixAt(slot, pose);
        colour.copy(wardrobe[Math.floor(random.next() * wardrobe.length)]);
        colour.multiplyScalar(0.85 + random.next() * 0.25);
        this.stats.spectators++;
        mesh.setColorAt(slot, colour);
      });
      geometry.setAttribute('spectatorPhase', new T.InstancedBufferAttribute(phase, 1));
      geometry.setAttribute('spectatorSkin', new T.InstancedBufferAttribute(skin, 3));
      geometry.setAttribute('spectatorStyle', new T.InstancedBufferAttribute(style, 4));
      mesh.name = `MX standing spectators ${key * CHUNK}-${(key + 1) * CHUNK} m`;
      mesh.customDepthMaterial = depth;
      mesh.castShadow = true;
      mesh.receiveShadow = true;
      mesh.computeBoundingBox();
      mesh.computeBoundingSphere();
      // The shared shader's bounded forearm/gaze envelope and a raised cup.
      mesh.boundingBox!.expandByScalar(0.6);
      mesh.boundingSphere!.radius += 0.6;
      this.crowds.push({ mesh, total: count });
      this.root.add(mesh);
      this.stats.triangles += ((geometry.getIndex()?.count ?? 0) / 3) * count;
    }
    kit.dispose();
    this.stats.draws = this.crowds.length;
    this.stats.groups = this.plan.groups;
    this.unsubscribe = onMxDetail((high) => {
      for (const { mesh, total } of this.crowds)
        mesh.count = high ? total : Math.floor(total * LOW_SHARE);
    });
  }
  /** Absolute simulation time only. */
  update(time: number) {
    if (this.disposed || !Number.isFinite(time)) return;
    const cycle = Math.PI * 2;
    this.uniforms.crowdClock.value.set((time * 0.71) % cycle, (time * 0.43) % cycle);
    this.uniforms.crowdReaction.value.set(0.55 + Math.sin(time * 0.37) * 0.15, 0.32);
  }
  dispose() {
    if (this.disposed) return;
    this.disposed = true;
    this.unsubscribe?.();
    disposeOffroadResources([this.root]);
    this.crowds.length = 0;
  }
}
