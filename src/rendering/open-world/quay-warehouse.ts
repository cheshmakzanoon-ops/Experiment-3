import type { Structure } from '../../simulation/open-world/placement.ts';
import type { FacadeSink, Point3 } from './facade-layout.ts';

type Finish = readonly [number, number, number, number];
type Box = (
  x: number,
  y: number,
  z: number,
  w: number,
  h: number,
  d: number,
  colour: number,
) => void;
interface Shell extends FacadeSink {
  tri(points: readonly Point3[], normal: Point3, colour: number, finish: Finish): void;
}

/** A working quay shed with a north-light roof, high side glazing and loading
 * doors recessed into both end walls. Roof crests match the collision height. */
export function addQuayWarehouse(
  shell: Shell,
  s: Structure,
  local: (x: number, y: number, z: number) => Point3,
  box: Box,
  style: number,
) {
  const { hx, hz, base, height } = s;
  const bays = Math.max(2, Math.round((2 * hx) / 10)),
    span = (2 * hx) / bays;
  const rise = Math.min(2.35, height * 0.23),
    eave = height - rise;
  const metal: Finish = [style, 9, 1, height],
    roof: Finish = [style, 9, -1, height];
  const wall = hx < 16 ? 0x577268 : 0x75847b,
    zinc = 0x697a78,
    frame = 0x45534e;
  const glazing = (bay: number): Finish => [0.24 + ((bay * 13) % 19) * 0.012, 9, -4, 0];
  const at = (x: number, y: number, z: number) => local(x, base + y, z);
  const c = Math.cos(s.heading),
    n = Math.sin(s.heading);
  const normal = (x: number, y: number, z: number): Point3 => [c * x - n * z, y, n * x + c * z];
  const unitUV = [
    [0, 0],
    [1, 0],
    [1, 1],
    [0, 1],
  ] as const;
  const metres = (w: number, h: number) =>
    [
      [0, 0],
      [w, 0],
      [w, h],
      [0, h],
    ] as const;
  const plinth = 0.82,
    sill = eave - Math.min(1.48, eave * 0.27),
    head = eave - 0.22;
  box(0, base + plinth / 2, 0, 2 * hx, plinth, 2 * hz, 0x918c7b);

  // At the ends the wall stops at each jamb. The two steel doors sit behind
  // the returns at different depths, as they would on parallel sliding tracks.
  const halfDoor = Math.min(2.85, hz * 0.43),
    doorTop = Math.min(4.65, eave - 0.48);
  for (const side of [-1, 1]) {
    const face = (
      z0: number,
      z1: number,
      y0: number,
      y1: number,
      depth: number,
      colour: number,
    ) => {
      const x = side * (hx - depth);
      const start = side === -1 ? z0 : z1,
        end = side === -1 ? z1 : z0;
      shell.quad(
        [at(x, y0, start), at(x, y0, end), at(x, y1, end), at(x, y1, start)],
        normal(side, 0, 0),
        metres(z1 - z0, y1 - y0),
        colour,
        metal,
      );
    };
    face(-hz, -halfDoor, plinth, eave, 0, wall);
    face(halfDoor, hz, plinth, eave, 0, wall);
    face(-halfDoor, halfDoor, doorTop, eave, 0, wall);
    face(-halfDoor, 0, plinth, doorTop, 0.16, 0x4d625c);
    face(0, halfDoor, plinth, doorTop, 0.22, 0x516861);
    for (const hand of [-1, 1]) {
      box(
        side * (hx - 0.075),
        base + (doorTop + plinth) / 2,
        hand * halfDoor,
        0.3,
        doorTop - plinth,
        0.13,
        frame,
      );
      box(side * (hx - 0.1), base + plinth + 1.1, hand * 0.18, 0.095, 0.4, 0.055, 0x293b39);
    }
    box(side * (hx - 0.02), base + doorTop + 0.08, 0, 0.26, 0.18, 2 * halfDoor + 0.66, 0x495853);
  }

  for (let i = 0; i < bays; i++) {
    const x0 = -hx + i * span,
      x1 = x0 + span,
      crest = x0 + Math.min(1.3, span * 0.17);
    const roofFace = (
      xa: number,
      ya: number,
      xb: number,
      yb: number,
      za: number,
      zb: number,
      glass: boolean,
      pane: number,
    ) => {
      const dx = xb - xa,
        dy = yb - ya,
        length = Math.hypot(dx, dy);
      shell.quad(
        [at(xa, ya, za), at(xa, ya, zb), at(xb, yb, zb), at(xb, yb, za)],
        normal(-dy / length, dx / length, 0),
        glass ? unitUV : metres(zb - za, length),
        glass ? 0x708a89 : zinc,
        glass ? glazing(pane) : roof,
      );
    };
    const panes = Math.ceil((2 * hz) / 2.3);
    for (let p = 0; p < panes; p++)
      roofFace(
        x0,
        eave,
        crest,
        height,
        -hz + (2 * hz * p) / panes,
        -hz + (2 * hz * (p + 1)) / panes,
        true,
        i * panes + p,
      );
    roofFace(crest, height, x1, eave, -hz, hz, false, 0);
    box(crest, base + height - 0.045, 0, 0.2, 0.09, 2 * hz + 0.16, 0x606e68);
    box(x0 + 0.05, base + eave + 0.035, 0, 0.14, 0.09, 2 * hz + 0.16, 0x495750);

    for (const side of [-1, 1]) {
      const z = side * hz;
      const face = (
        xa: number,
        xb: number,
        ya: number,
        yb: number,
        offset: number,
        glass: boolean,
        pane: number,
      ) => {
        const start = side === 1 ? xa : xb,
          end = side === 1 ? xb : xa,
          d = z - side * offset;
        shell.quad(
          [at(start, ya, d), at(end, ya, d), at(end, yb, d), at(start, yb, d)],
          normal(0, 0, side),
          glass ? unitUV : metres(xb - xa, yb - ya),
          glass ? 0x758d87 : wall,
          glass ? glazing(pane) : metal,
        );
      };
      face(x0, x1, plinth, sill, 0, false, 0);
      face(x0, x1, head, eave, 0, false, 0);
      const pier = 0.28,
        width = (span - 2 * pier) / 3;
      face(x0, x0 + pier, sill, head, 0, false, 0);
      face(x1 - pier, x1, sill, head, 0, false, 0);
      for (let p = 0; p < 3; p++) {
        const xa = x0 + pier + p * width;
        face(xa, xa + width, sill, head, 0.11, true, i * 3 + p);
        box(xa, base + (sill + head) / 2, z - side * 0.04, 0.08, head - sill, 0.18, frame);
      }
      box(x1 - pier, base + (sill + head) / 2, z - side * 0.04, 0.08, head - sill, 0.18, frame);
      box((x0 + x1) / 2, base + sill, z - side * 0.02, span, 0.105, 0.27, 0x717d70);
      box((x0 + x1) / 2, base + head, z - side * 0.04, span, 0.09, 0.18, frame);
      const end: Point3[] = [at(x0, eave, z), at(x1, eave, z), at(crest, height, z)];
      shell.tri(side === 1 ? end : end.reverse(), normal(0, 0, side), wall, metal);
    }
  }
}
