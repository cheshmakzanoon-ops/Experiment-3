import * as T from 'three';
import { add, superLoft, tube, type BikeMaterials } from './bike.ts';
import type { RiderDetail } from './rider.ts';

/** Cross-sections run upstream from the rear of the cylinder. The bell lip
 * turns back into its own bore so the inlet is genuinely hollow from behind. */
function intakeSection(stations: readonly [number, number][], sides: number) {
  return new T.LatheGeometry(
    stations.map(([length, radius]) => new T.Vector2(radius, length)),
    sides,
  ).rotateX(-Math.PI / 2);
}

export function addClassicInduction(body: T.Group, detail: RiderDetail, m: BikeMaterials) {
  const near = detail === 'high',
    far = detail === 'far';
  const sides = near ? 20 : far ? 6 : 12;
  // A separate oil reservoir hangs inside the frame triangle. Its lower
  // corner follows the brace up towards the pair of rear shock mounts.
  add(
    body,
    superLoft(
      [
        { z: -0.49, y: 0.14, w: 0.079, top: 0.028, bottom: 0.013 },
        { z: -0.427, y: 0.115, w: 0.112, top: 0.046, bottom: 0.035 },
        { z: -0.31, y: 0.07, w: 0.12, top: 0.085, bottom: 0.059 },
        { z: -0.19, y: 0.049, w: 0.116, top: 0.092, bottom: 0.077 },
        { z: -0.115, y: 0.073, w: 0.076, top: 0.052, bottom: 0.049 },
      ],
      near ? 18 : far ? 8 : 12,
      3.2,
    ),
    m.secondary,
  ).name = 'Pressed underseat oil reservoir';
  for (const side of [-1, 1]) {
    const shoulder: [number, number, number] = [side * 0.114, 0.205, -0.508];
    add(
      body,
      tube(
        [
          [side * 0.12, -0.13, -0.2],
          [side * 0.128, -0.019, -0.294],
          [side * 0.126, 0.108, -0.424],
          shoulder,
          [side * 0.102, 0.239, -0.59],
        ],
        0.014,
        near ? 16 : 8,
        near ? 8 : 5,
      ),
      m.steel,
    ).name = 'Rear shock tower brace';
    add(
      body,
      tube(
        [shoulder, [side * 0.128, 0.17, -0.31], [side * 0.122, 0.139, -0.095]],
        0.013,
        near ? 10 : 5,
        near ? 8 : 5,
      ),
      m.steel,
    );
  }
  for (const x of [-0.108, 0, 0.108]) {
    const axisY = -0.105,
      portZ = 0.143;
    if (far) {
      // At field distance the rubber, bowl and slide are subpixel. One turned
      // shell per cylinder preserves the connected banks and the open mouths.
      const casting = intakeSection(
        [
          [0, 0.029],
          [0.086, 0.036],
          [0.146, 0.031],
          [0.192, 0.045],
          [0.195, 0.041],
          [0.149, 0.026],
        ],
        sides,
      );
      add(body, casting, m.aluminium, x, axisY, portZ).name = 'Rolled intake bell';
      continue;
    }
    add(
      body,
      intakeSection(
        [
          [0, 0.029],
          [0.009, 0.034],
          [0.043, 0.034],
          [0.051, 0.029],
        ],
        sides,
      ),
      m.dark,
      x,
      axisY,
      portZ,
    ).name = 'Carburettor inlet rubber';
    add(
      body,
      intakeSection(
        [
          [0.044, 0.027],
          [0.053, 0.036],
          [0.061, 0.039],
          [0.096, 0.039],
          [0.107, 0.032],
          [0.136, 0.031],
        ],
        sides,
      ),
      m.aluminium,
      x,
      axisY,
      portZ,
    ).name = 'Carburettor casting';
    add(
      body,
      intakeSection(
        [
          [0.126, 0.032],
          [0.147, 0.032],
          [0.17, 0.037],
          [0.187, 0.044],
          [0.192, 0.045],
          [0.195, 0.043],
          [0.191, 0.04],
          [0.174, 0.034],
          [0.147, 0.027],
          [0.105, 0.026],
        ],
        sides,
      ),
      m.aluminium,
      x,
      axisY,
      portZ,
    ).name = 'Rolled intake bell';
    const bowl = new T.LatheGeometry(
      [
        new T.Vector2(0, -0.026),
        new T.Vector2(0.022, -0.023),
        new T.Vector2(0.033, -0.013),
        new T.Vector2(0.036, 0.015),
        new T.Vector2(0.037, 0.02),
        new T.Vector2(0.033, 0.024),
      ],
      sides,
    ).scale(1, 1, 0.85);
    add(body, bowl, m.aluminium, x, -0.151, 0.065).name = 'Float bowl';
    add(body, new T.CylinderGeometry(0.019, 0.022, 0.051, sides), m.steel, x, -0.064, 0.066);
    add(body, new T.CylinderGeometry(0.022, 0.021, 0.012, sides), m.dark, x, -0.034, 0.066);
    if (!near) continue;
    add(
      body,
      intakeSection(
        [
          [0.014, 0.0348],
          [0.023, 0.0348],
        ],
        16,
      ),
      m.steel,
      x,
      axisY,
      portZ,
    );
    add(
      body,
      tube(
        [
          [x, -0.028, 0.066],
          [x, 0.009, 0.066],
          [x * 0.9, 0.063, 0.06],
          [0.012, 0.102, 0.025],
        ],
        0.0028,
        10,
        5,
      ),
      m.dark,
    ).name = 'Throttle cable';
    // Each existing plug lead terminates inside its own rubber coil socket.
    const coilX = x * 0.66;
    add(body, new T.CylinderGeometry(0.015, 0.012, 0.027, 10), m.dark, coilX, 0.108, 0.091);
    add(body, new T.CylinderGeometry(0.022, 0.021, 0.052, 12), m.dark, coilX, 0.14, 0.091);
  }
  if (near) {
    add(body, new T.BoxGeometry(0.19, 0.02, 0.052), m.steel, 0, 0.167, 0.091).name =
      'Coil mounting rail';
    add(
      body,
      tube(
        [
          [0.012, 0.102, 0.025],
          [0.014, 0.129, 0.072],
          [0.016, 0.16, 0.145],
          [0.035, 0.18, 0.235],
        ],
        0.004,
        12,
        6,
      ),
      m.dark,
    );
  }
}
