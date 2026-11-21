import * as T from 'three';
import { CAR_STRIDE, F, H, HEADER, R, RACE_BASE, carBase } from '../../simulation/protocol.ts';
import { PHASE } from '../../simulation/race.ts';
import type { Track } from '../../simulation/track.ts';
import { vehicleAt } from '../../simulation/vehicles.ts';
import { bikeEntrantScheme } from '../bike-sheet.ts';
import { box, mergeStatic } from '../geometry.ts';
import { gpRaceNumber } from '../gp-race-bodywork.ts';
import { chainShaderHook, injectAfter } from '../studio/shader-hooks.ts';
import { tagWeatherSurface } from '../weather-presentation.ts';
import { writeGpBoardGlyph } from './gp-pit-boards.ts';
import { gpRaceControlSite } from './gp-race-control.ts';

const ROWS = 5,
  BLANK = 15;
const FACE_WIDTH = 3.48,
  FACE_HEIGHT = 6.12;

// Each quad is a replaceable LED module. Colour carries the fixed position
// column and the warmer lap header. Only the glyph UVs change during a race.
function displayFace(atlas: T.Texture) {
  const positions: number[] = [],
    colors: number[] = [],
    indices: number[] = [];
  const amber = new T.Color(0xffb345),
    white = new T.Color(0xe9f6ed),
    green = new T.Color(0x8ac8a8);
  function cell(x: number, y: number, width: number, height: number, tint: T.Color) {
    const i = positions.length / 3;
    for (const [u, v] of [
      [-1, -1],
      [1, -1],
      [1, 1],
      [-1, 1],
    ]) {
      positions.push(x + (u * width) / 2, y + (v * height) / 2, 0.222);
      colors.push(tint.r, tint.g, tint.b);
    }
    indices.push(i, i + 1, i + 2, i, i + 2, i + 3);
  }
  cell(-1.06, 5.58, 0.44, 0.68, amber);
  cell(0.37, 5.58, 0.58, 0.76, amber);
  cell(1.01, 5.58, 0.58, 0.76, amber);
  for (let row = 0; row < ROWS; row++) {
    const y = 4.63 - row * 0.97;
    cell(-1.02, y, 0.46, 0.69, green);
    cell(0.36, y, 0.62, 0.82, white);
    cell(1.02, y, 0.62, 0.82, white);
  }
  const geometry = new T.BufferGeometry(),
    uv = new T.Float32BufferAttribute(new Float32Array((positions.length / 3) * 2), 2);
  geometry.setIndex(indices);
  geometry.setAttribute('position', new T.Float32BufferAttribute(positions, 3));
  geometry.setAttribute('color', new T.Float32BufferAttribute(colors, 3));
  geometry.setAttribute('uv', uv.setUsage(T.DynamicDrawUsage));
  geometry.computeBoundingSphere();
  const lamps = new T.MeshBasicMaterial({
    name: 'GP classification LED modules',
    map: atlas,
    vertexColors: true,
  });
  chainShaderHook(lamps, 'gp-led-modules-v1', (shader) => {
    injectAfter(
      shader,
      'map_fragment',
      /* glsl */ `
#ifdef USE_MAP
  vec2 grid = vMapUv * vec2(104.0,144.0);
  vec2 footprint = fwidth(grid);
  float resolve = 1.0-smoothstep(0.19,0.55,max(footprint.x,footprint.y));
  vec2 diode=fract(grid)-0.5;
  diffuseColor.rgb *= 1.0+resolve*(0.17-0.36*smoothstep(0.14,0.49,length(diode)));
#endif`,
      'fragment',
    );
  });
  const mesh = new T.Mesh(geometry, lamps);
  mesh.name = 'Recorded top five and leader lap';
  return { mesh, uv };
}

/** Pit straight classification panel mounted just inside the control building's
 * plinth. Its face turns toward approaching riders, on either handed pit lane.
 * No timer or construct-time ranking: seeking applies the recorded order. */
export class GpClassification {
  readonly root = new T.Group();
  private readonly uv: T.BufferAttribute;
  private dirty = false;
  private readonly previous = new Uint8Array((ROWS + 1) * 3).fill(255);
  private readonly order = new Int16Array(ROWS);

  constructor(track: Track, atlas: T.Texture) {
    const site = gpRaceControlSite(track);
    if (!site) throw new Error('GP classification requires a GP race control site');
    const end = -track.pit.side;
    const frame = new T.Group();
    const metal = new T.MeshStandardMaterial({
      color: 0x839198,
      roughness: 0.43,
      metalness: 0.73,
      name: 'Timing board folded aluminium',
    });
    const casework = new T.MeshStandardMaterial({
      color: 0x192127,
      roughness: 0.67,
      metalness: 0.18,
      name: 'Timing board modular cabinets',
    });
    tagWeatherSurface(metal, 'metal');
    tagWeatherSurface(casework, 'paint');
    // Box feet and crossbars land on the tower plinth; the brackets tie the
    // rear of the cabinet to it and leave room for cooling and cable access.
    for (const x of [-1.08, 1.08]) {
      box(frame, metal, x, -0.29, -0.1, 0.16, 1.65, 0.19);
      box(frame, metal, x, -1.09, -0.1, 0.39, 0.085, 0.42);
      for (const y of [0.78, 4.35]) box(frame, metal, x, y, -0.64, 0.14, 0.15, 1.28);
    }
    box(frame, casework, 0, FACE_HEIGHT / 2, 0, FACE_WIDTH, FACE_HEIGHT, 0.43);
    for (const x of [-1.76, 1.76])
      box(frame, metal, x, FACE_HEIGHT / 2, 0.065, 0.065, FACE_HEIGHT + 0.14, 0.48);
    for (const y of [0, 5.12, FACE_HEIGHT]) box(frame, metal, 0, y, 0.08, FACE_WIDTH, 0.075, 0.48);
    for (let row = 0; row < ROWS; row++) {
      const y = 5.1 - row * 0.97;
      box(frame, casework, 0, y, 0.242, FACE_WIDTH - 0.07, 0.042, 0.14);
      box(frame, metal, 0, y - 0.52, -0.24, FACE_WIDTH - 0.18, 0.054, 0.12);
    }
    box(frame, casework, 0, FACE_HEIGHT + 0.1, 0.055, FACE_WIDTH + 0.24, 0.11, 0.77);
    mergeStatic(frame);
    const face = displayFace(atlas);
    frame.add(face.mesh);
    this.uv = face.uv;
    frame.position.set(-0.5, 1.22, end * 6.01);
    frame.rotation.y = Math.atan2(-0.16, end * 0.987);
    this.root.add(frame);
    this.root.position.set(site.x, site.y, site.z);
    this.root.rotation.y = site.yaw;
    this.root.name = 'GP race control classification display';
    this.root.visible = false;
  }

  private glyph(cell: number, code: number) {
    if (this.previous[cell] === code) return;
    this.previous[cell] = code;
    this.dirty = true;
    writeGpBoardGlyph(this.uv, cell, code);
  }

  update(frame: Float32Array) {
    const count = Math.min(frame[H.CARS], Math.floor((frame.length - HEADER) / CAR_STRIDE));
    const player = vehicleAt(frame[carBase(0) + RACE_BASE + R.VEHICLE]);
    this.root.visible = count > 0 && player.dynamicsKind === 'bike' && !player.bike?.offroad;
    if (!this.root.visible) return;
    this.order.fill(-1);
    let leaderLap = 0;
    for (let id = 0; id < count; id++) {
      const o = carBase(id),
        rank = frame[o + F.RANK];
      if (!Number.isInteger(rank) || rank < 1 || rank > ROWS || frame[o + F.RETIRED]) continue;
      const definition = vehicleAt(frame[o + RACE_BASE + R.VEHICLE]);
      if (definition.dynamicsKind !== 'bike' || definition.bike?.offroad) continue;
      this.order[rank - 1] = gpRaceNumber(bikeEntrantScheme(definition.id, id));
      if (rank === 1) {
        const completed = frame[o + F.LAPS];
        // A finisher has completed the displayed lap. On track the current
        // lap is the next one following the last timing-line crossing.
        leaderLap = T.MathUtils.clamp(
          Math.floor(completed) +
            (frame[o + F.FINISH] > 0 || frame[H.PHASE] === PHASE.FINISHED ? 0 : 1),
          1,
          99,
        );
      }
    }
    this.glyph(0, 11); // L
    this.glyph(1, leaderLap >= 10 ? Math.floor(leaderLap / 10) : BLANK);
    this.glyph(2, leaderLap > 0 ? leaderLap % 10 : BLANK);
    for (let row = 0; row < ROWS; row++) {
      const cell = (row + 1) * 3,
        number = this.order[row];
      this.glyph(cell, row + 1);
      this.glyph(cell + 1, number >= 0 ? Math.floor(number / 10) : BLANK);
      this.glyph(cell + 2, number >= 0 ? number % 10 : BLANK);
    }
    if (this.dirty) {
      this.uv.needsUpdate = true;
      this.dirty = false;
    }
  }
}
