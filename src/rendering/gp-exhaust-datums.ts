/** Original exhaust survey. Chassis metres, +Y up and +Z forward. The
 * geometry and the refracting air both start at the formed outlet lip. */
export const ROAD_SIDE_CAN = Object.freeze({
  centre: [-.165, -.08, -.74] as const,
  rotation: Math.PI / 2 - .35,
  lip: -.158,
});
export const BELLY_EXIT: readonly [number, number, number][] = [
  [-.031, -.396, -.27],
  [-.083, -.386, -.298],
  [-.148, -.358, -.3],
];

interface GpExhaustMouth {
  position: readonly [number, number, number];
  direction: readonly [number, number, number];
  radius: number;
}

const cos = Math.cos(ROAD_SIDE_CAN.rotation), sin = Math.sin(ROAD_SIDE_CAN.rotation);
const centre = ROAD_SIDE_CAN.centre, lip = ROAD_SIDE_CAN.lip;
const end = BELLY_EXIT[2], previous = BELLY_EXIT[1];
const dx = end[0] - previous[0], dy = end[1] - previous[1], dz = end[2] - previous[2];
const length = Math.hypot(dx, dy, dz);
export const GP_EXHAUST_MOUTHS: Readonly<Record<'gpr1' | 'gpr2', GpExhaustMouth>> = {
  gpr1: {
    position: [centre[0], centre[1] + lip * cos, centre[2] + lip * sin],
    direction: [0, -cos, -sin],
    radius: .030,
  },
  gpr2: {
    position: end,
    direction: [dx / length, dy / length, dz / length],
    radius: .0232,
  },
};
