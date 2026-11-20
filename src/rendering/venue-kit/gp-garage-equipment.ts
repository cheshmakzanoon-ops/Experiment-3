import * as T from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import type { Track } from '../../simulation/track.ts';
import { gpForgedWheel } from '../gp-forged-wheel.ts';
import { gpPaddockPlan } from './gp-paddock-architecture.ts';

/** A removable heated blanket around a 640 mm slick. The elastic skirts
 * leave the hub open. Quilting, a closure tab and the coiled supply lead
 * share one indexed stream and one fabric material across all garages. */
function tyreWarmer() {
  const positions: number[] = [],
    colours: number[] = [],
    uv: number[] = [],
    index: number[] = [];
  const segments = 64;
  const profile = [
    [-0.079, 0.237],
    [-0.09, 0.248],
    [-0.092, 0.285],
    [-0.085, 0.303],
    [-0.061, 0.324],
    [-0.025, 0.329],
    [0.025, 0.329],
    [0.061, 0.324],
    [0.085, 0.303],
    [0.092, 0.285],
    [0.09, 0.248],
    [0.079, 0.237],
  ];
  const canvas = new T.Color(0x53606a),
    piping = new T.Color(0xd59855),
    binding = new T.Color(0x272c31),
    panel = new T.Color();
  for (const [row, [x, radius]] of profile.entries()) {
    for (let j = 0; j <= segments; j++) {
      const theta = (j / segments) * Math.PI * 2;
      const seam = (0.5 + 0.5 * Math.cos(theta * 16)) ** 6;
      const crown = Math.max(0, 1 - Math.abs(x / 0.096) ** 3);
      const r = radius + crown * (0.004 - 0.006 * seam);
      positions.push(x, r * Math.cos(theta), r * Math.sin(theta));
      uv.push(j / segments, row / (profile.length - 1));
      const colour = row === 1 || row === 10 ? piping : row === 0 || row === 11 ? binding : canvas;
      panel.copy(colour).multiplyScalar(1 - 0.33 * seam);
      colours.push(panel.r, panel.g, panel.b);
      if (row < profile.length - 1 && j < segments) {
        const a = row * (segments + 1) + j,
          b = a + segments + 1;
        index.push(a, a + 1, b, a + 1, b + 1, b);
      }
    }
  }
  const jacket = new T.BufferGeometry();
  jacket.setAttribute('position', new T.Float32BufferAttribute(positions, 3));
  jacket.setAttribute('color', new T.Float32BufferAttribute(colours, 3));
  jacket.setAttribute('uv', new T.Float32BufferAttribute(uv, 2));
  jacket.setIndex(index);
  jacket.computeVertexNormals();
  const shade = (geometry: T.BufferGeometry, colour: number) => {
    const rgb = new T.Color(colour),
      count = geometry.getAttribute('position').count;
    const attribute = new T.Float32BufferAttribute(new Float32Array(count * 3), 3);
    for (let i = 0; i < count; i++) attribute.setXYZ(i, rgb.r, rgb.g, rgb.b);
    return geometry.setAttribute('color', attribute);
  };
  const tab = shade(new T.BoxGeometry(0.092, 0.012, 0.069), 0xc8894e);
  tab.rotateX(0.3).translate(-0.016, 0.319, 0.099);
  const lead = new T.CatmullRomCurve3([
    new T.Vector3(-0.083, -0.102, 0.264),
    new T.Vector3(-0.121, -0.21, 0.273),
    new T.Vector3(-0.13, -0.345, 0.196),
    new T.Vector3(-0.12, -0.318, 0.119),
    new T.Vector3(-0.115, -0.203, 0.12),
  ]);
  const cable = shade(new T.TubeGeometry(lead, 16, 0.0045, 5, false), 0x292c30);
  const plug = shade(new T.CylinderGeometry(0.011, 0.012, 0.041, 8), 0x3c4145);
  plug.translate(-0.115, -0.188, 0.12);
  const parts = [jacket, tab, cable, plug];
  const result = mergeGeometries(parts)!;
  for (const part of parts) part.dispose();
  return result;
}

/** A set of spare wheels on a low axle trolley, and a separate rolled-tube
 * paddock stand. All coordinates below are relative to the actual bay floor.
 * Portable equipment stays to one side of the garage access corridor. */
export function buildGpGarageEquipment(track: Track) {
  const bays = gpPaddockPlan(track);
  if (!bays.length) return null;
  const root = new T.Group();
  root.name = 'Grand Prix motorcycle garage equipment';
  const steel = new T.MeshStandardMaterial({
    name: 'GP brushed trolley tube',
    color: 0xc0c3c1,
    metalness: 0.72,
    roughness: 0.38,
  });
  const painted = new T.MeshStandardMaterial({
    name: 'GP enamel stand fabrication',
    color: 0xffffff,
    metalness: 0.31,
    roughness: 0.47,
  });
  const alloy = new T.MeshStandardMaterial({
    name: 'GP spare wheel alloy',
    color: 0x45474b,
    metalness: 0.72,
    roughness: 0.36,
  });
  const rubber = new T.MeshStandardMaterial({
    name: 'GP spare slick rubber',
    color: 0x242629,
    metalness: 0,
    roughness: 0.8,
  });
  const bars: T.Matrix4[] = [],
    paintedBars: T.Matrix4[] = [],
    barColours: T.Color[] = [],
    tyres: T.Matrix4[] = [],
    rims: T.Matrix4[] = [],
    warmers: T.Matrix4[] = [],
    rollers: T.Matrix4[] = [];
  const palettes = [0x894239, 0x4d616e, 0xbb9a50, 0x545a62];
  const site = new T.Object3D(),
    cart = new T.Object3D(),
    shape = new T.Object3D();
  const up = new T.Vector3(0, 1, 0),
    axis = new T.Vector3(),
    a = new T.Vector3(),
    b = new T.Vector3();
  const transform = () => {
    shape.updateMatrix();
    return new T.Matrix4().multiplyMatrices(cart.matrixWorld, shape.matrix);
  };
  function tube(start: readonly number[], end: readonly number[], radius: number, colour?: number) {
    a.fromArray(start);
    b.fromArray(end);
    axis.subVectors(b, a);
    shape.position.copy(a).addScaledVector(axis, 0.5);
    shape.scale.set(radius, axis.length(), radius);
    shape.quaternion.setFromUnitVectors(up, axis.normalize());
    if (colour === undefined) bars.push(transform());
    else {
      paintedBars.push(transform());
      barColours.push(new T.Color(colour));
    }
  }
  function wheel(
    x: number,
    y: number,
    z: number,
    halfWidth: number,
    radius: number,
    covered: boolean,
  ) {
    shape.position.set(x, y, z);
    shape.rotation.set(0, 0, 0);
    shape.scale.set(halfWidth / 0.0825, radius / 0.32, radius / 0.32);
    const frame = transform();
    tyres.push(frame);
    if (covered) warmers.push(frame);
    shape.scale.set(halfWidth / 0.0825, 1, 1);
    rims.push(transform());
  }
  function caster(x: number, y: number, z: number) {
    shape.position.set(x, y, z);
    shape.rotation.set(0, 0, 0);
    shape.scale.set(1, 1, 1);
    rollers.push(transform());
  }
  site.add(cart);
  for (const bay of bays) {
    if (bay.index % 2 !== 0) continue;
    const colour = palettes[(bay.index / 2) % palettes.length],
      hand = bay.index % 4 === 0 ? 1 : -1;
    site.position.set(bay.x, bay.y, bay.z);
    site.rotation.y = bay.yaw;
    cart.position.set(-3.65, 0.05, hand * 2.58);
    cart.rotation.y = hand * 0.36;
    site.updateMatrixWorld(true);
    // The wheels hang by their hollow hubs on a cross-shaft. The base
    // can roll on four castors; rubber rests above the actual bay floor.
    for (const z of [-0.31, 0.31]) {
      tube([-0.57, 0.15, z], [0.57, 0.15, z], 0.021);
      for (const x of [-0.52, 0.52]) {
        caster(x, 0.075, z);
        tube([x, 0.084, z], [x, 0.15, z], 0.014);
      }
    }
    for (const x of [-0.56, 0.56]) {
      tube([x, 0.15, -0.31], [x, 0.15, 0.31], 0.022);
      tube([x, 0.15, -0.28], [x, 0.55, 0], 0.018, colour);
      tube([x, 0.55, 0], [x, 0.15, 0.28], 0.018, colour);
    }
    tube([-0.586, 0.545, 0], [0.586, 0.545, 0], 0.015);
    const slots = bay.index % 3 === 0 ? 3 : 2;
    for (let i = 0; i < slots; i++)
      wheel(
        -0.32 + i * 0.28,
        0.545,
        0,
        i === 1 ? 0.06 : 0.102,
        i === 1 ? 0.302 : 0.322,
        i === (bay.index % 4 === 0 ? 0 : 1),
      );
    // A wheeled rear paddock stand parked beside the trolley. Its two
    // forked pickups are open at the top so a bobbin can enter vertically.
    cart.position.set(-5.34, 0.05, hand * 2.65);
    cart.rotation.y = -hand * 0.43;
    site.updateMatrixWorld(true);
    for (const x of [-0.24, 0.24]) {
      caster(x, 0.075, -0.19);
      tube([x, 0.075, -0.19], [x, 0.105, 0.43], 0.02, colour);
      tube([x, 0.075, -0.19], [x, 0.38, -0.29], 0.02, colour);
      tube([x, 0.37, -0.29], [x, 0.415, -0.32], 0.012);
      tube([x, 0.37, -0.29], [x, 0.412, -0.254], 0.012);
    }
    tube([-0.24, 0.105, 0.43], [0.24, 0.105, 0.43], 0.02, colour);
  }
  const slick = new T.LatheGeometry(
    [
      new T.Vector2(0.215, -0.064),
      new T.Vector2(0.252, -0.085),
      new T.Vector2(0.288, -0.0825),
      new T.Vector2(0.309, -0.049),
      new T.Vector2(0.32, 0),
      new T.Vector2(0.309, 0.049),
      new T.Vector2(0.288, 0.0825),
      new T.Vector2(0.252, 0.085),
      new T.Vector2(0.215, 0.064),
    ],
    24,
  ).rotateZ(Math.PI / 2);
  const casterGeometry = new T.LatheGeometry(
    [
      new T.Vector2(0.014, -0.018),
      new T.Vector2(0.063, -0.018),
      new T.Vector2(0.075, -0.012),
      new T.Vector2(0.075, 0.012),
      new T.Vector2(0.063, 0.018),
      new T.Vector2(0.014, 0.018),
    ],
    12,
  ).rotateZ(Math.PI / 2);
  function batch(
    name: string,
    geometry: T.BufferGeometry,
    material: T.Material,
    matrices: T.Matrix4[],
    colours?: T.Color[],
  ) {
    const mesh = new T.InstancedMesh(geometry, material, matrices.length);
    mesh.name = name;
    matrices.forEach((matrix, i) => {
      mesh.setMatrixAt(i, matrix);
      if (colours) mesh.setColorAt(i, colours[i]);
    });
    mesh.computeBoundingBox();
    mesh.computeBoundingSphere();
    mesh.castShadow = mesh.receiveShadow = true;
    root.add(mesh);
  }
  const tubeGeometry = new T.CylinderGeometry(1, 1, 1, 8);
  batch('Welded rack frames and shafts', tubeGeometry, steel, bars);
  batch('Painted stand tubes and uprights', tubeGeometry, painted, paintedBars, barColours);
  batch('Rounded front and rear GP spares', slick, rubber, tyres);
  batch('Forged spare wheel rims', gpForgedWheel(0.216, 0.0825, 'far'), alloy, rims);
  batch('Load-bearing trolley and stand rollers', casterGeometry, rubber, rollers);
  const textile = new T.MeshStandardMaterial({
    name: 'GP quilted warmer fabric',
    vertexColors: true,
    roughness: 0.91,
  });
  batch('Quilted tyre warmers with power leads', tyreWarmer(), textile, warmers);
  return root;
}
