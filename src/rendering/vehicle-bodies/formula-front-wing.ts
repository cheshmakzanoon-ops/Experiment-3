import { aeroPlate, wingElement } from '../bodywork.ts';
import type { CarMaterials } from './common.ts';
import { sharedMaterials } from './materials.ts';
import { Parts, placed } from './parts.ts';
import type { Detail } from './wheel.ts';

/** A common mounting envelope with three original aero packages. Stations
 * are measured aft from the leading edge. The endplates carry the outboard
 * slots and both pylons connect the mainplane to the underside of the nose. */
export function buildFormulaFrontWing(
  parts: Parts,
  mats: CarMaterials,
  model: string,
  span: number,
  y: number,
  noseHeight: number,
  z: number,
  detail: Detail,
) {
  const carbon = sharedMaterials.carbon();
  const resolution = detail === 0 ? 'high' : detail === 1 ? 'mid' : 'far';
  const longWing = model === 'jf2',
    twinUpper = model === 'fx26';
  const sweep = longWing ? 0.049 : twinUpper ? 0.059 : 0.033;
  const half = span * 0.5;
  const profile = (
    width: number,
    chord: number,
    camber: number,
    thickness: number,
    bend: number,
    gull: number,
  ) => wingElement(width, chord, camber, thickness, bend, gull, resolution);
  parts.add(
    profile(span, 0.3, 0.013, 0.011, sweep, -0.019),
    carbon,
    placed(0, y + 0.015, z - 0.145, 0.055),
  );
  parts.add(
    profile(span * 0.985, 0.155, 0.014, 0.0075, sweep * 1.14, -0.024),
    longWing ? mats.paint : carbon,
    placed(0, y + 0.062, z - 0.327, 0.17),
  );
  // The short upper elements leave the centre open under the nose. Slot
  // gaps stay open at reduced detail and the rear edges meet the endplate.
  const inner = model === 'fr3' ? 0.28 : 0.2;
  const width = half - inner - 0.006;
  for (const side of [-1, 1]) {
    const mid = side * (inner + width / 2);
    parts.add(
      profile(width, longWing ? 0.158 : 0.136, 0.013, 0.007, 0.015, -0.007),
      mats.accent,
      placed(mid, y + 0.115, z - 0.421, 0.28),
    );
    if (twinUpper)
      parts.add(
        profile(width * 0.84, 0.079, 0.006, 0.0045, 0.01, -0.006),
        carbon,
        placed(side * (half - width * 0.42 - 0.01), y + 0.159, z - 0.484, 0.35),
      );
    const plate = aeroPlate(
      [
        [0.005, -0.006],
        [-0.035, 0.063],
        [-0.13, 0.084],
        [-0.29, 0.121],
        [-0.42, 0.195],
        [-0.515, 0.195],
        [-0.518, 0.035],
        [-0.462, -0.007],
      ],
      0.009,
    );
    parts.add(plate, mats.paint, placed(side * half, y, z));
    // The contoured outwash foot turns up at its trailing end.
    parts.add(
      profile(0.072, 0.302, 0.009, 0.004, 0, 0),
      carbon,
      placed(side * (half - 0.022), y + 0.005, z - 0.29, 0.024),
    );
    parts.add(
      aeroPlate(
        [
          [-0.091, 0],
          [-0.142, 0],
          [-0.225, noseHeight],
          [-0.156, noseHeight],
        ],
        0.019,
      ),
      carbon,
      placed(side * 0.115, y + 0.017, z),
    );
    if (detail < 2) {
      for (const offset of [0.42, 0.78]) {
        const cross = side * (inner + width * offset);
        parts.add(
          aeroPlate(
            [
              [-0.277, 0.03],
              [-0.295, 0.035],
              [-0.307, 0.075],
              [-0.293, 0.076],
            ],
            0.0045,
          ),
          carbon,
          placed(cross, y, z),
        );
        parts.add(
          aeroPlate(
            [
              [-0.361, 0.075],
              [-0.379, 0.079],
              [-0.411, 0.129],
              [-0.397, 0.127],
            ],
            0.0045,
          ),
          carbon,
          placed(cross, y, z),
        );
      }
    }
  }
}
