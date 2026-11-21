import type { Structure } from '../../simulation/open-world/placement.ts';
import type { FacadeSink } from './facade-layout.ts';

type LocalPoint = (x: number, y: number, z: number) => readonly [number, number, number];
type Box = (
  x: number,
  y: number,
  z: number,
  width: number,
  height: number,
  depth: number,
  colour: number,
) => void;

/** Timber gable with two sliding carriage doors. The three wall panels
 * leave an actual opening. The closed leaves sit behind their jambs and
 * the projecting track lies inside the existing roof overhang. */
export function addFarmGable(
  sink: FacadeSink,
  s: Structure,
  side: number,
  local: LocalPoint,
  box: Box,
  wallColour: number,
  style: number,
) {
  const halfDoor = Math.min(2.45, s.hz * 0.46),
    head = Math.min(4.8, s.height * 0.68);
  const normal = [side * Math.cos(s.heading), 0, side * Math.sin(s.heading)] as const;
  const boards = [style, 3, -7, s.height] as const;
  const front = (u0: number, y0: number, u1: number, y1: number, depth: number, colour: number) => {
    const x = side * (s.hx + depth);
    const at = (u: number, y: number) => local(x, s.base + y, side * u);
    sink.quad(
      [at(u1, y0), at(u0, y0), at(u0, y1), at(u1, y1)],
      normal,
      [
        [u1 + s.hz, y0],
        [u0 + s.hz, y0],
        [u0 + s.hz, y1],
        [u1 + s.hz, y1],
      ],
      colour,
      boards,
    );
  };
  front(-s.hz, 0, -halfDoor, s.height, 0, wallColour);
  front(halfDoor, 0, s.hz, s.height, 0, wallColour);
  front(-halfDoor, head, halfDoor, s.height, 0, wallColour);
  const leaf = (s.style & 1) === 0 ? 0x635b46 : 0x655349;
  const frame = 0x807764,
    iron = 0x464b45,
    setback = 0.16;
  front(-halfDoor, -0.01, 0, head, -setback, leaf);
  front(0, -0.01, halfDoor, head, -setback - 0.04, leaf);
  for (const hand of [-1, 1]) {
    // The deep timber jambs close the reveals back to each leaf.
    box(side * (s.hx - 0.06), s.base + head / 2, hand * halfDoor, 0.32, head, 0.18, frame);
    for (const y of [0.95, head - 0.56])
      box(
        side * (s.hx - setback + 0.03),
        s.base + y,
        (hand * halfDoor) / 2,
        0.13,
        0.115,
        halfDoor - 0.12,
        frame,
      );
    box(side * (s.hx - setback + 0.06), s.base + 1.65, hand * 0.21, 0.125, 0.43, 0.075, iron);
    box(
      side * (s.hx + 0.08),
      s.base + head + 0.19,
      hand * halfDoor * 0.72,
      0.19,
      0.48,
      0.105,
      iron,
    );
  }
  box(side * (s.hx - 0.04), s.base + head, 0, 0.39, 0.22, 2 * halfDoor + 0.38, frame);
  box(
    side * (s.hx + 0.16),
    s.base + head + 0.37,
    0,
    0.18,
    0.12,
    Math.min(2 * s.hz - 0.32, 3.62 * halfDoor),
    iron,
  );
}
