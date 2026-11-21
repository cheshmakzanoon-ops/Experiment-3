import * as T from 'three';
import {
  add,
  addGpRigidFinish,
  exhaustGeometry,
  superLoft,
  tube,
  type BikeMaterials,
} from './bike.ts';
import { addClassicInduction } from './road-bike-classic-induction.ts';
import { gpBellyOutlet, gpSilencer } from './gp-appearance.ts';
import { gpRadiator } from './gp-radiator.ts';
import type { BikeSheet } from './bike-sheet.ts';
import type { RiderDetail } from './rider.ts';

type Point = [number, number, number];
type Profile = readonly (readonly [number, number])[];

// Side elevation of the common crankcase casting, in chassis metres (Z, Y).
// The front lobe encloses the crank, the smaller rear lobe the transmission.
const CASE: Profile = [
  [-0.182, -0.268],
  [-0.16, -0.205],
  [-0.091, -0.174],
  [-0.012, -0.183],
  [0.047, -0.16],
  [0.153, -0.172],
  [0.217, -0.214],
  [0.234, -0.286],
  [0.204, -0.348],
  [0.13, -0.379],
  [-0.036, -0.378],
  [-0.143, -0.34],
];

function caseCasting(width: number, close: boolean) {
  const shape = new T.Shape(CASE.map(([z, y]) => new T.Vector2(-z, y)));
  const depth = 2 * width;
  const geometry = new T.ExtrudeGeometry(shape, {
    depth,
    bevelEnabled: true,
    bevelThickness: 0.009,
    bevelSize: 0.008,
    bevelSegments: close ? 2 : 1,
    curveSegments: 1,
  });
  return geometry.translate(0, 0, -width).rotateY(Math.PI / 2);
}

function turned(profile: Profile, sides: number) {
  return new T.LatheGeometry(
    profile.map(([radius, height]) => new T.Vector2(radius, height)),
    sides,
  );
}

/** Press-formed expansion pipe. Each station sets its centre and its radius.
 * The straight conical generators meet at welded seams and the header bends
 * out of the cylinder. The stinger folds back into the open outlet. */
function chamber(x: number, outletX: number, dz: number, sides: number) {
  const rings: [number, number, number, number][] = [
    [x, -0.083, 0.255, 0.024],
    [x, -0.097, 0.302, 0.024],
    [x, -0.152, 0.32, 0.025],
    [x, -0.242, 0.305, 0.028],
    [x * 1.1, -0.325, 0.242, 0.035],
    [x * 1.16, -0.35, 0.15, 0.046],
    [x * 1.22, -0.355, 0.05, 0.054],
    [outletX * 0.81, -0.35, -0.1, 0.055],
    [outletX, -0.32, -0.24 + dz, 0.046],
    [outletX, -0.285, -0.36 + dz, 0.024],
    [outletX, -0.268, -0.41 + dz, 0.016],
    [outletX, -0.171, -0.69 + dz, 0.016],
  ];
  const points = rings.map(([px, y, z]) => new T.Vector3(px, y, z));
  const tangent = new T.Vector3(),
    across = new T.Vector3(),
    up = new T.Vector3();
  const positions: number[] = [],
    uvs: number[] = [],
    colours: number[] = [],
    index: number[] = [];
  const metal = new T.Color(),
    flank = new T.Vector3(),
    stride = sides + 1;
  for (let i = 0; i < rings.length + 2; i++) {
    const k = Math.min(i, rings.length - 1),
      centre = points[k];
    tangent
      .subVectors(points[Math.min(k + 1, points.length - 1)], points[Math.max(k - 1, 0)])
      .normalize();
    across.set(1, 0, 0).addScaledVector(tangent, -tangent.x).normalize();
    up.crossVectors(tangent, across);
    const bore = i >= rings.length;
    const radius = rings[k][3] - (bore ? 0.002 : 0);
    for (let j = 0; j <= sides; j++) {
      const a = ((j % sides) * 2 * Math.PI) / sides;
      flank
        .copy(centre)
        .addScaledVector(across, radius * Math.cos(a))
        .addScaledVector(up, radius * Math.sin(a));
      if (i === rings.length + 1) flank.addScaledVector(tangent, -0.044);
      positions.push(flank.x, flank.y, flank.z);
      uvs.push(j / sides, k / (rings.length - 1));
      metal.setHex(
        i === rings.length + 1 ? 0x171617 : bore ? 0x9c968c : k < 4 ? 0x877d7a : 0xb39c8b,
      );
      colours.push(metal.r, metal.g, metal.b);
      if (i && j) {
        const d = i * stride + j;
        index.push(d - stride - 1, d - stride, d, d - stride - 1, d, d - 1);
      }
    }
  }
  const geometry = new T.BufferGeometry();
  geometry.setAttribute('position', new T.Float32BufferAttribute(positions, 3));
  geometry.setAttribute('uv', new T.Float32BufferAttribute(uvs, 2));
  geometry.setAttribute('color', new T.Float32BufferAttribute(colours, 3));
  geometry.setIndex(index);
  geometry.computeVertexNormals();
  // Tile the UVs at the underside without creating a normal-map/highlight seam.
  const normals = geometry.getAttribute('normal');
  for (let i = 0; i < positions.length / 3; i += stride) {
    flank.fromBufferAttribute(normals, i);
    tangent
      .fromBufferAttribute(normals, i + sides)
      .add(flank)
      .normalize();
    normals.setXYZ(i, tangent.x, tangent.y, tangent.z);
    normals.setXYZ(i + sides, tangent.x, tangent.y, tangent.z);
  }
  return geometry;
}

/** Build into the sprung body's own finish batches. Occluded cylinders use
 * fewer radial divisions than an exposed road engine. Far only needs the
 * silhouette exposed below the tank and the appropriate exhaust outlet. */
export function addRoadPowertrain(
  body: T.Group,
  id: string,
  look: BikeSheet,
  detail: RiderDetail,
  m: BikeMaterials,
) {
  const classic = look.exhaust === 'expansion',
    naked = look.fairing === 'naked';
  const exposed = naked || classic,
    near = detail === 'high',
    far = detail === 'far';
  const full = near && exposed,
    prototype = id === 'gpr1' || id === 'gpr2';
  const v4 = id === 'gpr1',
    cylinders = exposed ? 3 : 4;
  const width = classic ? 0.148 : naked ? 0.16 : 0.137;
  const sides = full ? 24 : near ? 14 : far ? 8 : 12;
  if (!far || exposed) {
    add(body, caseCasting(width, full), classic ? m.caliper : m.dark).name =
      'Split crankcase and transmission';
    if (classic && !far) {
      // A horizontal joint joins the two sand-cast crankcase halves. The lip
      // extends past the cast walls where the through-bolts clamp the joint.
      const joint = superLoft(
        [
          { z: -0.177, y: -0.269, w: width * 0.92, top: 0.003, bottom: 0.003 },
          { z: -0.14, y: -0.267, w: width + 0.016, top: 0.005, bottom: 0.004 },
          { z: 0.16, y: -0.264, w: width + 0.016, top: 0.005, bottom: 0.004 },
          { z: 0.218, y: -0.264, w: width * 0.93, top: 0.003, bottom: 0.003 },
        ],
        full ? 12 : 8,
        3.2,
      );
      add(body, joint, m.steel).name = 'Crankcase joint flange';
      for (const side of [-1, 1])
        for (const z of [-0.117, 0.086, 0.151]) {
          const x = side * (width + 0.002);
          add(
            body,
            new T.CylinderGeometry(0.012, 0.014, 0.033, full ? 10 : 6),
            m.caliper,
            x,
            -0.261,
            z,
          );
          if (full)
            add(body, new T.CylinderGeometry(0.009, 0.009, 0.006, 6), m.aluminium, x, -0.2415, z);
        }
    }
    for (const side of [-1, 1]) {
      const radius = side < 0 ? 0.105 : 0.083,
        z = side < 0 ? 0.024 : 0.102;
      const cover = turned(
        [
          [radius * 1.02, 0],
          [radius * 1.02, 0.007],
          [radius, 0.011],
          [radius * 0.94, 0.017],
          [radius * 0.9, 0.026],
          [radius * 0.65, 0.032],
          [0.006, 0.034],
          [0, 0.034],
        ],
        sides,
      );
      const c = add(
        body,
        cover,
        classic ? m.aluminium : m.steel,
        side * (width + 0.004),
        -0.268,
        z,
      );
      c.rotation.z = (-side * Math.PI) / 2;
      c.name = side < 0 ? 'Clutch inspection cover' : 'Generator cover';
      if (full)
        for (let j = 0; j < 7; j++) {
          const a = ((j + 0.22) * Math.PI * 2) / 7;
          add(
            body,
            new T.CylinderGeometry(0.0044, 0.005, 0.004, 6),
            m.aluminium,
            side * (width + 0.014),
            -0.268 + radius * 0.966 * Math.cos(a),
            z + radius * 0.966 * Math.sin(a),
          ).rotation.z = (-side * Math.PI) / 2;
        }
    }
    // The V-four has two narrow inclined banks. In-line motors have a
    // single transverse head. The air-cooled triple has individual fins.
    for (const rear of v4 ? [false, true] : [false]) {
      const tilt = rear ? -0.52 : classic ? 0.15 : 0.39;
      const headZ = rear ? -0.008 : 0.181;
      const perBank = v4 ? 2 : cylinders,
        spacing = v4 ? 0.1 : classic ? 0.108 : 0.083;
      for (let j = 0; j < perBank; j++) {
        const x = (j - (perBank - 1) / 2) * spacing;
        const cylinder = turned(
          [
            [spacing * 0.47, -0.124],
            [spacing * 0.56, -0.113],
            [spacing * 0.53, -0.082],
            [spacing * 0.52, 0.045],
            [spacing * 0.58, 0.052],
            [spacing * 0.58, 0.065],
          ],
          full ? 14 : 8,
        );
        const barrel = add(body, cylinder, m.steel, x, -0.109, headZ);
        barrel.rotation.x = tilt;
        if (classic && !far) {
          const finCount = near ? 7 : 4;
          for (let k = 0; k < finCount; k++) {
            const h = -0.077 + (k * 0.143) / (finCount - 1);
            const r = 0.063 + 0.006 * Math.sin((k * Math.PI) / (finCount - 1));
            const fin = new T.CylinderGeometry(r * 0.98, r, 0.0055, near ? 12 : 8);
            fin.scale(0.75, 1, 1.27).rotateX(tilt);
            add(body, fin, m.aluminium, x, -0.109 + h * Math.cos(tilt), headZ + h * Math.sin(tilt));
          }
        }
        if (full) {
          let leadStart: Point = [x, -0.034, headZ + 0.024];
          if (classic) {
            const baseY = -0.039,
              baseZ = headZ + 0.014;
            const alongHead = (height: number): Point => [
              x,
              baseY + height * Math.cos(tilt),
              baseZ + height * Math.sin(tilt),
            ];
            const hex = add(
              body,
              new T.CylinderGeometry(0.012, 0.012, 0.012, 6),
              m.steel,
              ...alongHead(0.005),
            );
            hex.rotation.x = tilt;
            const insulator = turned(
              [
                [0.007, 0.008],
                [0.0065, 0.012],
                [0.008, 0.015],
                [0.0065, 0.017],
                [0.008, 0.02],
                [0.0065, 0.022],
                [0.008, 0.025],
                [0.006, 0.029],
              ],
              10,
            );
            const ceramic = add(body, insulator, m.reservoir, x, baseY, baseZ);
            ceramic.rotation.x = tilt;
            ceramic.name = 'Ribbed plug insulator';
            const boot = add(
              body,
              turned(
                [
                  [0.009, 0.024],
                  [0.01, 0.028],
                  [0.009, 0.037],
                  [0.005, 0.048],
                ],
                12,
              ),
              m.dark,
              x,
              baseY,
              baseZ,
            );
            boot.rotation.x = tilt;
            boot.name = 'Ignition lead boot';
            leadStart = alongHead(0.046);
          }
          const plug: Point[] = [
            leadStart,
            [x, classic ? 0.029 : 0.013, headZ + 0.028],
            [x * 0.84, 0.05, headZ - 0.025],
            [x * 0.66, 0.098, headZ - 0.09],
          ];
          add(body, tube(plug, 0.0048, 9, 5), m.dark);
        }
      }
      const top = new T.CylinderGeometry(1, 1, 1, full ? 12 : 8);
      top
        .scale(spacing * perBank * 0.56, classic ? 0.017 : 0.043, classic ? 0.065 : 0.085)
        .rotateX(tilt);
      add(body, top, classic ? m.aluminium : m.dark, 0, -0.045, headZ + Math.sin(tilt) * 0.066);
    }
  }
  if (!far && !classic) {
    const radiator = gpRadiator(detail, m);
    radiator.position.set(0, -0.1, 0.37);
    radiator.rotation.x = -0.25;
    body.add(radiator);
    if (naked)
      for (const s of [-1, 1]) {
        add(
          body,
          tube(
            [
              [s * 0.157, -0.17, 0.38],
              [s * 0.17, -0.18, 0.32],
              [s * 0.159, -0.119, 0.26],
              [s * 0.124, -0.105, 0.203],
            ],
            0.012,
            near ? 12 : 6,
            near ? 7 : 5,
          ),
          m.dark,
        );
      }
  }
  if (classic) {
    addClassicInduction(body, detail, m);
    for (const [x, end, dz] of [
      [-0.108, -0.181, -0.02],
      [0, 0.124, 0.075],
      [0.108, 0.205, -0.005],
    ]) {
      add(body, chamber(x, end, dz, full ? 16 : far ? 6 : 10), m.titanium).name =
        'Conical expansion chamber and stinger';
    }
    return;
  }

  const collector: Point = [0, -0.394, -0.07];
  if (!far || exposed) {
    for (let j = 0; j < cylinders; j++) {
      const rear = v4 && j >= 2;
      const x = v4 ? ((j % 2) - 0.5) * 0.1 : (j - (cylinders - 1) / 2) * 0.083;
      const path: Point[] = rear
        ? [
            [x, -0.077, -0.042],
            [x, -0.111, -0.117],
            [x * 1.34, -0.214, -0.163],
            [x * 1.38, -0.332, -0.19],
            collector,
          ]
        : [
            [x, -0.083, 0.226],
            [x, -0.101, 0.278],
            [x * 1.08, -0.233, 0.302],
            [x * 1.12, -0.345, 0.235],
            [x * 0.81, -0.391, 0.068],
            collector,
          ];
      add(
        body,
        exhaustGeometry(
          path,
          0.0205,
          full ? 24 : far ? 6 : 10,
          full ? 9 : 6,
          prototype ? 'gp-oxide' : 'classic',
        ),
        m.titanium,
      ).name = 'Exhaust primary';
    }
  }
  if (look.exhaust === 'underbelly') {
    const can = turned(
      [
        [0.025, -0.15],
        [0.055, -0.133],
        [0.063, -0.105],
        [0.065, 0.09],
        [0.057, 0.127],
        [0.025, 0.146],
      ],
      sides,
    );
    can.scale(1.43, 1, 0.7).rotateX(Math.PI / 2);
    add(body, can, m.titanium, -0.031, -0.396, -0.153);
    const exit: Point[] = [
      [-0.031, -0.396, -0.27],
      [-0.083, -0.386, -0.298],
      [-0.148, -0.358, -0.3],
    ];
    add(body, exhaustGeometry(exit, 0.026, near ? 10 : 6, sides), m.titanium);
    if (prototype && !far) {
      const outlet = gpBellyOutlet(detail, m);
      outlet.position.set(...exit[2]);
      const inward = new T.Vector3(...exit[1]).sub(outlet.position).normalize();
      outlet.quaternion.setFromUnitVectors(new T.Vector3(0, 1, 0), inward);
      addGpRigidFinish(body, outlet, [m.titanium, m.dark]);
    }
    return;
  }
  const short = look.exhaust === 'stubby',
    lengthScale = short ? 0.78 : 1;
  const centre = new T.Vector3(
    short ? -0.181 : -0.165,
    short ? -0.225 : -0.08,
    short ? -0.471 : -0.74,
  );
  const rotation = Math.PI / 2 - (short ? 0.28 : 0.35);
  const inlet: Point = [
    centre.x,
    centre.y + 0.149 * lengthScale * Math.cos(rotation),
    centre.z + 0.149 * lengthScale * Math.sin(rotation),
  ];
  const pipe: Point[] = [
    collector,
    [-0.076, -0.397, short ? -0.184 : -0.25],
    [-0.142, short ? -0.31 : -0.24, short ? -0.257 : -0.46],
    inlet,
  ];
  add(
    body,
    exhaustGeometry(
      pipe,
      0.03,
      near ? 18 : far ? 6 : 10,
      near ? 9 : 6,
      prototype ? 'gp-oxide' : 'classic',
    ),
    m.titanium,
  );
  if (far) {
    const casing = turned(
      [
        [0.027, -0.106],
        [0.03, -0.155],
        [0.04, -0.151],
        [0.055, -0.11],
        [0.054, 0.11],
        [0.032, 0.15],
      ],
      10,
    );
    casing.scale(short ? 1.09 : 1, lengthScale, short ? 0.91 : 1).rotateX(rotation);
    add(body, casing, m.titanium, centre.x, centre.y, centre.z);
    return;
  }
  const silencer = gpSilencer(detail, m, prototype);
  silencer.scale.set(short ? 1.09 : 1, lengthScale, short ? 0.91 : 1);
  silencer.position.copy(centre);
  silencer.rotation.x = rotation;
  addGpRigidFinish(body, silencer, [m.titanium, m.dark]);
}
