import { LIVERIES } from '../simulation/config.ts';
import { F, H, carBase } from '../simulation/protocol.ts';
import { FLAG } from '../simulation/marshal.ts';
import { trackPoint, type Track } from '../simulation/track.ts';

/** Logical drawing space of the map canvas (the CSS box keeps this aspect). */
export const MAP_W = 250;
export const MAP_H = 240;
export interface MapFrame {
  cx: number;
  cz: number;
  scale: number;
}
/** World (x, z) -> logical map point. The vertical scale keeps the original
 * 0.23/0.24 squash so `minimapFrame` stays the single framing contract. */
export function mapPoint(frame: MapFrame, x: number, z: number): [number, number] {
  return [
    MAP_W / 2 + (x - frame.cx) * frame.scale,
    125 - (z - frame.cz) * frame.scale * (0.23 / 0.24),
  ];
}
/** Points of the sector boundaries (s = 0, L/3, 2L/3) with their outward
 * normal (away from the map's centroid), for the sector numbers. */
export function sectorMarks(track: Track, frame: MapFrame) {
  const centroid = track.points.reduce(
    (a, p) => [a[0] + p.x / track.points.length, a[1] + p.z / track.points.length],
    [0, 0],
  );
  const [ox, oy] = mapPoint(frame, centroid[0], centroid[1]);
  return [0, 1, 2].map((k) => {
    const s = (k * track.length) / 3;
    const p = track.at(s, trackPoint());
    const q = track.at((s + 6) % track.length, trackPoint());
    const [x, y] = mapPoint(frame, p.x, p.z);
    const [x2, y2] = mapPoint(frame, q.x, q.z);
    let nx = -(y2 - y),
      ny = x2 - x;
    const n = Math.hypot(nx, ny) || 1;
    nx /= n;
    ny /= n;
    // Point the normal away from the centroid so labels sit outside the loop.
    if (nx * (x - ox) + ny * (y - oy) < 0) {
      nx = -nx;
      ny = -ny;
    }
    const t = Math.hypot(x2 - x, y2 - y) || 1;
    return { x, y, nx, ny, tx: (x2 - x) / t, ty: (y2 - y) / t };
  });
}

/** F1-style circuit map (Art Bible B §1.6) on a device-pixel-ratio canvas:
 * dark ribbon with light hairline edges, sector numbers, a chequered S/F mark,
 * outlined team-colour dots in reverse race order and the player's yellow
 * triangle. The ribbon is a cached Path2D rebuilt only when the circuit or
 * framing changes. Pulses run on simulated time (held frames are identical). */
export class TrackMap {
  private path: Path2D | null = null;
  private pathKey = '';
  private marks: ReturnType<typeof sectorMarks> = [];
  private sizeKey = '';
  private readonly scratch = trackPoint();
  constructor(private readonly canvas: HTMLCanvasElement) {}
  /** Match the backing store to the CSS box × devicePixelRatio. Measured only
   * when the window, DPR or UI scale changes (or while the map is hidden). */
  private fit() {
    const dpr = Math.min(3, Math.max(1, window.devicePixelRatio || 1));
    const scale = document.documentElement.style.getPropertyValue('--ui-scale') || '1';
    const key = `${window.innerWidth}x${window.innerHeight}@${dpr}/${scale}`;
    if (key === this.sizeKey) return;
    const width = this.canvas.getBoundingClientRect().width;
    if (!(width > 0)) return; // hidden (compact drawer closed): retry next draw
    this.sizeKey = key;
    const w = Math.max(MAP_W, Math.round(width * dpr));
    const h = Math.round((w * MAP_H) / MAP_W);
    if (this.canvas.width !== w) this.canvas.width = w;
    if (this.canvas.height !== h) this.canvas.height = h;
  }
  draw(frame: Float32Array, track: Track, view: MapFrame) {
    this.fit();
    const c = this.canvas.getContext('2d');
    if (!c) return;
    const key = `${track.circuit.id}:${track.length}:${view.cx}:${view.cz}:${view.scale}`;
    if (key !== this.pathKey || !this.path) {
      this.pathKey = key;
      const path = new Path2D();
      track.points.forEach((p, i) => {
        const [x, y] = mapPoint(view, p.x, p.z);
        if (i === 0) path.moveTo(x, y);
        else path.lineTo(x, y);
      });
      path.closePath();
      this.path = path;
      this.marks = sectorMarks(track, view);
    }
    c.setTransform(1, 0, 0, 1, 0, 0);
    c.clearRect(0, 0, this.canvas.width, this.canvas.height);
    c.setTransform(this.canvas.width / MAP_W, 0, 0, this.canvas.height / MAP_H, 0, 0);
    c.lineJoin = 'round';
    c.lineCap = 'round';
    // Ribbon: a light outline under a dark core leaves 1-unit hairline edges.
    c.lineWidth = 8.6;
    c.strokeStyle = 'rgba(255, 255, 255, 0.85)';
    c.stroke(this.path);
    c.lineWidth = 6.6;
    c.strokeStyle = 'rgba(32, 34, 39, 0.94)';
    c.stroke(this.path);
    // Sector boundaries and numbers; the chequered flag marks S/F.
    c.font = '600 15px "Saira Variable", "Arial Narrow", Arial, sans-serif';
    c.textAlign = 'center';
    c.textBaseline = 'middle';
    this.marks.forEach((m, k) => {
      if (k > 0) {
        c.strokeStyle = 'rgba(255, 255, 255, 0.9)';
        c.lineWidth = 1.6;
        c.beginPath();
        c.moveTo(m.x - m.nx * 5, m.y - m.ny * 5);
        c.lineTo(m.x + m.nx * 5, m.y + m.ny * 5);
        c.stroke();
      }
      c.fillStyle = '#ffffff';
      c.shadowColor = 'rgba(0, 0, 0, 0.8)';
      c.shadowBlur = 3;
      c.fillText(String(k + 1), m.x + m.nx * 17, m.y + m.ny * 17);
      c.shadowBlur = 0;
    });
    const sf = this.marks[0];
    if (sf) this.chequer(c, sf.x - sf.nx * 13, sf.y - sf.ny * 13, Math.atan2(sf.ty, sf.tx));
    const time = frame[H.TIME];
    const cars = frame[H.CARS];
    // Local caution zone ahead of the player: a pulsing ring (1.2 s period).
    const me = carBase(0);
    const caution = frame[me + F.CAUTION_DISTANCE];
    const flag = frame[me + F.LOCAL_FLAG];
    if ((flag === FLAG.YELLOW || flag === FLAG.DOUBLE_YELLOW) && caution >= 0) {
      const p = track.at((frame[me + F.S] + caution) % track.length, this.scratch);
      const [x, y] = mapPoint(view, p.x, p.z);
      const phase = (((time % 1.2) + 1.2) % 1.2) / 1.2;
      c.strokeStyle = `rgba(240, 208, 32, ${(1 - phase * 0.7).toFixed(3)})`;
      c.lineWidth = 1.8;
      c.beginPath();
      c.arc(x, y, 8 + phase * 6, 0, Math.PI * 2);
      c.stroke();
      c.fillStyle = 'rgba(240, 208, 32, 0.35)';
      c.beginPath();
      c.arc(x, y, 6, 0, Math.PI * 2);
      c.fill();
    }
    // Rivals in reverse race order (the leader on top), then the player.
    const order = Array.from({ length: cars }, (_, id) => id).sort(
      (a, b) => frame[carBase(b) + F.RANK] - frame[carBase(a) + F.RANK],
    );
    for (const id of order) {
      if (id === 0) continue;
      const o = carBase(id);
      const [x, y] = mapPoint(view, frame[o + F.X], frame[o + F.Z]);
      c.globalAlpha = frame[o + F.RETIRED] > 0 ? 0.35 : 1;
      c.beginPath();
      c.arc(x, y, 5.4, 0, Math.PI * 2);
      c.fillStyle = `#${LIVERIES[id].toString(16).padStart(6, '0')}`;
      c.fill();
      c.lineWidth = 1.6;
      c.strokeStyle = '#0b0c10';
      c.stroke();
    }
    c.globalAlpha = 1;
    // Player: yellow triangle along the car's heading.
    const qx = frame[me + F.QX],
      qy = frame[me + F.QY],
      qz = frame[me + F.QZ],
      qw = frame[me + F.QW];
    let fx = 2 * (qx * qz + qw * qy),
      fz = 1 - 2 * (qx * qx + qy * qy);
    const [px, py] = mapPoint(view, frame[me + F.X], frame[me + F.Z]);
    let dx = fx,
      dy = -fz * (0.23 / 0.24);
    const len = Math.hypot(dx, dy);
    if (!(len > 1e-6)) {
      fx = 0;
      fz = 1;
      dx = 0;
      dy = -1;
    } else {
      dx /= len;
      dy /= len;
    }
    c.save();
    c.translate(px, py);
    c.rotate(Math.atan2(dy, dx));
    c.beginPath();
    c.moveTo(10, 0);
    c.lineTo(-7, -7);
    c.lineTo(-4, 0);
    c.lineTo(-7, 7);
    c.closePath();
    c.fillStyle = '#f5e11c';
    c.fill();
    c.lineWidth = 1.6;
    c.strokeStyle = '#0b0c10';
    c.stroke();
    c.restore();
  }
  /** A 4 × 3 chequered flag glyph rotated along the track at the start line. */
  private chequer(c: CanvasRenderingContext2D, x: number, y: number, angle: number) {
    const cell = 2.6;
    c.save();
    c.translate(x, y);
    c.rotate(angle);
    c.fillStyle = '#0b0c10';
    c.fillRect(-2 * cell - 1, -1.5 * cell - 1, 4 * cell + 2, 3 * cell + 2);
    c.fillStyle = '#ffffff';
    for (let i = 0; i < 4; i++)
      for (let j = 0; j < 3; j++)
        if ((i + j) % 2 === 0) c.fillRect(-2 * cell + i * cell, -1.5 * cell + j * cell, cell, cell);
    c.restore();
  }
}
