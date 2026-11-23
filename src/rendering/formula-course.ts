import * as T from 'three';
import { FormulaGridCamera } from './formula-grid-camera.ts';
import { FormulaEdgeProfile } from './formula-edge.ts';
import { carBase, R, RACE_BASE } from '../simulation/protocol.ts';
import { Track, trackPoint } from '../simulation/track.ts';
import { vehicleAt } from '../simulation/vehicles.ts';
import { box, canvasTexture, mergeStatic, mesh } from './geometry.ts';
import { inStandFootprint } from './grandstand.ts';
import { grassApronOffset } from './ground-profile.ts';
import { drawWordmark } from './studio/brand-atlas.ts';
import { tagWeatherSurface } from './weather-presentation.ts';
import { gpWindMast, type GpWindSleeve } from './venue-kit/gp-windsock.ts';

type StationKind = 'activation' | 'detection';
export interface FormulaStation {
  s: number;
  kind: StationKind;
  lateral: number;
  x: number;
  y: number;
  z: number;
  yaw: number;
}

/** Both the graphic and timing loop use the rule station, including a zone crossing the lap seam. */
export function formulaStations(track: Track) {
  const stations: FormulaStation[] = [];
  for (const zone of track.circuit.drsZones) {
    for (const kind of ['detection', 'activation'] as const) {
      const s = kind === 'detection' ? zone.detect : zone.start;
      if (stations.some((station) => station.kind === kind && station.s === s)) continue;
      const p = track.at(s, trackPoint());
      // Stay behind the barrier and out of the pit working lane. Try the other
      // verge if the first backs onto a grandstand at this exact station.
      for (const side of [-track.pit.side, track.pit.side]) {
        const lateral = side * (track.boundaryAt(p, side) + 1.55);
        const x = p.x + p.nx * lateral;
        const z = p.z + p.nz * lateral;
        if (inStandFootprint(track, x, z, 1.05)) continue;
        stations.push({
          s,
          kind,
          lateral,
          x,
          z,
          y:
            p.y +
            p.bank * T.MathUtils.clamp(lateral, -12, 12) +
            grassApronOffset(track, s, lateral),
          yaw: Math.atan2(-p.tx, -p.tz),
        });
        break;
      }
    }
  }
  return stations;
}

/** Position the wind indicator at a braking approach where it can be read
 * against the sky. Keep its textile's full reach out of the seats and lane. */
export function formulaWindSites(track: Track, stations = formulaStations(track)) {
  if (track.gpEdges) return [];
  const sites: { s: number; position: T.Vector3; yaw: number }[] = [];
  for (const board of stations) {
    if (board.kind !== 'detection') continue;
    const side = Math.sign(board.lateral);
    for (const advance of [-11, 16, -24]) {
      const s = (board.s + advance + track.length) % track.length;
      const p = track.at(s, trackPoint());
      const lateral = side * (track.boundaryAt(p, side) + 3.25);
      const x = p.x + p.nx * lateral,
        z = p.z + p.nz * lateral;
      if (inStandFootprint(track, x, z, 2.75)) continue;
      const y =
        p.y + p.bank * T.MathUtils.clamp(lateral, -12, 12) + grassApronOffset(track, s, lateral);
      sites.push({ s, position: new T.Vector3(x, y, z), yaw: Math.atan2(p.tx, p.tz) });
      break;
    }
    if (sites.length === 2) break;
  }
  return sites;
}

function panelAtlas() {
  return canvasTexture(512, 512, (ctx) => {
    for (const [i, caption] of ['ACTIVATION', 'DETECTION'].entries()) {
      const y = i * 256;
      ctx.fillStyle = '#dcded9';
      ctx.fillRect(0, y, 512, 256);
      ctx.fillStyle = '#252b2b';
      ctx.fillRect(8, y + 8, 496, 240);
      ctx.fillStyle = '#eceee8';
      ctx.fillRect(13, y + 13, 486, 181);
      ctx.strokeStyle = '#191f20';
      drawWordmark(ctx, 'DRS', 256, y + 105, 118, { weight: 0.18, width: 1.06 });
      ctx.strokeStyle = '#d9dedb';
      drawWordmark(ctx, caption, 256, y + 220, 24, { weight: 0.17, tracking: 0.16 });
      ctx.fillStyle = i ? '#dba54b' : '#7ebb9a';
      ctx.fillRect(19, y + 201, 11, 36);
      ctx.fillRect(482, y + 201, 11, 36);
    }
  });
}

/** At the kerb, short edge ticks identify the buried detection loop. The one
 * continuous transverse stripe belongs to activation. All corners lie in the
 * banked road plane, with triangle winding toward the upper road surface. */
export function formulaTimingPaint(track: Track, station: FormulaStation) {
  const pos: number[] = [];
  const indices: number[] = [];
  const bands =
    station.kind === 'activation'
      ? [[-1, 1]]
      : [
          [-1, -0.8],
          [0.8, 1],
        ];
  const offsets = station.kind === 'activation' ? [0] : [-0.18, 0.18];
  const half = station.kind === 'activation' ? 0.085 : 0.05;
  const p = trackPoint();
  for (const offset of offsets) {
    for (const [left, right] of bands) {
      const base = pos.length / 3;
      for (const along of [-half, half]) {
        track.at(station.s + offset + along, p);
        for (const f of [left, right]) {
          const l = (p.width - 0.16) * f;
          pos.push(p.x + p.nx * l, p.y + p.bank * l + 0.006, p.z + p.nz * l);
        }
      }
      indices.push(base, base + 2, base + 1, base + 2, base + 3, base + 1);
    }
  }
  const g = new T.BufferGeometry();
  g.setAttribute('position', new T.Float32BufferAttribute(pos, 3));
  g.setIndex(indices);
  g.computeVertexNormals();
  g.computeBoundingSphere();
  return g;
}

export class FormulaCourse {
  readonly root = new T.Group();
  readonly active = { value: 0 };
  readonly edges: FormulaEdgeProfile | null;
  gridCamera?: FormulaGridCamera;
  readonly windSleeves: GpWindSleeve[] = [];
  presentWind(wind: T.Vector4) {
    if (this.root.visible) for (const sleeve of this.windSleeves) sleeve.presentWorld(wind);
  }
  constructor(readonly track: Track) {
    this.root.name = 'Formula timing stations';
    this.root.visible = false;
    this.edges = track.gpEdges ? null : FormulaEdgeProfile.forTrack(track);
  }
  select(frame: Float32Array, count: number) {
    let active = false;
    for (let i = 0; i < count; i++) {
      if (vehicleAt(Math.round(frame[carBase(i) + RACE_BASE + R.VEHICLE])).drs) {
        active = true;
        break;
      }
    }
    if (active === this.root.visible) return false;
    this.root.visible = active;
    this.active.value = active ? 1 : 0;
    return true;
  }
  build() {
    const stations = formulaStations(this.track);
    if (!stations.length) return;
    const hardware = tagWeatherSurface(
      new T.MeshStandardMaterial({
        color: 0x929c9d,
        roughness: 0.54,
        metalness: 0.65,
      }),
      'metal',
      0.7,
    );
    this.gridCamera = new FormulaGridCamera(this.track, hardware);
    this.root.add(this.gridCamera.root);
    for (const site of formulaWindSites(this.track, stations)) {
      const mast = gpWindMast(hardware);
      mast.root.name = 'Formula braking-zone weather mast';
      mast.sleeve.mesh.name = 'Formula wind indicator';
      mast.root.position.copy(site.position);
      mast.root.rotation.y = site.yaw;
      this.root.add(mast.root);
      this.windSleeves.push(mast.sleeve);
    }
    const print = tagWeatherSurface(
      new T.MeshStandardMaterial({ map: panelAtlas(), roughness: 0.59 }),
      'paint',
      0.75,
    );
    const paint = tagWeatherSurface(
      new T.MeshStandardMaterial({
        color: 0xbabcb3,
        roughness: 0.72,
        polygonOffset: true,
        polygonOffsetFactor: -2,
        polygonOffsetUnits: -2,
      }),
      'paint',
      1,
    );
    for (const station of stations) {
      const board = new T.Group();
      board.name = 'DRS ' + station.kind;
      const wide = station.kind === 'activation' ? 1.8 : 1.46;
      const high = wide / 2;
      const centre = 2.35;
      for (const side of [-1, 1]) {
        box(board, hardware, side * wide * 0.31, 1.18, -0.08, 0.065, 2.54, 0.077);
        box(board, hardware, side * wide * 0.31, 0.025, -0.08, 0.23, 0.12, 0.24);
      }
      box(board, hardware, 0, centre, 0, wide + 0.025, high + 0.025, 0.067);
      for (const side of [-1, 1])
        box(board, hardware, 0, centre + side * high * 0.33, -0.073, wide * 0.94, 0.042, 0.064);
      const panel = new T.PlaneGeometry(wide, high);
      const uv = panel.getAttribute('uv');
      for (let i = 0; i < uv.count; i++)
        uv.setY(i, uv.getY(i) * 0.492 + (station.kind === 'activation' ? 0.504 : 0.004));
      mesh(board, panel, print, 0, centre, 0.034);
      mergeStatic(board);
      board.position.set(station.x, station.y, station.z);
      board.rotation.y = station.yaw;
      this.root.add(board);
      const stripe = mesh(this.root, formulaTimingPaint(this.track, station), paint);
      stripe.name = 'Timing paint at ' + station.s;
      stripe.castShadow = false;
    }
  }
}
