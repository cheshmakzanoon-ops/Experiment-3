import * as T from 'three';
import { clamp } from '../../core/math.ts';
import { F, H, R, RACE_BASE, carBase } from '../../simulation/protocol.ts';
import { PHASE } from '../../simulation/race.ts';
import { Track, trackPoint } from '../../simulation/track.ts';
import { vehicleAt } from '../../simulation/vehicles.ts';
import { bikeEntrantScheme } from '../bike-sheet.ts';
import { box, mergeStatic } from '../geometry.ts';
import { gpRaceNumber } from '../gp-race-bodywork.ts';

const glyphs = '0123456789PL#';
// Outline strokes in card space. These are printed plastic cards which reflect
// the venue lights. Nothing on the board emits light or requires a live canvas.
const strokes = [
  [0.24, 0.86, 0.76, 0.86],
  [0.79, 0.81, 0.79, 0.55],
  [0.79, 0.45, 0.79, 0.19],
  [0.24, 0.14, 0.76, 0.14],
  [0.21, 0.19, 0.21, 0.45],
  [0.21, 0.55, 0.21, 0.81],
  [0.24, 0.5, 0.76, 0.5],
  [0.36, 0.18, 0.48, 0.83],
  [0.58, 0.18, 0.7, 0.83],
  [0.21, 0.4, 0.78, 0.4],
  [0.26, 0.61, 0.82, 0.61],
];
const marks = [
  '012345',
  '12',
  '01643',
  '01623',
  '5612',
  '05623',
  '056432',
  '012',
  '0123456',
  '012356',
  '01564',
  '543',
  '789a',
];
const tile = 48,
  atlasSize = tile * 4;
function cardAtlas() {
  const bytes = new Uint8Array(atlasSize * atlasSize * 4);
  for (let code = 0; code < glyphs.length; code++) {
    const segments = [...marks[code]].map((k) => strokes[parseInt(k, 16)]);
    for (let y = 0; y < tile; y++)
      for (let x = 0; x < tile; x++) {
        const u = (x + 0.5) / tile,
          v = (y + 0.5) / tile;
        let dist = 1;
        for (const [ax, ay, bx, by] of segments) {
          const dx = bx - ax,
            dy = by - ay;
          const t = clamp(((u - ax) * dx + (v - ay) * dy) / (dx * dx + dy * dy), 0, 1);
          dist = Math.min(dist, Math.hypot((u - ax - t * dx) * 0.77, v - ay - t * dy));
        }
        const ink = clamp((0.053 - dist) * tile + 0.5, 0, 1);
        const index = 4 * (((code >> 2) * tile + y) * atlasSize + (code % 4) * tile + x);
        const channel = Math.round(30 + ink * 212);
        bytes[index] = channel;
        bytes[index + 1] = channel;
        bytes[index + 2] = channel;
        bytes[index + 3] = 255;
      }
  }
  const texture = new T.DataTexture(bytes, atlasSize, atlasSize, T.RGBAFormat);
  texture.name = 'Pit board printed number cards';
  texture.colorSpace = T.SRGBColorSpace;
  texture.magFilter = T.LinearFilter;
  texture.minFilter = T.LinearMipmapLinearFilter;
  texture.generateMipmaps = true;
  texture.needsUpdate = true;
  return texture;
}

function printedFace(side: number, material: T.Material) {
  const pos: number[] = [],
    colors: number[] = [],
    indices: number[] = [];
  for (let row = 0; row < 3; row++) {
    const tint = new T.Color([0xfff293, 0xeeff78, 0xf1f2e8][row]);
    for (let col = 0; col < 3; col++) {
      const x = side * 0.49 + (col - 1) * 0.246,
        y = 0.55 + (1 - row) * 0.294,
        i = pos.length / 3;
      for (const [dx, dy] of [
        [-0.111, -0.122],
        [0.111, -0.122],
        [0.111, 0.122],
        [-0.111, 0.122],
      ]) {
        pos.push(x + dx, y + dy, 0.047);
        colors.push(tint.r, tint.g, tint.b);
      }
      indices.push(i, i + 1, i + 2, i, i + 2, i + 3);
    }
  }
  const geo = new T.BufferGeometry();
  geo.setIndex(indices);
  geo.setAttribute('position', new T.Float32BufferAttribute(pos, 3));
  geo.setAttribute('color', new T.Float32BufferAttribute(colors, 3));
  const uv = new T.Float32BufferAttribute(new Float32Array(72), 2);
  uv.setUsage(T.DynamicDrawUsage);
  geo.setAttribute('uv', uv);
  geo.computeVertexNormals();
  const mesh = new T.Mesh(geo, material);
  mesh.name = 'Race number, position and lap cards';
  mesh.receiveShadow = true;
  return { mesh, uv };
}

function writeCard(uv: T.BufferAttribute, cell: number, code: number) {
  const u = (code % 4) / 4,
    v = (code >> 2) / 4;
  // A half-texel inset keeps the next character out of the filtered card edges.
  const edge = 0.5 / atlasSize,
    last = 0.25 - edge;
  uv.setXY(cell * 4, u + edge, v + edge);
  uv.setXY(cell * 4 + 1, u + last, v + edge);
  uv.setXY(cell * 4 + 2, u + last, v + last);
  uv.setXY(cell * 4 + 3, u + edge, v + last);
}

class PitBoard {
  readonly root = new T.Group();
  readonly hinge = new T.Group();
  readonly cards: T.BufferAttribute;
  readonly face: T.Mesh;
  readonly station: number;
  private displayed = -1;
  constructor(
    track: Track,
    readonly slot: number,
    readonly side: number,
    steel: T.Material,
    tray: T.Material,
    print: T.Material,
  ) {
    this.station = track.pit.firstBox + (2 + slot * 5) * track.pit.boxSpacing;
    const p = track.at(this.station, trackPoint());
    // Same concrete parapet datum as the venue mesh. The mounting shoe seats
    // on its 1.05 m top and the hinge sits just clear of its track-facing lip.
    const lateral = side * (track.pit.offset - 4.3);
    this.root.position.set(
      p.x + p.nx * lateral,
      p.y + p.bank * clamp(lateral, -12, 12),
      p.z + p.nz * lateral,
    );
    this.root.rotation.y = Math.atan2(-p.tx, -p.tz);
    this.root.name = 'Team pit board ' + (slot + 1);
    const mount = new T.Group();
    box(mount, steel, side * 0.16, 1.071, 0, 0.33, 0.042, 0.24);
    box(mount, steel, side * 0.29, 1.44, 0, 0.055, 0.75, 0.065);
    for (const y of [1.37, 1.78]) box(mount, steel, side * 0.33, y, 0, 0.14, 0.095, 0.1);
    mergeStatic(mount);
    const panel = new T.Group();
    box(panel, tray, side * 0.49, 0.55, 0, 0.84, 0.98, 0.06);
    for (const x of [0.073, 0.907]) box(panel, steel, side * x, 0.55, 0, 0.025, 1.01, 0.081);
    for (const y of [0.057, 1.043]) box(panel, steel, side * 0.49, y, 0, 0.86, 0.022, 0.081);
    for (const y of [0.36, 0.74]) box(panel, steel, side * 0.045, y, 0, 0.1, 0.06, 0.055);
    // Retaining lips seat the replaceable cards. The rear brace, hinge pins
    // and clamping feet also read from the garage side of a folded board.
    for (const y of [0.11, 0.407, 0.7, 0.993])
      box(panel, steel, side * 0.49, y, 0.042, 0.74, 0.012, 0.014);
    for (const x of [0.12, 0.86])
      for (const y of [0.09, 1.01]) box(panel, steel, side * x, y, 0.043, 0.024, 0.024, 0.012);
    for (const y of [0.28, 0.83]) box(panel, steel, side * 0.49, y, -0.048, 0.745, 0.029, 0.034);
    for (const y of [0.34, 0.73]) {
      const pin = new T.Mesh(new T.CylinderGeometry(0.017, 0.017, 0.13, 8), steel);
      pin.position.set(0, y, 0);
      panel.add(pin);
    }
    mergeStatic(panel);
    const face = printedFace(side, print);
    this.cards = face.uv;
    this.face = face.mesh;
    this.hinge.position.set(side * 0.38, 1.03, 0);
    this.hinge.add(panel, face.mesh);
    this.root.add(mount, this.hinge);
  }
  update(frame: Float32Array, length: number) {
    const o = carBase(this.slot);
    if (this.slot >= frame[H.CARS]) {
      this.root.visible = false;
      return;
    }
    const def = vehicleAt(Math.round(frame[o + RACE_BASE + R.VEHICLE]));
    this.root.visible = def.dynamicsKind === 'bike' && !def.bike?.offroad;
    if (!this.root.visible) return;
    const rank = frame[o + F.RANK];
    let open = 0;
    this.face.visible =
      frame[H.PHASE] === PHASE.RACING &&
      rank > 0 &&
      rank <= frame[H.CARS] &&
      !frame[o + F.RETIRED] &&
      !frame[o + F.IN_PIT] &&
      !(frame[o + F.FINISH] > 0);
    if (this.face.visible) {
      const gap = this.station - frame[o + F.S];
      const ahead = gap - length * Math.round(gap / length);
      open = T.MathUtils.smoothstep(ahead, -20, -3) * (1 - T.MathUtils.smoothstep(ahead, 90, 140));
      const number = gpRaceNumber(bikeEntrantScheme(def.id, this.slot));
      const lap = clamp(Math.floor(frame[o + F.LAPS]) + 1, 1, 99);
      const pos = Math.floor(rank);
      const displayed = (number * 100 + pos) * 100 + lap;
      if (displayed !== this.displayed) {
        this.displayed = displayed;
        writeCard(this.cards, 0, 12);
        writeCard(this.cards, 3, 10);
        writeCard(this.cards, 6, 11);
        writeCard(this.cards, 1, Math.floor(number / 10));
        writeCard(this.cards, 2, number % 10);
        writeCard(this.cards, 4, Math.floor(pos / 10));
        writeCard(this.cards, 5, pos % 10);
        writeCard(this.cards, 7, Math.floor(lap / 10));
        writeCard(this.cards, 8, lap % 10);
        this.cards.needsUpdate = true;
      }
    }
    // The closed face looks into pit lane. Only the narrow rails are visible
    // to an approaching rider until their own team presents the board.
    this.hinge.rotation.y = (-this.side * (1 - open) * Math.PI) / 2;
  }
}

/** A pair of hinged team boards mounted on the GP pit wall. Place and pose use
 * only track and recorded entrant data, including when scrubbing a replay. */
export class GpPitBoards {
  readonly root = new T.Group();
  readonly boards: PitBoard[];
  constructor(readonly track: Track) {
    const steel = new T.MeshStandardMaterial({ color: 0x71828a, roughness: 0.35, metalness: 0.74 });
    const tray = new T.MeshStandardMaterial({ color: 0x20262a, roughness: 0.71, metalness: 0.19 });
    const print = new T.MeshStandardMaterial({
      map: cardAtlas(),
      vertexColors: true,
      roughness: 0.85,
      metalness: 0.02,
    });
    this.boards = [0, 1].map(
      (slot) => new PitBoard(track, slot, track.pit.side, steel, tray, print),
    );
    this.root.name = 'GP pit straight team boards';
    this.root.visible = false;
    for (const board of this.boards) this.root.add(board.root);
  }
  update(frame: Float32Array) {
    for (const board of this.boards) board.update(frame, this.track.length);
    this.root.visible = this.boards[0].root.visible || this.boards[1].root.visible;
  }
}
