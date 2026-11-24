import * as T from 'three';
import { mxServiceTyre, mxServiceWheelDish, mxServiceWheelLip } from './mx-service-wheel.ts';
import { mxVanPrint } from './mx-van-print.ts';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { chainShaderHook, injectAfter, injectDeclarations } from '../studio/shader-hooks.ts';

/** The van is one instanced draw. Only its painted panels take the instance
 * colour. Glass, rubber, reflectors and alloy keep their own optical finish. */
export function mxTeamVanMaterial() {
  const material = new T.MeshStandardMaterial({ name: 'MX team vans', vertexColors: true });
  const print = mxVanPrint();
  material.addEventListener('dispose', () => print.dispose());
  chainShaderHook(material, 'mx-service-van-finish-v3', (s) => {
    s.uniforms.mxVanPrint = { value: print };
    injectDeclarations(
      s,
      'common',
      `attribute vec3 mxFinish;
       attribute float mxVanCrew;
       varying vec3 vMxVanFinish;
       varying vec3 vMxVanPrint;`,
      'vertex',
    );
    injectDeclarations(
      s,
      'common',
      'uniform sampler2D mxVanPrint; varying vec3 vMxVanFinish; varying vec3 vMxVanPrint;',
      'fragment',
    );
    injectAfter(
      s,
      'color_vertex',
      `vMxVanFinish = vec3(mxFinish.yz, mxFinish.x * smoothstep(.78,.95,abs(normal.x)));
      vMxVanPrint = vec3(.5 - sign(position.x) * (position.z + 1.04) / 2.96,
                         (position.y - .98) / 1.24, mxVanCrew);
      #ifdef USE_INSTANCING_COLOR
        vColor.rgb = color.rgb * mix(vec3(1.0), instanceColor.rgb, mxFinish.x);
      #endif`,
      'vertex',
    );
    injectAfter(
      s,
      'color_fragment',
      `{
      vec2 uv = vMxVanPrint.xy;
      vec2 panel = clamp(uv, 0., 1.);
      vec2 page = vec2(panel.x, (3.0 - vMxVanPrint.z + panel.y) * .25);
      // Sample coherently across the whole fragment quad, including where
      // a side panel meets a wheel arch or a differently finished mesh.
      vec4 print = texture2D(mxVanPrint, page);
      vec2 onPanel = step(vec2(0.), uv) * step(uv, vec2(1.));
      diffuseColor.rgb = mix(diffuseColor.rgb, print.rgb, print.a * vMxVanFinish.z * onPanel.x * onPanel.y);
    }`,
      'fragment',
    );
    injectAfter(s, 'roughnessmap_fragment', 'roughnessFactor = vMxVanFinish.x;', 'fragment');
    injectAfter(s, 'metalnessmap_fragment', 'metalnessFactor = vMxVanFinish.y;', 'fragment');
  });
  return material;
}

type Surface = readonly [colour: number, tint: number, roughness: number, metalness: number];
const PAINT: Surface = [0xf3f2ee, 1, 0.34, 0.24];
const RUBBER: Surface = [0x282a29, 0, 0.89, 0];
const TRIM: Surface = [0x32383a, 0, 0.61, 0.02];
const GLASS: Surface = [0x293e47, 0, 0.15, 0.11];
const ALLOY: Surface = [0xa8acac, 0, 0.36, 0.84];
const LAMP: Surface = [0xd5dbd5, 0, 0.21, 0.48];
const LENS: Surface = [0x879da2, 0, 0.17, 0.32];
const INDICATOR: Surface = [0xc18139, 0, 0.3, 0.26];
const REFLECTOR: Surface = [0x983b2d, 0, 0.24, 0.13];
const STRIPE: Surface = [0xcccabe, 0, 0.43, 0.14];
type Point = readonly [number, number, number];

/** Baked one time per outdoor venue. True wheel wells break up the side
 * silhouette. The glazing follows the rake and each rim is recessed inside
 * a curved rubber shoulder. Coordinates are metres, nose along +Z. */
export function mxTeamVanGeometry(crews: readonly number[] = [0]) {
  const parts: T.BufferGeometry[] = [];
  const put = (source: T.BufferGeometry, finish: Surface, x = 0, y = 0, z = 0) => {
    source.translate(x, y, z);
    const g = source.index ? source.toNonIndexed() : source;
    if (source !== g) source.dispose();
    g.deleteAttribute('uv');
    const count = g.getAttribute('position').count,
      colour = new T.Color(finish[0]);
    const colours = new Uint8Array(count * 3),
      finishes = new Uint8Array(count * 3);
    const rgb = [colour.r, colour.g, colour.b].map((n) => Math.round(n * 255));
    const spec = finish.slice(1).map((n) => Math.round(n * 255));
    for (let i = 0; i < count; i++) {
      colours.set(rgb, i * 3);
      finishes.set(spec, i * 3);
    }
    g.setAttribute('color', new T.BufferAttribute(colours, 3, true));
    g.setAttribute('mxFinish', new T.BufferAttribute(finishes, 3, true));
    parts.push(g);
  };
  const box = (w: number, h: number, d: number, f: Surface, x: number, y: number, z: number) =>
    put(new T.BoxGeometry(w, h, d), f, x, y, z);
  const quad = (
    points: readonly [Point, Point, Point, Point],
    surface: Surface,
    outward: Point,
  ) => {
    const g = new T.BufferGeometry();
    const vertices = points.map((p) => new T.Vector3(...p));
    const normal = new T.Triangle(vertices[0], vertices[1], vertices[2]).getNormal(new T.Vector3());
    g.setFromPoints(vertices);
    g.setIndex(normal.dot(new T.Vector3(...outward)) > 0 ? [0, 1, 2, 0, 2, 3] : [2, 1, 0, 3, 2, 0]);
    g.computeVertexNormals();
    put(g, surface);
  };
  const sidePanel = (
    side: number,
    yz: readonly [number, number][],
    x: number,
    surface: Surface,
  ) => {
    const point = (i: number): Point => [side * x, yz[i][0], yz[i][1]];
    quad([point(0), point(1), point(2), point(3)], surface, [side, 0, 0]);
  };
  const shell = new T.Shape();
  shell.moveTo(-2.58, 0.41);
  shell.lineTo(-2.11, 0.41);
  shell.absarc(-1.7, 0.41, 0.41, Math.PI, 0, true);
  shell.lineTo(1.25, 0.41);
  shell.absarc(1.66, 0.41, 0.41, Math.PI, 0, true);
  shell.lineTo(2.57, 0.41);
  shell.quadraticCurveTo(2.66, 0.46, 2.63, 0.85);
  shell.lineTo(2.54, 1.07);
  shell.lineTo(1.85, 1.43);
  shell.lineTo(1.01, 2.3);
  shell.quadraticCurveTo(0.91, 2.41, 0.7, 2.42);
  shell.lineTo(-2.41, 2.42);
  shell.quadraticCurveTo(-2.59, 2.4, -2.59, 2.24);
  shell.closePath();
  const bodyBevel = 0.033;
  put(
    new T.ExtrudeGeometry(shell, {
      depth: 1.83,
      steps: 1,
      curveSegments: 8,
      bevelEnabled: true,
      bevelThickness: 0.052,
      bevelSize: bodyBevel,
      bevelSegments: 2,
    })
      .translate(0, 0, -0.915)
      .rotateY(-Math.PI / 2),
    PAINT,
  );
  // Windshield on the angled cowl. Its black ceramic border remains visible.
  const wind = (z: number, y: number, w: number) => [
    new T.Vector3(-w, y, z),
    new T.Vector3(w, y, z),
  ];
  const glazing = (w: number, inset: number, surface: Surface, standOff: number) => {
    const bottom = wind(1.845 - inset + standOff, 1.484 + inset, w),
      top = wind(1.048 + inset + standOff, 2.309 - inset, w - 0.09);
    const p = [bottom[0], bottom[1], top[1], top[0]].map(
      (v) => v.toArray() as [number, number, number],
    );
    quad([p[0], p[1], p[2], p[3]], surface, [0, 1, 1]);
  };
  glazing(0.885, 0, TRIM, 0.006);
  glazing(0.854, 0.035, GLASS, 0.015);
  // Two parked wipers follow the same raked plane as the windscreen.
  const glassPoint = (x: number, y: number, gap: number): Point => [
    x,
    y,
    1.845 - (y - 1.484) * (0.797 / 0.825) + gap,
  ];
  for (const x of [-0.39, 0.36]) {
    quad(
      [
        glassPoint(x - 0.18, 1.49, 0.028),
        glassPoint(x - 0.15, 1.49, 0.028),
        glassPoint(x + 0.09, 1.565, 0.028),
        glassPoint(x + 0.064, 1.57, 0.028),
      ],
      TRIM,
      [0, 1, 1],
    );
    quad(
      [
        glassPoint(x - 0.29, 1.539, 0.036),
        glassPoint(x + 0.36, 1.598, 0.036),
        glassPoint(x + 0.36, 1.616, 0.036),
        glassPoint(x - 0.29, 1.556, 0.036),
      ],
      RUBBER,
      [0, 1, 1],
    );
  }
  box(1.97, 0.17, 0.16, TRIM, 0, 0.47, 2.59);
  box(1.94, 0.15, 0.14, TRIM, 0, 0.46, -2.63);
  box(1.32, 0.23, 0.055, TRIM, 0, 0.77, 2.65);
  for (const y of [0.72, 0.79, 0.86]) box(1.24, 0.018, 0.023, ALLOY, 0, y, 2.685);
  box(0.47, 0.095, 0.018, STRIPE, 0, 0.505, 2.684);
  box(0.014, 1.63, 0.025, TRIM, 0, 1.445, -2.619);
  box(0.16, 0.038, 0.032, TRIM, 0.105, 1.15, -2.622);
  for (const side of [-1, 1]) {
    // Trim and window insert stay inside the pressed door perimeter.
    sidePanel(
      side,
      [
        [1.42, 0.43],
        [1.42, 1.81],
        [2.28, 1.0],
        [2.28, 0.43],
      ],
      0.971,
      TRIM,
    );
    sidePanel(
      side,
      [
        [1.47, 0.48],
        [1.47, 1.71],
        [2.22, 0.98],
        [2.22, 0.48],
      ],
      0.975,
      GLASS,
    );
    sidePanel(
      side,
      [
        [1.64, -2.48],
        [1.45, -1.2],
        [1.79, -0.45],
        [1.71, -1.53],
      ],
      0.969,
      STRIPE,
    );
    sidePanel(
      side,
      [
        [1.57, -2.48],
        [1.42, -1.2],
        [1.65, -0.62],
        [1.53, -1.47],
      ],
      0.97,
      TRIM,
    );
    box(0.018, 0.034, 1.83, TRIM, side * 0.967, 1.33, -1.3);
    box(0.025, 0.047, 0.15, TRIM, side * 0.975, 1.32, 0.61);
    box(0.025, 0.05, 0.12, TRIM, side * 0.976, 1.31, 0.28);
    box(0.018, 1.63, 0.014, TRIM, side * 0.968, 1.35, 0.422);
    box(0.018, 0.52, 0.015, TRIM, side * 0.968, 1.46, -1.36);
    box(0.034, 0.083, 2.47, TRIM, side * 0.964, 0.52, -0.02);
    box(0.115, 0.032, 0.052, TRIM, side * 1.006, 1.47, 1.48);
    box(0.085, 0.126, 0.186, TRIM, side * 1.067, 1.49, 1.47);
    box(0.016, 0.102, 0.139, GLASS, side * 1.105, 1.49, 1.47);
    // Extrusion offsets each nose segment along its normal. The crease in
    // the bevelled body is above the original 1.07 m profile vertex.
    const lowerSlope = 0.09 / 0.22, upperSlope = 0.69 / 0.36;
    const lowerOffset = bodyBevel * Math.hypot(1, lowerSlope);
    const upperOffset = bodyBevel * Math.hypot(1, upperSlope);
    const creaseY = 1.07 + (upperOffset - lowerOffset) / (upperSlope - lowerSlope);
    const lampPoint = (x: number, y: number, gap: number): Point => [
      side * x,
      y,
      2.54 + Math.min((1.07 - y) * lowerSlope + lowerOffset, (1.07 - y) * upperSlope + upperOffset) + gap,
    ];
    const lampBand = (
      lo: number,
      hi: number,
      y0: number,
      y1: number,
      gap: number,
      surface: Surface,
    ) => {
      quad(
        [
          lampPoint(lo, y0, gap),
          lampPoint(hi, y0, gap),
          lampPoint(hi, y1, gap),
          lampPoint(lo, y1, gap),
        ],
        surface,
        [0, 1, 1],
      );
    };
    lampBand(0.48, 0.89, 0.926, creaseY, 0.003, TRIM);
    lampBand(0.48, 0.89, creaseY, 1.12, 0.003, TRIM);
    lampBand(0.502, 0.864, 0.946, creaseY, 0.006, LENS);
    lampBand(0.502, 0.864, creaseY, 1.105, 0.006, LENS);
    lampBand(0.519, 0.779, 0.971, 1.037, 0.008, LAMP);
    lampBand(0.794, 0.85, 0.971, 1.037, 0.008, INDICATOR);
    box(0.102, 0.33, 0.049, REFLECTOR, side * 0.842, 1.09, -2.636);
    box(0.084, 0.065, 0.013, INDICATOR, side * 0.842, 1.09, -2.664);
    box(0.084, 0.047, 0.013, LENS, side * 0.842, 0.985, -2.664);
    for (const z of [-1.7, 1.66]) {
      put(mxServiceTyre(), RUBBER, side * 0.896, 0.355, z);
      put(mxServiceWheelDish(side), ALLOY, side * 0.896, 0.355, z);
      put(mxServiceWheelLip(side), ALLOY, side * 0.896, 0.355, z);
      const drum = new T.CylinderGeometry(.158, .158, .018, 20).rotateZ(Math.PI / 2);
      put(drum, TRIM, side * .915, .355, z);
      for (let k = 0; k < 5; k++) {
        const angle = (2 * Math.PI * k) / 5 + .22;
        const nut = new T.CylinderGeometry(.010, .011, .012, 6).rotateZ(Math.PI / 2);
        put(nut, ALLOY, side * .978, .355 + .081 * Math.sin(angle), z + .081 * Math.cos(angle));
      }
      put(
        new T.CylinderGeometry(0.072, 0.08, 0.023, 12).rotateZ(Math.PI / 2),
        ALLOY,
        side * 0.999,
        0.355,
        z,
      );
    }
  }
  const mesh = mergeGeometries(parts, false)!;
  for (const g of parts) g.dispose();
  mesh.setAttribute('mxVanCrew', new T.InstancedBufferAttribute(new Float32Array(crews), 1));
  mesh.name = 'Formed high-roof MX service van';
  mesh.computeBoundingBox();
  mesh.computeBoundingSphere();
  return mesh;
}
