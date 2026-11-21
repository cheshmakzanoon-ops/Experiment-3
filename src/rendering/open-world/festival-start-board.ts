import * as T from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import type { FestivalEvent } from '../../simulation/open-world/festival-events.ts';
import type { FestivalEventKind } from '../../simulation/open-world/region-data.ts';
import { roadCandidates } from '../../simulation/open-world/road-network.ts';
import { pathPoint } from '../../simulation/open-world/route-path.ts';

const formats: readonly FestivalEventKind[] = [
  'road-race',
  'circuit',
  'sprint',
  'speed-trap',
  'speed-zone',
  'drift-zone',
  'showcase',
];
const labels = [
  'ROAD RACE',
  'CIRCUIT',
  'SPRINT',
  'SPEED TRAP',
  'SPEED ZONE',
  'DRIFT ZONE',
  'SHOWCASE',
];
const side = 256;

function boardAtlas(colours: Readonly<Record<FestivalEventKind, number>>) {
  if (typeof document === 'undefined') {
    const t = new T.DataTexture(new Uint8Array([255, 255, 255, 255]), 1, 1);
    t.needsUpdate = true;
    return t;
  }
  const canvas = document.createElement('canvas');
  canvas.width = side * 2;
  canvas.height = side * 4;
  const g = canvas.getContext('2d')!;
  g.fillStyle = '#ffffff';
  g.fillRect(0, 0, canvas.width, canvas.height);
  formats.forEach((kind, i) => {
    g.save();
    g.translate((i % 2) * side, Math.floor(i / 2) * side);
    const colour = '#' + colours[kind].toString(16).padStart(6, '0');
    g.fillStyle = '#14292e';
    g.fillRect(0, 0, side, side);
    g.fillStyle = colour;
    g.fillRect(6, 6, 244, 10);
    g.fillRect(12, 177, 231, 3);
    g.fillStyle = '#e7e6d6';
    g.font = 'bold 20px sans-serif';
    g.fillText('SOLVANE', 17, 47);
    g.textAlign = 'right';
    g.font = 'bold 10px sans-serif';
    g.fillText('COAST FESTIVAL', 238, 45);
    g.textAlign = 'left';
    g.fillStyle = colour;
    if (kind === 'speed-zone' || kind === 'speed-trap') {
      g.lineWidth = 9;
      g.strokeStyle = colour;
      g.beginPath();
      g.arc(83, 144, 38, Math.PI, Math.PI * 1.92);
      g.stroke();
      g.beginPath();
      g.moveTo(80, 141);
      g.lineTo(114, 112);
      g.lineTo(87, 149);
      g.fill();
    } else if (kind === 'drift-zone') {
      g.strokeStyle = colour;
      g.lineWidth = 7;
      for (const x of [43, 65]) {
        g.beginPath();
        g.moveTo(x, 153);
        g.bezierCurveTo(x + 67, 133, x - 12, 116, x + 54, 93);
        g.stroke();
      }
    } else {
      for (let row = 0; row < 3; row++)
        for (let col = 0; col < 5; col++)
          if ((row + col) % 2 === 0)
            g.fillRect(25 + col * 16 + 4 * (2 - row), 92 + row * 16, 16, 16);
    }
    g.fillStyle = '#e7e6d6';
    g.font = 'bold 25px sans-serif';
    g.textAlign = 'right';
    g.fillText('START', 238, 148);
    g.textAlign = 'left';
    g.font = 'bold 32px sans-serif';
    g.fillText(labels[i], 15, 224);
    g.restore();
  });
  const t = new T.CanvasTexture(canvas);
  t.colorSpace = T.SRGBColorSpace;
  t.anisotropy = 4;
  return t;
}

/** Portable festival timing board. Two printed faces read in the direction
 * of approach; the return, hinge pins, legs and ballasted foot share its draw. */
export class FestivalStartBoards {
  readonly atlas: T.Texture;
  readonly material: T.MeshStandardMaterial;
  private readonly boards = new Map<FestivalEventKind, T.BufferGeometry>();
  constructor(colours: Readonly<Record<FestivalEventKind, number>>) {
    this.atlas = boardAtlas(colours);
    this.material = new T.MeshStandardMaterial({
      map: this.atlas,
      vertexColors: true,
      roughness: 0.57,
      metalness: 0.12,
    });
    this.material.name = 'Festival printed timing boards';
  }
  geometry(kind: FestivalEventKind) {
    const cached = this.boards.get(kind);
    if (cached) return cached;
    const pieces: T.BufferGeometry[] = [];
    const index = formats.indexOf(kind),
      u = (index % 2) / 2,
      v = 1 - (Math.floor(index / 2) + 1) / 4;
    const add = (g: T.BufferGeometry, colour: number, print = false) => {
      const uv = g.getAttribute('uv'),
        c = new T.Color(colour),
        cs = new Float32Array(uv.count * 3);
      for (let i = 0; i < uv.count; i++) {
        if (print)
          uv.setXY(i, u + (0.015 + 0.97 * uv.getX(i)) / 2, v + (0.015 + 0.97 * uv.getY(i)) / 4);
        else uv.setXY(i, 0.75, 0.125);
        c.toArray(cs, i * 3);
      }
      g.setAttribute('color', new T.BufferAttribute(cs, 3));
      pieces.push(g);
    };
    const box = (w: number, h: number, d: number, x: number, y: number, z: number, c: number) =>
      add(new T.BoxGeometry(w, h, d).translate(x, y, z), c);
    box(0.65, 0.088, 0.47, 0, 0.047, 0, 0x313337);
    box(0.53, 0.053, 0.36, 0, 0.108, 0, 0x464a4a);
    for (const x of [-0.208, 0.208]) {
      add(new T.CylinderGeometry(0.017, 0.022, 1.17, 8).translate(x, 0.7, 0), 0x969e98);
      box(0.08, 0.059, 0.13, x, 0.145, 0, 0x333b3a);
    }
    box(0.82, 1.01, 0.065, 0, 1.09, 0, 0x4a514d);
    for (const sign of [-1, 1]) {
      add(
        new T.PlaneGeometry(0.792, 0.98)
          .rotateY(sign === 1 ? 0 : Math.PI)
          .translate(0, 1.09, sign * 0.034),
        0xffffff,
        true,
      );
      for (const x of [-0.38, 0.38])
        for (const y of [0.632, 1.546])
          add(
            new T.CylinderGeometry(0.008, 0.009, 0.006, 6)
              .rotateX(Math.PI / 2)
              .translate(x, y, 0.036 * sign),
            0x9eaaa4,
          );
    }
    const geometry = mergeGeometries(pieces)!;
    for (const g of pieces) g.dispose();
    geometry.computeBoundingSphere();
    this.boards.set(kind, geometry);
    return geometry;
  }
  dispose() {
    for (const g of this.boards.values()) g.dispose();
    this.atlas.dispose();
    this.material.dispose();
  }
}

/** Try the approach side first. Check all carriageways on the same level so
 * a board at a junction or shared start cannot occupy a crossing lane. */
export function startBoardSite(
  event: FestivalEvent,
  occupied: readonly { x: number; z: number }[] = [],
) {
  const path = event.path,
    net = path.network,
    p = pathPoint(),
    candidates = roadCandidates();
  for (const station of [3, 9, 16, 25, 38, 54]) {
    path.at(Math.min(station, path.finishDistance), p);
    for (const side of [-1, 1]) {
      const offset = side * (p.halfWidth + 1.25);
      const x = p.x + p.nx * offset,
        z = p.z + p.nz * offset;
      if (occupied.some((site) => Math.hypot(site.x - x, site.z - z) < 3)) continue;
      const count = net.covering(x, z, p.y, 1, candidates);
      let clear = true;
      for (let k = 0; k < count; k++) {
        const hw = net.edges[net.edgeOf[candidates.segment[k]]].spec.halfWidth;
        if (candidates.distance[k] < hw + 0.67) {
          clear = false;
          break;
        }
      }
      if (clear) return { x, z, y: p.y, heading: Math.atan2(-p.tx, -p.tz) };
    }
  }
  return null;
}
