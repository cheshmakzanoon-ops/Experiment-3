import { smooth } from '../../core/math.ts';
import { valueNoise } from '../terrain-profile.ts';

type Relief = (x: number, z: number) => number;

const bell = (distance: number, width: number) => Math.exp(-((distance / width) ** 2));

/** Extra relief in metres, sampled on the existing terrain grid. Bearings and
 * distances are local to the venue. Shore coordinates at Cape Wrenna are in
 * this same frame and its measured normal points out to sea. */
export function gpCountryside(
  course: string, coastX: number, coastZ: number, seaX: number, seaZ: number,
): Relief | undefined {
  switch (course) {
    case 'poggio-alto':
      return (x, z) => {
        const along = 0.88 * x + 0.475 * z, across = -0.475 * x + 0.88 * z;
        const valley = valueNoise(along / 570 + 6.2, across / 390 - 3.8);
        const fold = valueNoise(along / 190 - 4.4, across / 220 + 2.7);
        const north = bell(across - 1110 - 230 * valley, 330 + 180 * fold)
          * (72 + 105 * valley + 32 * fold);
        const southwest = bell(across + 1250 + 0.28 * along - 270 * fold, 460)
          * (85 + 115 * fold) * (0.56 + 0.44 * bell(along + 580, 1150));
        return Math.max(north, southwest) + 0.18 * Math.min(north, southwest);
      };
    case 'montejaral':
      return (x, z) => {
        const along = 0.79 * x - 0.61 * z, across = 0.61 * x + 0.79 * z;
        const spur = valueNoise(along / 215 + 9.8, across / 260 - 3.7);
        const fault = valueNoise(along / 490 - 1.5, across / 415 + 4.1);
        const eroded = 1 - Math.abs(2 * spur - 1);
        const crest = across - 1230 - 240 * fault - 95 * spur;
        const saddle = 1 - 0.49 * bell(along - 130, 275);
        const sierra = (130 + 140 * fault + 66 * eroded) * saddle
          * bell(crest, crest < 0 ? 320 + 170 * spur : 280);
        const foothills = (32 + 64 * spur) * bell(across - 815 + 0.12 * along - 105 * fault, 230);
        const west = (80 + 115 * fault) * bell(along + 1500 + 0.19 * across, 410)
          * bell(across + 330, 1150);
        return Math.max(sierra, foothills, west) + 0.23 * Math.min(sierra, foothills);
      };
    case 'haarveld':
      return (x, z) => {
        // A low, grassed dyke with a broad back, a shallow toe and a break for
        // drainage. The distant peat and the clear sightline stay nearly level.
        const along = 0.94 * x + 0.342 * z, across = -0.342 * x + 0.94 * z;
        const bend = valueNoise(along / 840 + 4.8, 2.7);
        const offset = across - 1030 - 135 * bend, gate = smooth(38, 185, Math.abs(along + 410));
        return gate * (3.9 * bell(offset, 42) + 2.3 * bell(offset - 32, 125))
          + 2.2 * bell(across + 1130 + 0.11 * along, 170);
      };
    case 'cape-wrenna':
      return (x, z) => {
        const dx = x - coastX, dz = z - coastZ;
        const inland = -dx * seaX - dz * seaZ;
        if (inland <= 0) return 0;
        const along = -dx * seaZ + dz * seaX;
        const windcut = valueNoise(along / 185 + 3.8, inland / 240 - 4.6);
        const north = bell(along - 1250, 510) * bell(inland - 225 - 95 * windcut, 310);
        const south = bell(along + 1460, 610) * bell(inland - 420, 470);
        return smooth(0, 155, inland) * (north * (55 + 28 * windcut) + south * (42 + 29 * windcut));
      };
  }
}
