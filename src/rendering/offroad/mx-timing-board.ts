import * as T from 'three';
import { F, H, carBase } from '../../simulation/protocol.ts';
import { PHASE } from '../../simulation/race.ts';
import { canvasTexture } from '../geometry.ts';

type Rect = readonly [x: number, y: number, width: number, height: number];
const HEADER: Rect = [0, 0, 1024, 64];
const LABELS: Rect = [448, 72, 576, 48];
const DIVIDER: Rect = [962, 416, 40, 82];
const TILES_PER_END = 14;
const STATUS = ['AT THE GATE', 'STAND BY', 'RACING', 'FINISH'] as const;
const INKS = ['#a9c6bd', '#ffc260', '#6ce8b2', '#e9eced'] as const;
const statusTile = (phase: number): Rect => [0, 72 + phase * 108, 432, 104];
const digitTile = (digit: number): Rect => [
  448 + (digit % 8) * 72,
  144 + Math.floor(digit / 8) * 128,
  72,
  124,
];
const COLON = 10,
  BLANK = 11;

/** A single resident atlas. The board electronics change glyph addresses only
 * when a whole second, lap or gate signal changes. Both ends show one source. */
function makeAtlas() {
  if (typeof document === 'undefined') {
    const texture = new T.DataTexture(new Uint8Array([255, 255, 255, 255]), 1, 1);
    texture.needsUpdate = true;
    return texture;
  }
  return canvasTexture(1024, 512, (c) => {
    c.fillStyle = '#0c191d';
    c.fillRect(0, 0, 1024, 512);
    c.textBaseline = 'middle';
    c.fillStyle = '#263a3d';
    c.fillRect(0, 0, 1024, 64);
    c.fillStyle = '#ffb56e';
    c.fillRect(0, 0, 13, 64);
    c.font = '900 46px "Saira Variable", Arial, sans-serif';
    c.fillStyle = '#f2ebdc';
    c.fillText('ARENA NORD', 30, 34);
    c.textAlign = 'right';
    c.font = '700 33px "Saira Variable", Arial, sans-serif';
    c.fillStyle = '#b2c6bd';
    c.fillText('SUPERCROSS', 997, 34);
    c.textAlign = 'left';
    c.font = '700 35px "Saira Variable", Arial, sans-serif';
    c.fillStyle = '#a6bbb5';
    c.fillText('LAP', 463, 97);
    c.fillText('RACE TIME', 634, 97);
    // This rule continues through the static gutter below the clock heading.
    c.fillStyle = '#48615d';
    c.fillRect(603, 78, 3, 42);
    c.fillRect(980, 416, 4, 82);
    STATUS.forEach((title, phase) => {
      const [x, y, w, h] = statusTile(phase);
      c.fillStyle = INKS[phase];
      c.fillRect(x + 11, y + 14, 8, h - 28);
      c.font = '800 53px "Saira Variable", Arial, sans-serif';
      c.fillText(title, x + 38, y + h * 0.51, w - 58);
    });
    c.textAlign = 'center';
    c.font = 'bold 100px monospace';
    c.fillStyle = '#f8eccc';
    for (let digit = 0; digit <= COLON; digit++) {
      const [x, y, w, h] = digitTile(digit);
      c.fillText(digit === COLON ? ':' : String(digit), x + w / 2, y + h / 2 + 3, w - 10);
    }
  });
}

export class MxTimingBoard {
  readonly mesh: T.Mesh<T.BufferGeometry, T.MeshBasicMaterial>;
  readonly atlas = makeAtlas();
  private readonly uv: T.Float32BufferAttribute;
  private readonly digits = new Uint8Array(10);
  private phase = -1;
  private lap = -1;
  private seconds = -1;

  constructor(centres: readonly T.Vector3[]) {
    const positions: number[] = [],
      indices: number[] = [],
      uvs: number[] = [];
    // Each end has fourteen non-overlapping tiles. All geometry faces the floor.
    for (const [end, centre] of centres.entries()) {
      const facing = end === 0 ? 1 : -1;
      const quad = (x: number, y: number, w: number, h: number) => {
        const first = positions.length / 3;
        for (const [s, t] of [
          [x, y + h],
          [x + w, y + h],
          [x, y],
          [x + w, y],
        ]) {
          positions.push(
            centre.x + facing * (s / 1024 - 0.5) * 20,
            centre.y + (0.5 - t / 256) * 4.8,
            centre.z,
          );
          uvs.push(0, 0);
        }
        indices.push(first, first + 1, first + 2, first + 2, first + 1, first + 3);
      };
      quad(0, 0, 1024, 68);
      quad(0, 68, 448, 188);
      quad(448, 68, 576, 52);
      for (let i = 0; i < 2; i++) quad(448 + i * 71, 120, 71, 136);
      for (let i = 0; i < 8; i++) quad(620 + i * 50.5, 120, 50.5, 136);
      quad(590, 120, 30, 136);
    }
    const geometry = new T.BufferGeometry();
    geometry.setAttribute('position', new T.Float32BufferAttribute(positions, 3));
    this.uv = new T.Float32BufferAttribute(uvs, 2).setUsage(T.DynamicDrawUsage);
    geometry.setAttribute('uv', this.uv);
    geometry.setIndex(indices);
    geometry.computeBoundingSphere();
    const screen = new T.MeshBasicMaterial({ map: this.atlas, name: 'Arena timing display' });
    screen.color.setRGB(1.8, 1.8, 1.8);
    this.mesh = new T.Mesh(geometry, screen);
    this.mesh.name = 'Arena Nord live timing boards';
    this.setTile(0, HEADER);
    this.setTile(2, LABELS);
    this.setTile(13, DIVIDER);
    this.display(PHASE.GRID, 1, 0);
  }

  private setTile(slot: number, [x, y, w, h]: Rect) {
    // Half-texel padding keeps adjacent artwork out of a glyph's edge.
    const left = (x + 1) / 1024,
      right = (x + w - 1) / 1024;
    const top = 1 - (y + 1) / 512,
      bottom = 1 - (y + h - 1) / 512;
    for (let vertex = slot * 4; vertex < this.uv.count; vertex += TILES_PER_END * 4) {
      this.uv.setXY(vertex, left, bottom);
      this.uv.setXY(vertex + 1, right, bottom);
      this.uv.setXY(vertex + 2, left, top);
      this.uv.setXY(vertex + 3, right, top);
    }
  }

  update(frame: Float32Array) {
    let phase = Math.round(frame[H.PHASE]),
      lap = Math.max(1, Math.round(frame[H.LAP_LEADER]));
    let seconds = Math.max(0, Math.floor(frame[H.RACE_TIME]));
    // Freeze the winning time as soon as the leader crosses the line, even
    // while the rest of the field is completing its final lap.
    for (let i = 0; i < frame[H.CARS]; i++) {
      const p = carBase(i);
      if (frame[p + F.RANK] !== 1) continue;
      if (frame[p + F.FINISH] > 0) {
        phase = PHASE.FINISHED;
        lap = Math.max(1, Math.round(frame[p + F.LAPS]));
        seconds = Math.floor(frame[p + F.FINISH]);
      }
      break;
    }
    this.display(phase, lap, phase < PHASE.RACING ? 0 : seconds);
  }

  private display(phase: number, lap: number, seconds: number) {
    if (phase === this.phase && lap === this.lap && seconds === this.seconds) return;
    if (phase !== this.phase) this.setTile(1, statusTile(T.MathUtils.clamp(phase, 0, 3)));
    const hours = Math.floor(seconds / 3600) % 100;
    const mins = Math.floor(seconds / 60) % 60;
    const secs = seconds % 60;
    const digits = this.digits;
    // Left align the lap under its label. At race distance a lone lap digit
    // immediately beside the hour digits otherwise reads as part of the clock.
    digits[0] = lap >= 10 ? Math.floor(lap / 10) % 10 : lap;
    digits[1] = lap >= 10 ? lap % 10 : BLANK;
    digits[2] = Math.floor(hours / 10);
    digits[3] = hours % 10;
    digits[4] = COLON;
    digits[5] = Math.floor(mins / 10);
    digits[6] = mins % 10;
    digits[7] = COLON;
    digits[8] = Math.floor(secs / 10);
    digits[9] = secs % 10;
    for (let i = 0; i < digits.length; i++) this.setTile(3 + i, digitTile(digits[i]));
    this.uv.needsUpdate = true;
    this.phase = phase;
    this.lap = lap;
    this.seconds = seconds;
  }
}
