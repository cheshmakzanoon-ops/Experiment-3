import * as T from 'three';
import { clamp } from '../core/math.ts';
import { FLAG } from '../simulation/marshal.ts';
import { H } from '../simulation/protocol.ts';
import { Track, trackPoint } from '../simulation/track.ts';
import { drainSide, drainStations } from '../simulation/surface-drainage.ts';
import { box, mesh } from './geometry.ts';
import { grassApronOffset } from './ground-profile.ts';
import { inStandFootprint } from './grandstand.ts';
import { tracksideRigs } from './trackside.ts';

export interface TrackDetailSite {
  kind: 'drain' | 'marshal' | 'utility' | 'camera';
  s: number;
  side: -1 | 1;
  lateral: number;
  x: number;
  y: number;
  z: number;
  yaw: number;
  rigId?: number;
  cameraY?: number;
  supported?: boolean;
}

export interface TrackInfrastructurePlan {
  drains: readonly TrackDetailSite[];
  marshalPosts: readonly TrackDetailSite[];
  utilities: readonly TrackDetailSite[];
  cameras: readonly TrackDetailSite[];
}

const MARSHAL_STATIONS = Object.freeze([
  365, 575, 870, 1165, 1415, 1635, 1875, 2075, 2305, 2485, 2675, 2850,
]);
const UTILITY_SPACING_M = 185;

function preferredSide(track: Track, s: number, ordinal: number): -1 | 1 {
  const p = track.at(s, trackPoint());
  return drainSide(p.bank, p.curvature, ordinal);
}

function groundHeight(track: Track, x: number, z: number) {
  const p = trackPoint(),
    lateral = track.nearest(x, z, p);
  return p.y + p.bank * clamp(lateral, -12, 12) + grassApronOffset(track, p.s, lateral);
}

function siteAt(
  track: Track,
  kind: TrackDetailSite['kind'],
  s: number,
  side: -1 | 1,
  lateral: number,
): TrackDetailSite {
  const p = track.at(s, trackPoint()),
    x = p.x + p.nx * lateral,
    z = p.z + p.nz * lateral;
  return {
    kind,
    s,
    side,
    lateral,
    x,
    y: groundHeight(track, x, z),
    z,
    yaw: Math.atan2(p.tx, p.tz),
  };
}

function clearMarshalSide(track: Track, s: number, preferred: -1 | 1): -1 | 1 {
  const alternatives: readonly (-1 | 1)[] = [preferred, preferred === 1 ? -1 : 1];
  for (const side of alternatives) {
    const p = track.at(s, trackPoint()),
      lateral = side * (track.boundary(s, side) + 4.4),
      x = p.x + p.nx * lateral,
      z = p.z + p.nz * lateral;
    if (!inStandFootprint(track, x, z, 1.5)) return side;
  }
  return preferred;
}

/** Deterministic authored/rule-based near-track detail. Nothing is randomly scattered:
 * drainage follows the low/outside edge, marshal shelters use fixed stations and avoid
 * grandstands, utility cabinets use a fixed service cadence, and physical camera towers
 * share the exact replay-camera positions. */
export function trackInfrastructurePlan(track: Track): TrackInfrastructurePlan {
  const drains = drainStations(track.length).map(({ s, ordinal }) => {
    const side = preferredSide(track, s, ordinal),
      p = track.at(s, trackPoint()),
      lateral = side * (p.width + 1.42);
    return siteAt(track, 'drain', s, side, lateral);
  });

  const marshalPosts = MARSHAL_STATIONS.filter((s) => s < track.length - 60).map((s, i) => {
    const preferred = preferredSide(track, s, i),
      side = clearMarshalSide(track, s, preferred),
      lateral = side * (track.boundary(s, side) + 4.4);
    return siteAt(track, 'marshal', s, side, lateral);
  });

  const utilities: TrackDetailSite[] = [];
  for (let s = 395, i = 0; s < track.length - 260; s += UTILITY_SPACING_M, i++) {
    let side = preferredSide(track, s, i);
    const point = track.at(s, trackPoint());
    let lateral = side * (track.boundary(s, side) + 2.4);
    const x = point.x + point.nx * lateral,
      z = point.z + point.nz * lateral;
    if (inStandFootprint(track, x, z, 1)) {
      side = side === 1 ? -1 : 1;
      lateral = side * (track.boundary(s, side) + 2.4);
    }
    utilities.push(siteAt(track, 'utility', s, side, lateral));
  }

  const cameras = tracksideRigs(track).map((rig) => {
    const near = trackPoint(),
      lateral = track.nearest(rig.position.x, rig.position.z, near),
      side: -1 | 1 = lateral < 0 ? -1 : 1,
      ground = groundHeight(track, rig.position.x, rig.position.z);
    return {
      kind: 'camera' as const,
      s: near.s,
      side,
      lateral,
      x: rig.position.x,
      y: ground,
      z: rig.position.z,
      yaw: Math.atan2(near.tx, near.tz),
      rigId: rig.id,
      cameraY: rig.position.y,
      supported: !inStandFootprint(track, rig.position.x, rig.position.z, 0.7),
    };
  });
  return { drains, marshalPosts, utilities, cameras };
}

export function safetyPanelAppearance(flag: number) {
  switch (flag) {
    case FLAG.YELLOW:
      return { color: 0xffb000, intensity: 3.6 };
    case FLAG.DOUBLE_YELLOW:
      return { color: 0xff8a00, intensity: 5.2 };
    case FLAG.BLUE:
      return { color: 0x2b7cff, intensity: 3.2 };
    case FLAG.CHEQUERED:
      return { color: 0xf2f2e9, intensity: 2.8 };
    default:
      return { color: 0x2a5636, intensity: 0.18 };
  }
}

export function updateSafetyPanel(material: T.MeshStandardMaterial, frame: Float32Array) {
  const state = safetyPanelAppearance(frame[H.FLAG]);
  material.color.setHex(state.color);
  material.emissive.setHex(state.color);
  material.emissiveIntensity = state.intensity;
}

function placeRoot(root: T.Object3D, site: TrackDetailSite) {
  root.position.set(site.x, site.y, site.z);
  root.rotation.y = site.yaw;
}

/** Adds static, spatially batchable circuit-life geometry. The only intentionally
 * dynamic material is the shared marshal LED panel, which consumes the real race flag. */
export function buildTrackInfrastructure(
  track: Track,
  parent: T.Group,
  safetyPanel: T.MeshStandardMaterial,
  plan: TrackInfrastructurePlan = trackInfrastructurePlan(track),
) {
  const concrete = new T.MeshStandardMaterial({ color: 0x777a75, roughness: 0.92 }),
    steel = new T.MeshStandardMaterial({ color: 0x4f5a5d, metalness: 0.72, roughness: 0.47 }),
    dark = new T.MeshStandardMaterial({ color: 0x1a2022, metalness: 0.35, roughness: 0.56 }),
    safety = new T.MeshStandardMaterial({ color: 0xdc6a2d, roughness: 0.73 }),
    lens = new T.MeshPhysicalMaterial({
      color: 0x1c262a,
      metalness: 0.12,
      roughness: 0.08,
      transmission: 0.08,
      clearcoat: 0.7,
      clearcoatRoughness: 0.1,
    });

  const drainGeometry = new T.BoxGeometry(0.42, 0.025, 1.65);
  for (const site of plan.drains) {
    const drain = mesh(parent, drainGeometry, dark);
    placeRoot(drain, site);
    drain.position.y += 0.012;
    drain.name = `Low-edge drainage ${Math.round(site.s)}m`;
  }

  for (const [index, site] of plan.marshalPosts.entries()) {
    const g = new T.Group();
    g.name = `Marshal shelter ${index + 1}`;
    placeRoot(g, site);
    parent.add(g);
    // Level concrete pad, open track-facing shelter, equipment cabinet and a real-state LED board.
    box(g, concrete, 0, 0.09, 0, 3.1, 0.18, 2.5);
    box(g, safety, site.side * 1.35, 1.25, 0, 0.12, 2.35, 2.5);
    box(g, steel, 0, 2.42, 0, 3.2, 0.14, 2.65);
    box(g, steel, -site.side * 1.16, 1.18, -1.02, 0.09, 2.25, 0.09);
    box(g, steel, -site.side * 1.16, 1.18, 1.02, 0.09, 2.25, 0.09);
    box(g, dark, site.side * 0.88, 0.72, -0.62, 0.48, 1.3, 0.58);
    box(g, safetyPanel, -site.side * 1.42, 1.85, 0, 0.09, 0.72, 1.15);
    // Two compact extinguisher cylinders make the station read as safety infrastructure.
    for (const z of [-0.7, 0.7]) {
      const extinguisher = mesh(g, new T.CylinderGeometry(0.09, 0.09, 0.62, 10), safety);
      extinguisher.position.set(site.side * 0.63, 0.4, z);
    }
  }

  for (const [index, site] of plan.utilities.entries()) {
    const g = new T.Group();
    g.name = `Track utility cabinet ${index + 1}`;
    placeRoot(g, site);
    parent.add(g);
    box(g, concrete, 0, 0.06, 0, 0.95, 0.12, 0.72);
    box(g, steel, 0, 0.68, 0, 0.72, 1.2, 0.52);
    box(g, dark, -0.37, 0.78, 0.08, 0.015, 0.42, 0.22);
  }

  for (const site of plan.cameras) {
    const g = new T.Group();
    g.name = `Replay camera infrastructure ${site.rigId}`;
    placeRoot(g, site);
    parent.add(g);
    const cameraHeight = Math.max(1.2, (site.cameraY ?? site.y + 3) - site.y);
    if (site.supported) {
      box(g, concrete, 0, 0.08, 0, 1.3, 0.16, 1.3);
      box(g, steel, 0, cameraHeight * 0.5, 0, 0.12, cameraHeight, 0.12);
      box(g, steel, 0, cameraHeight - 0.22, 0, 1.15, 0.12, 1.0);
      for (const x of [-0.47, 0.47]) box(g, steel, x, cameraHeight - 0.02, 0, 0.055, 0.5, 1.0);
    }
    const camera = new T.Group();
    camera.position.set(0, cameraHeight + 0.12, 0);
    camera.rotation.y = site.side > 0 ? Math.PI / 2 : -Math.PI / 2;
    g.add(camera);
    box(camera, dark, 0, 0, 0, 0.36, 0.26, 0.62);
    const barrel = mesh(camera, new T.CylinderGeometry(0.1, 0.13, 0.3, 12), lens, 0, 0, -0.44);
    barrel.rotation.x = Math.PI / 2;
  }

  return plan;
}
