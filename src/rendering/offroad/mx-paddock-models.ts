import * as T from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { chainShaderHook, injectAfter, injectDeclarations } from '../studio/shader-hooks.ts';

/** The van is one instanced draw. Only its painted panels take the instance
 * colour. Glass, rubber, reflectors and alloy keep their own optical finish. */
export function mxTeamVanMaterial() {
  const material = new T.MeshStandardMaterial({ name: 'MX team vans', vertexColors: true });
  chainShaderHook(material, 'mx-service-van-finish-v1', (s) => {
    injectDeclarations(
      s,
      'common',
      'attribute vec3 mxFinish; varying vec2 vMxVanFinish;',
      'vertex',
    );
    injectDeclarations(s, 'common', 'varying vec2 vMxVanFinish;', 'fragment');
    injectAfter(
      s,
      'color_vertex',
      `vMxVanFinish = mxFinish.yz;
      #ifdef USE_INSTANCING_COLOR
        vColor.rgb = color.rgb * mix(vec3(1.0), instanceColor.rgb, mxFinish.x);
      #endif`,
      'vertex',
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
const REFLECTOR: Surface = [0x983b2d, 0, 0.24, 0.13];
const STRIPE: Surface = [0xcccabe, 0, 0.43, 0.14];
type Point = readonly [number, number, number];

/** Baked one time per outdoor venue. True wheel wells break up the side
 * silhouette. The glazing follows the rake and each rim is recessed inside
 * a curved rubber shoulder. Coordinates are metres, nose along +Z. */
export function mxTeamVanGeometry() {
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
  put(
    new T.ExtrudeGeometry(shell, {
      depth: 1.83,
      steps: 1,
      curveSegments: 8,
      bevelEnabled: true,
      bevelThickness: 0.052,
      bevelSize: 0.033,
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
  box(1.97, 0.17, 0.16, TRIM, 0, 0.47, 2.59);
  box(1.94, 0.15, 0.14, TRIM, 0, 0.46, -2.63);
  box(1.32, 0.23, 0.055, TRIM, 0, 0.77, 2.65);
  for (const y of [0.72, 0.79, 0.86]) box(1.24, 0.018, 0.023, ALLOY, 0, y, 2.685);
  box(0.47, 0.095, 0.018, STRIPE, 0, 0.505, 2.684);
  box(0.014, 1.63, 0.025, TRIM, 0, 1.445, -2.619);
  box(0.16, 0.038, 0.032, TRIM, 0.105, 1.15, -2.622);
  const wheelProfile = [
    [0.181, -0.102],
    [0.285, -0.106],
    [0.338, -0.08],
    [0.355, -0.055],
    [0.355, 0.055],
    [0.338, 0.08],
    [0.285, 0.106],
    [0.181, 0.102],
    [0.181, -0.102],
  ].map(([r, y]) => new T.Vector2(r, y));
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
    box(0.215, 0.091, 0.06, LAMP, side * 0.797, 0.967, 2.609);
    box(0.102, 0.33, 0.049, REFLECTOR, side * 0.842, 1.09, -2.636);
    for (const z of [-1.7, 1.66]) {
      put(
        new T.LatheGeometry(wheelProfile, 20).rotateZ(Math.PI / 2),
        RUBBER,
        side * 0.896,
        0.355,
        z,
      );
      const rim = new T.CylinderGeometry(0.19, 0.19, 0.035, 20).rotateZ(Math.PI / 2);
      put(rim, ALLOY, side * 0.976, 0.355, z);
      for (let k = 0; k < 6; k++) {
        const a = (k * Math.PI) / 3;
        put(
          new T.CircleGeometry(0.029, 7).rotateY((side * Math.PI) / 2),
          TRIM,
          side * 0.995,
          0.355 + Math.cos(a) * 0.122,
          z + Math.sin(a) * 0.122,
        );
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
  mesh.name = 'Formed high-roof MX service van';
  mesh.computeBoundingBox();
  mesh.computeBoundingSphere();
  return mesh;
}
