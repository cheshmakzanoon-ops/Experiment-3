import { MX_WIPER_Y } from './mx-fork-surface.ts';
import * as T from 'three';
import { TessellateModifier } from 'three/addons/modifiers/TessellateModifier.js';
import { bikeSurfaceMaps } from '../bike-surface-detail.ts';
import { canvasTexture } from '../geometry.ts';
import type { RiderColours, RiderDetail } from '../rider.ts';
import { chainShaderHook, injectAfter, injectDeclarations } from '../studio/shader-hooks.ts';
import { sampleProfile } from '../profile-sampling.ts';

type FenderStation = readonly [z: number, y: number, halfWidth: number, crown: number];
const FRONT_FENDER: readonly FenderStation[] = [
  [-0.26, -0.086, 0.052, 0.008],
  [-0.2, -0.064, 0.068, 0.019],
  [-0.08, -0.05, 0.094, 0.027],
  [0.06, -0.049, 0.101, 0.031],
  [0.2, -0.073, 0.098, 0.028],
  [0.34, -0.116, 0.086, 0.019],
  [0.45, -0.157, 0.067, 0.009],
  [0.48, -0.161, 0.044, 0.005],
];
const REAR_FENDER: readonly FenderStation[] = [
  [-1.08, 0.143, 0.059, 0.007],
  [-1.025, 0.129, 0.088, 0.017],
  [-0.91, 0.088, 0.102, 0.025],
  [-0.76, 0.046, 0.109, 0.024],
  [-0.68, 0.036, 0.105, 0.017],
];

/** Offset the inner skin along the sampled outside normal. A vertical or
 * radial subtraction would thin the wall wherever a moulding bends. This
 * temporary calculation runs only while constructing an LOD. */
function offsetInnerSkin(
  positions: number[],
  indices: number[],
  stride: number,
  outsideIndexCount: number,
  thickness: number,
) {
  const outer = new T.BufferGeometry();
  outer.setAttribute('position', new T.Float32BufferAttribute(positions.slice(0, stride * 3), 3));
  outer.setIndex(indices.slice(0, outsideIndexCount));
  outer.computeVertexNormals();
  const normal = outer.getAttribute('normal');
  for (let i = 0; i < stride; i++) {
    positions[(i + stride) * 3] = positions[i * 3] - normal.getX(i) * thickness;
    positions[(i + stride) * 3 + 1] = positions[i * 3 + 1] - normal.getY(i) * thickness;
    positions[(i + stride) * 3 + 2] = positions[i * 3 + 2] - normal.getZ(i) * thickness;
  }
  outer.dispose();
}

/** Closed injection-moulded shell, with a constant 3.5 mm wall instead of a
 * solid oval loft. The centre crown, paired relief channels and returned lip
 * describe large continuous surfaces that remain readable from a chase view.
 * Both skins share the same parameterisation, so the underside is recessed
 * by the actual wall thickness and never crosses the visible upper surface. */
export function motocrossFender(front: boolean, detail: RiderDetail, lightFrame = false) {
  const stations = front ? FRONT_FENDER : REAR_FENDER,
    zs = stations.map((s) => s[0]),
    ys = stations.map((s) => s[1]),
    widths = stations.map((s) => s[2]),
    crowns = stations.map((s) => s[3]),
    rows = detail === 'high' ? (front ? 28 : 18) : detail === 'mid' ? (front ? 16 : 12) : 8,
    columns = detail === 'high' ? 16 : detail === 'mid' ? 12 : 8,
    stride = (rows + 1) * (columns + 1),
    positions: number[] = [],
    uvs: number[] = [],
    indices: number[] = [];
  for (const underside of [false, true])
    for (let row = 0; row <= rows; row++) {
      const t = row / rows,
        z = T.MathUtils.lerp(zs[0], zs[zs.length - 1], t),
        y = sampleProfile(zs, ys, z),
        width = sampleProfile(zs, widths, z),
        crown = sampleProfile(zs, crowns, z),
        ends = Math.sin(t * Math.PI) ** 0.7,
        free = front ? T.MathUtils.smoothstep(z, 0.06, 0.47)
          : 1 - T.MathUtils.smoothstep(z, -1.06, -0.78),
        taper = lightFrame ? 1 - 0.16 * free : 1;
      for (let column = 0; column <= columns; column++) {
        const u = (column / columns) * 2 - 1,
          side = Math.abs(u),
          ridge = 0.006 * Math.exp(-((u / 0.22) ** 2)),
          channel = 0.007 * Math.exp(-(((side - 0.5) / 0.14) ** 2)),
          lip = 0.007 * T.MathUtils.smoothstep(side, 0.77, 1),
          height = crown * (1 - u * u) ** 1.15 + (ridge - channel - lip) * ends;
        // The 250 uses a light blade with a waisted tip and folded outer
        // shoulders; the 450 retains the broad crowned guard. Mounting lands
        // keep their dimensions at the clamp and under the back of the saddle.
        const crease = lightFrame ? free * (0.012 * (1 - side) ** 2 - 0.007 * side ** 3) : 0;
        positions.push(u * width * taper, y + height + crease, z);
        uvs.push(column / columns, t);
        if (row < rows && column < columns) {
          const a = (underside ? stride : 0) + row * (columns + 1) + column,
            b = a + columns + 1;
          if (underside) indices.push(a, a + 1, b, a + 1, b + 1, b);
          else indices.push(a, b, a + 1, a + 1, b, b + 1);
        }
      }
    }
  offsetInnerSkin(positions, indices, stride, rows * columns * 6, 0.0035);
  // Join the complete perimeter. Separate edge normals preserve a thin,
  // deliberate return instead of smoothing the upper crown around the lip.
  const rim = (a: number, b: number) => {
    const base = positions.length / 3;
    for (const index of [a, b, a + stride, b + stride]) {
      positions.push(...positions.slice(index * 3, index * 3 + 3));
      uvs.push(...uvs.slice(index * 2, index * 2 + 2));
    }
    indices.push(base, base + 1, base + 2, base + 1, base + 3, base + 2);
  };
  for (let column = 0; column < columns; column++) {
    rim(column, column + 1);
    rim(rows * (columns + 1) + column + 1, rows * (columns + 1) + column);
  }
  for (let row = 0; row < rows; row++) {
    rim((row + 1) * (columns + 1), row * (columns + 1));
    rim(row * (columns + 1) + columns, (row + 1) * (columns + 1) + columns);
  }
  const geometry = new T.BufferGeometry();
  geometry.setAttribute('position', new T.Float32BufferAttribute(positions, 3));
  geometry.setAttribute('uv', new T.Float32BufferAttribute(uvs, 2));
  geometry.setIndex(indices);
  geometry.computeVertexNormals();
  geometry.computeBoundingBox();
  geometry.computeBoundingSphere();
  return geometry;
}

/** A thin C-section follows each sliding lower fork. Its open rear and
 * scalloped upper edge leave the stanchion visible. The minimum inner radius
 * exceeds the 30 mm outer tube even at full fork compression; no scaling or
 * extra animation is needed because the shell uses the actual lower group. */
export function motocrossForkGuard(detail: RiderDetail) {
  const rows = detail === 'high' ? 10 : detail === 'mid' ? 6 : 2,
    columns = detail === 'high' ? 20 : detail === 'mid' ? 12 : 6,
    stride = (rows + 1) * (columns + 1),
    positions: number[] = [],
    uvs: number[] = [],
    indices: number[] = [];
  for (const inside of [false, true])
    for (let row = 0; row <= rows; row++)
      for (let column = 0; column <= columns; column++) {
        const t = row / rows,
          u = (column / columns) * 2 - 1,
          angle = u * 2.06,
          radius = 0.036 + 0.005 * Math.sin(t * Math.PI) ** 2,
          bottom = 0.044 + 0.013 * Math.abs(Math.sin(angle)),
          top = 0.376 - 0.031 * u * u;
        positions.push(
          Math.sin(angle) * radius,
          T.MathUtils.lerp(bottom, top, t),
          Math.cos(angle) * radius * (1.13 - 0.06 * t),
        );
        uvs.push(column / columns, t);
        if (row < rows && column < columns) {
          const a = (inside ? stride : 0) + row * (columns + 1) + column,
            b = a + columns + 1;
          if (inside) indices.push(a, b, a + 1, a + 1, b, b + 1);
          else indices.push(a, a + 1, b, a + 1, b + 1, b);
        }
      }
  offsetInnerSkin(positions, indices, stride, rows * columns * 6, 0.003);
  const edge = (a: number, b: number) => indices.push(a, a + stride, b, b, a + stride, b + stride);
  for (let column = 0; column < columns; column++) {
    edge(column, column + 1);
    edge(rows * (columns + 1) + column + 1, rows * (columns + 1) + column);
  }
  for (let row = 0; row < rows; row++) {
    edge((row + 1) * (columns + 1), row * (columns + 1));
    edge(row * (columns + 1) + columns, (row + 1) * (columns + 1) + columns);
  }
  const geometry = new T.BufferGeometry();
  geometry.setAttribute('position', new T.Float32BufferAttribute(positions, 3));
  geometry.setAttribute('uv', new T.Float32BufferAttribute(uvs, 2));
  geometry.setIndex(indices);
  geometry.computeVertexNormals();
  geometry.computeBoundingBox();
  geometry.computeBoundingSphere();
  return geometry;
}

/** Inverted off-road fork. The sliding 48 mm leg enters a hollow wiper at
 * the flared foot of the anodised casting. The top cap remains on the crown. */
export function motocrossForkOuter(detail: RiderDetail) {
  const segments = detail === 'high' ? 18 : detail === 'mid' ? 12 : 8;
  // The bore clears the round stanchion even at the middle of a polygon edge.
  const bore = 0.0242 / Math.cos(Math.PI / segments);
  const turn = (profile: ReadonlyArray<readonly [number, number]>) =>
    new T.LatheGeometry(profile.map(([r, y]) => new T.Vector2(r, y)), segments);
  const tube = turn([
    [bore, -0.36], [bore, -0.38], [0.031, -0.38],
    [0.032, -0.374], [0.032, -0.35], [0.028, -0.319],
    [0.0275, -0.204], [0.03, -0.069], [0.03, 0.216], [0.0285, 0.22],
  ]);
  const wiper = turn([
    [bore, -0.378], [bore, MX_WIPER_Y], [0.028, -0.386], [0.0306, -0.38],
  ]);
  return { tube, wiper };
}

/** One continuous cast triple clamp surrounds both fork tubes and the stem.
 * Open bores preserve the real fork interfaces in underside/onboard views. */
export function motocrossTripleClamp(detail: RiderDetail, thickness: number, offset: number) {
  const shape = new T.Shape();
  shape.moveTo(-0.095, offset + 0.041);
  shape.quadraticCurveTo(-0.066, offset + 0.041, -0.05, offset + 0.011);
  shape.lineTo(0.05, offset + 0.011);
  shape.quadraticCurveTo(0.066, offset + 0.041, 0.095, offset + 0.041);
  shape.absarc(0.095, offset, 0.041, Math.PI / 2, -Math.PI / 2, true);
  shape.quadraticCurveTo(0.066, offset - 0.041, 0.049, -0.035);
  shape.lineTo(-0.049, -0.035);
  shape.quadraticCurveTo(-0.066, offset - 0.041, -0.095, offset - 0.041);
  shape.absarc(-0.095, offset, 0.041, -Math.PI / 2, -Math.PI * 1.5, true);
  shape.closePath();
  for (const [x, z, radius] of [
    [-0.095, offset, 0.033],
    [0.095, offset, 0.033],
    [0, 0, 0.012],
  ]) {
    const hole = new T.Path();
    hole.absarc(x, z, radius, 0, Math.PI * 2, true);
    shape.holes.push(hole);
  }
  const geometry = new T.ExtrudeGeometry(shape, {
    depth: thickness,
    steps: 1,
    bevelEnabled: true,
    bevelSize: 0.001,
    bevelThickness: 0.001,
    bevelSegments: 1,
    curveSegments: detail === 'high' ? 8 : 5,
  });
  geometry.translate(0, 0, -thickness / 2);
  geometry.rotateX(Math.PI / 2);
  geometry.computeBoundingBox();
  geometry.computeBoundingSphere();
  return geometry;
}

/** Mould texture, riding scuffs and boot wear in metres. The same physical
 * grain survives the very different fender, number-board and shroud UV
 * layouts. Derivative filtering removes unresolved grain instead of making it
 * sparkle. Positions are the part's own frame: for the batched sprung meshes
 * that is the sprung frame (+z forward, origin at the tank), so the wear zones
 * sit where a rider's boots and knees really rub the shrouds, side panels and
 * tank, with thin whitened scratches running fore and aft. No extra textures,
 * geometry or draws are allocated by this finish. */
export function installMotocrossPlasticFinish(material: T.MeshPhysicalMaterial) {
  chainShaderHook(material, 'motocross-moulded-polymer-v2', (shader) => {
    injectDeclarations(shader, 'common', 'varying vec3 vMxPlasticPosition;', 'vertex');
    injectAfter(shader, 'begin_vertex', 'vMxPlasticPosition = position;', 'vertex');
    injectDeclarations(
      shader,
      'common',
      `
varying vec3 vMxPlasticPosition;
float mxPlasticHeight, mxPlasticScuff, mxPlasticWear;
float mxPlasticNoise(vec3 p) {
  vec3 i=floor(p), f=fract(p); f=f*f*(3.-2.*f);
  vec4 a=fract(sin(vec4(dot(i,vec3(127.1,311.7,74.7)),
    dot(i+vec3(1,0,0),vec3(127.1,311.7,74.7)),
    dot(i+vec3(0,1,0),vec3(127.1,311.7,74.7)),
    dot(i+vec3(1,1,0),vec3(127.1,311.7,74.7))))*43758.5453);
  vec4 b=fract(sin(vec4(dot(i+vec3(0,0,1),vec3(127.1,311.7,74.7)),
    dot(i+vec3(1,0,1),vec3(127.1,311.7,74.7)),
    dot(i+vec3(0,1,1),vec3(127.1,311.7,74.7)),
    dot(i+vec3(1,1,1),vec3(127.1,311.7,74.7))))*43758.5453);
  return mix(mix(mix(a.x,a.y,f.x),mix(a.z,a.w,f.x),f.y),
    mix(mix(b.x,b.y,f.x),mix(b.z,b.w,f.x),f.y),f.z);
}`,
      'fragment',
    );
    injectAfter(
      shader,
      'color_fragment',
      `
{
  vec3 q=vMxPlasticPosition;
  float footprint=length(fwidth(q));
  float fine=1.-smoothstep(.0008,.0035,footprint);
  float grain=mxPlasticNoise(q*850.);
  float scuff=mxPlasticNoise(q*vec3(330.,92.,21.));
  mxPlasticScuff=smoothstep(.66,.87,scuff)*(1.-smoothstep(.004,.019,footprint));
  // Where a boot or knee rides the shroud and side panel: a band either side
  // of the tank, from the seat's front to the radiator, between peg and knee.
  float side=abs(q.x);
  float boot=smoothstep(.08,.15,side)*(1.-smoothstep(.27,.36,side))
    *smoothstep(-.3,-.12,q.y)*(1.-smoothstep(.02,.14,q.y))
    *smoothstep(-.5,-.3,q.z)*(1.-smoothstep(.08,.3,q.z));
  // Abrasion clouds (matte, paler) and fore-aft scratch lines stretched along
  // the boot's sliding direction; a few random hairlines everywhere else.
  float cloud=smoothstep(.38,.8,mxPlasticNoise(q*vec3(16.,11.,7.)+3.1));
  float line=mxPlasticNoise(q*vec3(520.,260.,17.)+7.7);
  float hair=mxPlasticNoise(q*vec3(41.,310.,380.)+1.9);
  float scratch=smoothstep(.8,.92,line)*(.16+.84*boot)
    +smoothstep(.93,.985,hair)*.35;
  float resolved=1.-smoothstep(.003,.012,footprint);
  // Larger than a pixel at the chase camera: the scuffed boot zone reads as a
  // pale, dull patch, not only as hairlines that vanish beyond a metre.
  mxPlasticWear=(boot*cloud*.9)*(1.-smoothstep(.04,.2,footprint))+scratch*resolved;
  mxPlasticHeight=(grain-.5)*.000018*fine-mxPlasticScuff*.000018-scratch*resolved*.000045;
  // Polymer in service is never showroom-saturated: a little of its own
  // luminance comes back, then the whitened stress marks on top.
  float luma=dot(diffuseColor.rgb,vec3(.2126,.7152,.0722));
  float mottle=mxPlasticNoise(q*vec3(9.,7.,8.)+5.3);
  diffuseColor.rgb=mix(vec3(luma),diffuseColor.rgb,.9)*(.95+.1*mottle);
  diffuseColor.rgb*=1.+(grain-.5)*.022*fine;
  diffuseColor.rgb=mix(diffuseColor.rgb,diffuseColor.rgb*.55+vec3(.2,.195,.185),clamp(mxPlasticWear,0.,1.)*.62);
}`,
      'fragment',
    );
    injectAfter(
      shader,
      'roughnessmap_fragment',
      'roughnessFactor = clamp(roughnessFactor + mxPlasticScuff * .17 + mxPlasticWear * .3, .28, .9);',
      'fragment',
    );
    injectAfter(
      shader,
      'normal_fragment_maps',
      `
{
  vec3 dx=dFdx(-vViewPosition),dy=dFdy(-vViewPosition);
  vec3 r1=cross(dy,normal),r2=cross(normal,dx);
  float det=dot(dx,r1);
  vec3 gradient=sign(det)*(dFdx(mxPlasticHeight)*r1+dFdy(mxPlasticHeight)*r2);
  normal=normalize(max(abs(det),1.e-10)*normal-gradient);
}`,
      'fragment',
    );
  });
  return material;
}

/** Textile structure the 64 px weave mips away beyond arm's length: stitched
 * panel seams (double rows of dashes along the cut lines), soft compression
 * creases that gather at the elbow, knee and waist and fade across the open
 * panels, and a slightly glossier stretch band in the creases. `kind` picks
 * the cut: the jersey's side and raglan seams, or a limb's inseam/outseam and
 * the articulated panel joins either side of the joint. Height only (normal
 * perturbation from screen derivatives) plus colour/roughness: no textures,
 * geometry, draws or extra programs beyond the material's own variant. */
export function installMotocrossFabricFinish(
  material: T.MeshStandardMaterial,
  kind: 'jersey' | 'limb',
) {
  chainShaderHook(material, `motocross-textile-${kind}-v1`, (shader) => {
    injectDeclarations(
      shader,
      'common',
      'varying vec3 vMxFabricPosition;\nvarying vec2 vMxFabricUv;',
      'vertex',
    );
    injectAfter(
      shader,
      'begin_vertex',
      '#ifdef USE_MAP\nvMxFabricUv = MAP_UV;\n#else\nvMxFabricUv = vec2(0.0);\n#endif\nvMxFabricPosition = position;',
      'vertex',
    );
    injectDeclarations(
      shader,
      'common',
      `
varying vec3 vMxFabricPosition;
varying vec2 vMxFabricUv;
float mxFabricHeight, mxFabricSeam, mxFabricCrease;
float mxFabricNoise(vec3 p) {
  vec3 i=floor(p), f=fract(p); f=f*f*(3.-2.*f);
  float n=dot(i,vec3(1.,57.,113.));
  vec4 a=fract(sin(vec4(n,n+1.,n+57.,n+58.))*43758.5453);
  vec4 b=fract(sin(vec4(n+113.,n+114.,n+170.,n+171.))*43758.5453);
  return mix(mix(mix(a.x,a.y,f.x),mix(a.z,a.w,f.x),f.y),mix(mix(b.x,b.y,f.x),mix(b.z,b.w,f.x),f.y),f.z);
}
float mxFabricLine(float d, float w) { return 1. - smoothstep(w * .5, w, abs(d)); }`,
      'fragment',
    );
    const cut =
      kind === 'jersey'
        ? `
  // Side seams under the arms (the UV wrap starts at the left side) and a
  // shoulder yoke across the back and chest just below the collar.
  float around = uv.x;
  float seams = max(mxFabricLine(fract(around * 2. + .5) - .5, .02),
    mxFabricLine(uv.y - .9, .016) * .8);
  float joint = exp(-pow((uv.y - .12) / .07, 2.));`
        : `
  // Inseam and outseam, and the articulated panel joins either side of the
  // elbow/knee (the joint sits a little past the middle of the limb).
  float around = uv.x;
  float seams = max(mxFabricLine(fract(around * 2. + .5) - .5, .024),
    max(mxFabricLine(uv.y - .46, .018), mxFabricLine(uv.y - .64, .018)) * .85);
  float joint = exp(-pow((uv.y - .55) / .09, 2.));`;
    injectAfter(
      shader,
      'color_fragment',
      `
{
  vec2 uv = vMxFabricUv;
  vec3 q = vMxFabricPosition;
  float footprint = length(fwidth(q));
  float near = 1. - smoothstep(.004, .02, footprint);
  ${cut}
  // Stitches: two dashed rows hugging each seam, resolved only up close.
  float dash = step(.45, fract(uv.y * 160. + around * 40.));
  float stitch = seams * dash * (1. - smoothstep(.0015, .006, footprint));
  // Compression creases: elongated noise across the limb axis, deep at the
  // joint, a soft drape elsewhere.
  float crease = mxFabricNoise(vec3(q.x * 13., q.y * 34., q.z * 13.))
    * (.4 + .6 * mxFabricNoise(q * 6. + 3.7));
  crease = crease * crease * 1.6;
  mxFabricCrease = crease * (.35 + .65 * joint);
  mxFabricSeam = seams;
  mxFabricHeight = (-.0016 * seams - .0004 * stitch) * near
    + (mxFabricCrease - .3) * .009 * (1. - smoothstep(.03, .12, footprint));
  diffuseColor.rgb *= 1. - .3 * seams * near - .1 * stitch;
  // Creases catch less light in their folds: a soft ambient-occluded band.
  diffuseColor.rgb *= .8 + .26 * (1. - clamp(mxFabricCrease, 0., 1.));
}`,
      'fragment',
    );
    injectAfter(
      shader,
      'roughnessmap_fragment',
      'roughnessFactor = clamp(roughnessFactor - mxFabricCrease * .12 + mxFabricSeam * .05, .35, 1.);',
      'fragment',
    );
    injectAfter(
      shader,
      'normal_fragment_maps',
      `
{
  vec3 dx=dFdx(-vViewPosition),dy=dFdy(-vViewPosition);
  vec3 r1=cross(dy,normal),r2=cross(normal,dx);
  float det=dot(dx,r1);
  vec3 gradient=sign(det)*(dFdx(mxFabricHeight)*r1+dFdy(mxFabricHeight)*r2);
  normal=normalize(max(abs(det),1.e-10)*normal-gradient);
}`,
      'fragment',
    );
  });
  return material;
}

/** Preserve the same graphics layout while matching texel density to each rig. */
export const MX_PRINT_SCALE: Readonly<Record<RiderDetail, number>> = {
  high: 1,
  mid: 0.5,
  far: 0.125,
};

/** Original race graphics authored for MOTObound. */
export function motocrossGraphics(
  colours: RiderColours,
  kind: 'number' | 'jersey' | 'sleeve' | 'pants' | 'helmet',
  number = 2,
  scale = 1,
) {
  const width = kind === 'jersey' ? 1024 : 512;
  const hex = (n: number) => `#${n.toString(16).padStart(6, '0')}`;
  const primary = hex(colours.primary),
    secondary = hex(colours.secondary),
    accent = hex(colours.accent),
    pattern = colours.team?.pattern ?? 'sweep',
    teamName = colours.team?.title ?? 'MOTOBOUND';
  const texture = canvasTexture(width * scale, 512 * scale, (c) => {
    c.scale(scale, scale);
    c.fillStyle = kind === 'number' ? '#eeeae1' : primary;
    c.fillRect(0, 0, width, 512);
    const polygon = (points: number[][], colour: string) => {
      c.fillStyle = colour;
      c.beginPath();
      points.forEach(([x, y], i) => (i ? c.lineTo(x, y) : c.moveTo(x, y)));
      c.closePath();
      c.fill();
    };
    if (kind === 'number') {
      polygon(
        [
          [0, 0],
          [512, 0],
          [512, 83],
          [0, 62],
        ],
        secondary,
      );
      polygon(
        [
          [0, 430],
          [512, 468],
          [512, 512],
          [0, 512],
        ],
        primary,
      );
      c.fillStyle = '#ffffff';
      c.font = '800 29px "Saira Variable", sans-serif';
      c.textAlign = 'center';
      c.fillText(teamName, 256, 48, 380);
      c.fillStyle = '#171a1d';
      c.font = 'italic 950 334px "Saira Variable", sans-serif';
      c.textBaseline = 'middle';
      c.fillText(String(number), 247, 278, 416);
      c.fillStyle = '#ffffff';
      c.font = '700 21px "Saira Variable", sans-serif';
      c.fillText('FACTORY  /  MX', 256, 477, 300);
    } else if (kind === 'jersey') {
      const raceBib = colours.motocrossBib !== undefined;
      const bib = colours.motocrossBib === undefined ? secondary : hex(colours.motocrossBib);
      // Three decodes the fabric swatch from sRGB before measuring luminance.
      // Pale dye takes graphite ink; dark dye takes a warm white race number.
      const dye = new T.Color(bib);
      const printInk = raceBib && 0.2126 * dye.r + 0.7152 * dye.g + 0.0722 * dye.b > 0.18
        ? '#14171b' : '#f0ede6';
      for (const centre of [256, 768]) {
        // The chest and back use the same dyed panel, with a contrasting
        // shoulder yoke that can still be seen above the roost protector.
        if (pattern === 'arrow') {
          polygon(
            [
              [centre - 252, 0],
              [centre + 252, 0],
              [centre + 228, 160],
              [centre + 138, 290],
              [centre + 142, 475],
              [centre - 149, 475],
              [centre - 134, 291],
              [centre - 234, 153],
            ],
            bib,
          );
          for (const d of [-1, 1]) {
            const chevron = (inset: number, ink: string) =>
              polygon(
                [
                  [centre + d * 238, 78 + inset],
                  [centre + d * 149, 163 + inset],
                  [centre + d * 156, 204 + inset],
                  [centre + d * 246, 110 + inset],
                ],
                ink,
              );
            chevron(0, '#e8e6df');
            chevron(47, accent);
          }
        } else if (pattern === 'split') {
          polygon(
            [
              [centre - 211, 0],
              [centre + 238, 0],
              [centre + 162, 201],
              [centre + 139, 512],
              [centre - 116, 512],
              [centre - 117, 286],
            ],
            bib,
          );
          polygon(
            [
              [centre - 159, 0],
              [centre - 128, 0],
              [centre - 75, 110],
              [centre + 186, 109],
              [centre + 178, 131],
              [centre - 95, 132],
            ],
            accent,
          );
          polygon(
            [
              [centre + 164, 269],
              [centre + 202, 196],
              [centre + 191, 423],
              [centre + 131, 490],
            ],
            '#e8e6df',
          );
        } else if (pattern === 'minimal') {
          c.fillStyle = bib;
          c.fillRect(centre - 157, 0, 314, 512);
          c.fillStyle = accent;
          c.fillRect(centre - 166, 0, 5, 512);
          c.fillRect(centre + 161, 0, 5, 512);
        } else {
          polygon(
            [
              [centre - 198, 0],
              [centre - 156, 512],
              [centre + 174, 512],
              [centre + 196, 0],
            ],
            bib,
          );
          polygon(
            [
              [centre - 204, 128],
              [centre - 156, 164],
              [centre - 130, 462],
              [centre - 151, 492],
            ],
            accent,
          );
          polygon(
            [
              [centre + 202, 123],
              [centre + 156, 163],
              [centre + 127, 462],
              [centre + 149, 492],
            ],
            accent,
          );
        }
        if (raceBib) {
          polygon([
            [centre - 250, 0], [centre + 250, 0], [centre + 218, 89],
            [centre + 135, 70], [centre + 79, 45], [centre - 70, 45],
            [centre - 151, 76], [centre - 219, 94],
          ], secondary);
          // The two raglan seams run from the base of the collar to the
          // armholes. The small binding has a continuous silhouette at Mid.
          for (const side of [-1, 1]) {
            polygon([
              [centre + side * 70, 45], [centre + side * 141, 68],
              [centre + side * 218, 83], [centre + side * 214, 92],
              [centre + side * 139, 77],
            ], accent);
          }
        }
      }
      c.textAlign = 'center';
      // The loft wraps U clockwise, so each chest/back panel needs its text
      // mirrored around its own centre to read normally on the outside.
      const print = (text: string, x: number, y: number, width: number, edged = false) => {
        c.save();
        c.translate(x, y);
        c.scale(-1, 1);
        if (edged) {
          c.lineJoin = 'round';
          c.lineWidth = 6;
          c.strokeStyle = printInk === '#14171b' ? '#f0ede6' : '#14171b';
          c.strokeText(text, 0, 0, width);
        }
        c.fillText(text, 0, 0, width);
        c.restore();
      };
      c.fillStyle = printInk;
      c.font = '800 42px "Saira Variable", sans-serif';
      print(teamName, 256, 206, 292);
      c.font = '700 23px "Saira Variable", sans-serif';
      print('OFFROAD RACING', 256, 244, 246);
      // The neck brace descends over the centre of the shoulder blades and
      // the kidney belt rises around the waist. Keep the whole number in
      // the exposed cloth between them, including when the rider braces.
      if (raceBib) c.font = '800 33px "Saira Variable", sans-serif';
      print(raceBib ? teamName : 'FACTORY RIDER', 768, raceBib ? 164 : 121, 270);
      c.font = `italic 950 ${raceBib ? 196 : 225}px "Saira Variable", sans-serif`;
      print(String(number), 758, raceBib ? 326 : 359, 274, raceBib);
      c.font = '800 24px "Saira Variable", sans-serif';
      print(raceBib ? 'MOTOBOUND' : teamName, 768, raceBib ? 441 : 405, 270);
      c.fillStyle = accent;
      c.fillRect(166, 273, 180, 6);
      c.fillRect(674, raceBib ? 458 : 425, 188, 6);
    } else if (kind === 'pants') {
      // The garment runs from the boot cuff at the top of the atlas to the
      // hip at the bottom. The heat shield is on the inboard face (-X in the
      // left leg), while the outboard thigh carries the printed team panel.
      c.fillStyle = '#373b3c';
      c.fillRect(0, 0, 512, 512);
      polygon(
        [
          [0, 0],
          [512, 0],
          [512, 109],
          [377, 158],
          [218, 162],
          [72, 118],
          [0, 103],
        ],
        '#272c2f',
      );
      for (const x of [0, 512]) {
        const draw = (points: number[][], colour: string) =>
          polygon(
            points.map(([u, v]) => [x + u, v]),
            colour,
          );
        draw(
          [
            [-115, 509],
            [-107, 366],
            [-77, 247],
            [-52, 196],
            [8, 206],
            [84, 285],
            [123, 488],
            [118, 512],
          ],
          secondary,
        );
        draw(
          [
            [-96, 512],
            [-88, 397],
            [-46, 308],
            [-38, 349],
            [22, 421],
            [75, 512],
          ],
          primary,
        );
        draw(
          [
            [-95, 365],
            [-74, 299],
            [-46, 252],
            [-13, 239],
            [31, 264],
            [-18, 260],
            [-55, 306],
          ],
          accent,
        );
        draw(
          [
            [-79, 307],
            [-56, 250],
            [-29, 225],
            [5, 228],
            [-31, 242],
          ],
          '#d5d3c7',
        );
      }
      // Sewn leather protects the face of the knee that grips the shroud.
      // Sparse twin-needle seams and the pleated kneecap survive mipmapping.
      const shield = [
        [192, 184],
        [240, 164],
        [291, 176],
        [323, 220],
        [311, 296],
        [273, 339],
        [213, 324],
        [181, 272],
      ];
      polygon(shield, '#25292a');
      c.lineJoin = 'round';
      c.strokeStyle = '#696b63';
      c.lineWidth = 2;
      c.setLineDash([3, 3]);
      c.stroke();
      c.setLineDash([]);
      for (let i = 0; i < 6; i++) {
        const y = 166 + i * 9;
        c.strokeStyle = i % 2 ? '#545855' : '#60635d';
        c.lineWidth = 3;
        c.beginPath();
        c.moveTo(65, y - 10);
        c.quadraticCurveTo(123, y + 12, 167, y - 3);
        c.stroke();
      }
      polygon(
        [
          [0, 485],
          [96, 474],
          [199, 464],
          [292, 466],
          [403, 473],
          [512, 485],
          [512, 512],
          [0, 512],
        ],
        '#2c3032',
      );
    } else if (kind === 'helmet') {
      // The shell unwraps with the eye port at U=.25 and the back at U=.75.
      // Reflect each side around the port, repeating its outline across the seam.
      const wings = (shape: readonly (readonly [number, number])[], colour: string) => {
        for (const [centre, direction] of [
          [128, 1],
          [128, -1],
          [640, -1],
        ] as const) {
          polygon(
            shape.map(([distance, y]) => [centre + direction * distance, y]),
            colour,
          );
        }
      };
      wings(
        [
          [0, 25],
          [42, 17],
          [151, 77],
          [256, 90],
          [256, 149],
          [172, 136],
          [58, 83],
        ],
        secondary,
      );
      wings(
        [
          [9, 34],
          [49, 34],
          [151, 95],
          [233, 109],
          [154, 102],
          [54, 52],
        ],
        '#eeeae1',
      );
      wings(
        [
          [45, 66],
          [67, 71],
          [171, 121],
          [256, 142],
          [256, 150],
          [161, 130],
        ],
        accent,
      );
      wings(
        [
          [5, 334],
          [72, 307],
          [145, 236],
          [223, 214],
          [256, 220],
          [256, 245],
          [175, 268],
          [94, 349],
          [0, 381],
        ],
        secondary,
      );
      wings(
        [
          [0, 383],
          [93, 358],
          [172, 279],
          [208, 270],
          [180, 290],
          [100, 371],
          [0, 400],
        ],
        '#eeeae1',
      );
      wings(
        [
          [0, 409],
          [102, 379],
          [143, 344],
          [110, 391],
          [0, 428],
        ],
        accent,
      );
      if (pattern === 'arrow') {
        for (const y of [156, 185])
          wings(
            [
              [58, y + 10],
              [117, y + 16],
              [191, y - 12],
              [218, y - 7],
              [125, y + 36],
              [69, y + 31],
            ],
            accent,
          );
      } else if (pattern === 'split') {
        polygon(
          [
            [175, 0],
            [219, 0],
            [293, 91],
            [476, 113],
            [494, 130],
            [281, 109],
          ],
          '#eeeae1',
        );
        polygon(
          [
            [192, 0],
            [205, 0],
            [285, 94],
            [452, 116],
            [284, 102],
          ],
          accent,
        );
      }
      // The beaded lower rim climbs around the nape and carries the kit's
      // edge stripe. The front remains clear for the chin intake and goggles.
      polygon(
        [
          [0, 449],
          [89, 468],
          [128, 486],
          [181, 463],
          [239, 437],
          [304, 426],
          [377, 418],
          [450, 427],
          [512, 449],
          [512, 512],
          [0, 512],
        ],
        secondary,
      );
      polygon(
        [
          [0, 452],
          [82, 468],
          [46, 469],
          [0, 462],
        ],
        accent,
      );
      polygon(
        [
          [245, 442],
          [330, 425],
          [385, 423],
          [459, 432],
          [508, 448],
          [461, 438],
          [383, 431],
          [326, 432],
        ],
        accent,
      );
      // A separate rear race mark stays on the crown above the goggle strap.
      polygon(
        [
          [348, 93],
          [419, 93],
          [410, 133],
          [355, 133],
        ],
        '#ece8df',
      );
      c.fillStyle = '#202328';
      c.textAlign = 'center';
      c.textBaseline = 'middle';
      c.font = 'italic 900 35px "Saira Variable", sans-serif';
      c.fillText(String(number), 383, 114, 54);
    } else {
      polygon(
        [
          [0, 42],
          [512, 252],
          [512, 512],
          [0, 315],
        ],
        secondary,
      );
      polygon(
        [
          [0, 58],
          [512, 268],
          [512, 303],
          [0, 92],
        ],
        accent,
      );
      polygon(
        [
          [0, 364],
          [512, 135],
          [512, 158],
          [0, 393],
        ],
        '#eeeae1',
      );
      if (pattern === 'arrow') {
        for (const y of [268, 341]) {
          polygon(
            [
              [0, y],
              [128, y + 51],
              [256, y],
              [384, y + 51],
              [512, y],
              [512, y + 27],
              [384, y + 78],
              [256, y + 27],
              [128, y + 78],
              [0, y + 27],
            ],
            accent,
          );
        }
      } else if (pattern === 'split') {
        polygon(
          [
            [0, 121],
            [152, 90],
            [268, 168],
            [512, 133],
            [512, 155],
            [258, 199],
            [146, 119],
            [0, 155],
          ],
          '#eeeae1',
        );
      }
      // The wrist lies at the top of the print. A continuous cuff and two
      // forearm panels remain visible from the rider's eye when hands turn.
      c.fillStyle = '#24252a';
      c.fillRect(0, 0, 512, 28);
      c.fillStyle = accent;
      c.fillRect(0, 23, 512, 4);
      for (const centre of [0, 256, 512]) {
        const panel = (points: number[][], colour: string) =>
          polygon(
            points.map(([x, y]) => [centre + x, y]),
            colour,
          );
        panel(
          [
            [-103, 33],
            [-68, 34],
            [16, 104],
            [88, 146],
            [56, 141],
            [-30, 96],
          ],
          secondary,
        );
        panel(
          [
            [-66, 33],
            [-44, 34],
            [26, 92],
            [74, 122],
            [43, 108],
          ],
          '#eeeae1',
        );
        panel(
          [
            [-41, 34],
            [-29, 34],
            [17, 73],
          ],
          accent,
        );
      }
    }
  }, { willReadFrequently: true });
  // These are painted once and resampled by TextureBudget for the race.
  // CPU-backed 2D copies keep the raster work separate from the final texture upload.
  texture.name = `Motocross original ${kind} graphics ${number}`;
  texture.anisotropy = 4;
  return texture;
}

/** Woven textile rather than glossy road-racing leather. Mipmapped linear
 * data maps remain stable under distant cameras and are owned by the rider. */
export function motocrossFabricMaps() {
  const size = 64,
    normal = new Uint8Array(size * size * 4),
    roughness = new Uint8Array(size * size * 4);
  for (let y = 0; y < size; y++)
    for (let x = 0; x < size; x++) {
      const i = (y * size + x) * 4;
      const weave = ((x >> 1) + (y >> 1)) % 2 ? 1 : -1;
      normal.set([128 + weave * 15, 128 + (y % 4 < 2 ? 11 : -11), 254, 255], i);
      const grain = ((Math.imul(x + 11, 73) ^ Math.imul(y + 5, 151)) >>> 0) % 13;
      roughness.set([230 + grain, 230 + grain, 230 + grain, 255], i);
    }
  const texture = (data: Uint8Array, label: string) => {
    const t = new T.DataTexture(data, size, size, T.RGBAFormat);
    t.name = `Motocross woven fabric ${label}`;
    t.colorSpace = T.NoColorSpace;
    t.wrapS = t.wrapT = T.RepeatWrapping;
    t.repeat.set(14, 14);
    t.magFilter = T.LinearFilter;
    t.minFilter = T.LinearMipmapLinearFilter;
    t.generateMipmaps = true;
    t.anisotropy = 4;
    t.needsUpdate = true;
    return t;
  };
  return { normalMap: texture(normal, 'normal'), roughnessMap: texture(roughness, 'roughness') };
}

type EquipmentGrain = 'weave' | 'glove' | 'boot';
const equipmentGrains = new Map<EquipmentGrain, ReturnType<typeof motocrossFabricMaps>>();

/** Every rider owns its two sampler handles. The six unchanging grain images
 * can back all near and middle riders, including several WebGL contexts.
 * Team prints, mud uniforms, UV transforms and disposal stay with the rider. */
export function motocrossEquipmentGrain(part: EquipmentGrain) {
  let grain = equipmentGrains.get(part);
  if (!grain) {
    grain = part === 'weave' ? motocrossFabricMaps() : bikeSurfaceMaps(part === 'glove' ? 'seat' : 'paint');
    equipmentGrains.set(part, grain);
  }
  return { normalMap: grain.normalMap.clone(), roughnessMap: grain.roughnessMap.clone() };
}

/** A closed, softly bevelled moulded panel in XY, with useful planar decal UVs. */
export function mouldedPanel(
  outline: readonly (readonly [number, number])[],
  depth = 0.008,
  bevel = 0.003,
) {
  const shape = new T.Shape(outline.map(([x, y]) => new T.Vector2(x, y)));
  const g = new T.ExtrudeGeometry(shape, {
    depth,
    steps: 1,
    bevelEnabled: bevel > 0,
    bevelThickness: bevel,
    bevelSize: bevel,
    bevelSegments: 2,
    curveSegments: 2,
  });
  g.translate(0, 0, -depth / 2);
  g.computeBoundingBox();
  const box = g.boundingBox!,
    p = g.getAttribute('position'),
    uv = g.getAttribute('uv');
  for (let i = 0; i < p.count; i++)
    uv.setXY(
      i,
      (p.getX(i) - box.min.x) / (box.max.x - box.min.x),
      (p.getY(i) - box.min.y) / (box.max.y - box.min.y),
    );
  return g;
}

/** Side panels use [rear/forward Z, height Y] coordinates. Each exposed face
 * keeps its number readable; normals are transformed with the moulding. */
export function motocrossSidePanel(
  outline: readonly (readonly [number, number])[],
  side: number,
  depth = 0.008,
) {
  const g = mouldedPanel(outline, depth, 0.003);
  if (side > 0) {
    const uv = g.getAttribute('uv');
    for (let i = 0; i < uv.count; i++) uv.setX(i, 1 - uv.getX(i));
  }
  g.rotateY(-Math.PI / 2);
  return g;
}

/** A radiator shroud is an injection-moulded duct, not a flat printed plate.
 * A shallow crown, tucked rear edge and raised upper intake catch a continuous
 * moving highlight. Subdivision precedes bending; normals follow the analytic
 * surface so the existing bevel stays hard without faceting the main panel. */
export function motocrossRadiatorShroud(side: number, detail: RiderDetail) {
  const flat = motocrossSidePanel(
    // The upper edge follows the tank from the seat nose to the steering
    // head; the forward tip reaches toward the fork as a radiator intake.
    [
      [-0.2, 0.13],
      [0.02, 0.192],
      [0.15, 0.258],
      [0.262, 0.258],
      [0.338, 0.128],
      [0.24, -0.022],
      [0.215, -0.265],
      [0.103, -0.299],
      [0.027, -0.128],
      [-0.14, -0.058],
    ],
    side,
  );
  const geometry = new TessellateModifier(
    detail === 'high' ? 0.055 : detail === 'mid' ? 0.09 : 0.18,
    detail === 'far' ? 2 : 4,
  ).modify(flat);
  flat.dispose();
  const position = geometry.getAttribute('position'),
    normal = geometry.getAttribute('normal');
  const crown = (y: number, z: number) => {
    const u = T.MathUtils.clamp((z + 0.2) / 0.538, 0, 1),
      v = T.MathUtils.clamp((y + 0.3) / 0.558, 0, 1);
    return (
      0.03 * Math.sin(u * Math.PI) * Math.sin(v * Math.PI) -
      0.021 * (1 - T.MathUtils.smoothstep(u, 0, 0.38)) +
      0.008 * T.MathUtils.smoothstep(v, 0.42, 0.7) * T.MathUtils.smoothstep(u, 0.35, 0.75) -
      // The shoulder rolls in over the tank instead of ending as a free edge.
      0.062 * T.MathUtils.smoothstep(v, 0.68, 1) * T.MathUtils.smoothstep(u, 0.1, 0.5)
    );
  };
  const n = new T.Vector3(),
    step = 0.0001;
  for (let i = 0; i < position.count; i++) {
    const y = position.getY(i),
      z = position.getZ(i);
    const dy = (crown(y + step, z) - crown(y - step, z)) / (2 * step),
      dz = (crown(y, z + step) - crown(y, z - step)) / (2 * step);
    n.fromBufferAttribute(normal, i);
    n.set(n.x, n.y - side * dy * n.x, n.z - side * dz * n.x).normalize();
    normal.setXYZ(i, n.x, n.y, n.z);
    position.setX(i, position.getX(i) + side * crown(y, z));
  }
  geometry.computeBoundingBox();
  geometry.computeBoundingSphere();
  return geometry;
}

/** True open wave rotor: the ground and spokes remain visible through the
 * cooling holes, unlike a solid disc painted with black dots. Axis is X. */
export function motocrossRotor(
  radius: number,
  detail: RiderDetail,
  sprocket = false,
  carrierRadius = radius,
) {
  const detailCarrier = !sprocket && detail !== 'far';
  const shape = new T.Shape(),
    count = detail === 'high' ? (detailCarrier ? 80 : 120) : detail === 'mid' ? 64 : 32;
  for (let i = 0; i <= count; i++) {
    const a = (i / count) * Math.PI * 2;
    const r = radius * (sprocket ? 0.97 + 0.03 * Math.cos(a * 40) : 0.97 + 0.03 * Math.cos(a * 10));
    if (i === 0) shape.moveTo(Math.cos(a) * r, Math.sin(a) * r);
    else shape.lineTo(Math.cos(a) * r, Math.sin(a) * r);
  }
  const centre = new T.Path();
  centre.absarc(0, 0, carrierRadius * (detail === 'far' ? 0.22 : 0.44), 0, Math.PI * 2, true);
  shape.holes.push(centre);
  if (detailCarrier) {
    // Six swept steel arms join the hub bolts to the pad track. The openings
    // pass through both faces, so spokes remain visible through the carrier.
    const turn = Math.PI / 3;
    const root = carrierRadius * 0.475;
    for (let k = 0; k < 6; k++) {
      // The wheel's mounting bolts start on +Y after the extrusion is turned
      // about Y. A solid arm must lie beneath each bolt.
      const a = Math.PI / 2 + k * turn;
      const window = new T.Path();
      const outline = [
        [0.18, root], [0.25, 0.71 * radius], [0.33, 0.765 * radius],
        [0.68, 0.771 * radius], [0.99, 0.733 * radius],
        [turn - 0.19, root], [0.52, root],
      ];
      for (const [j, [angle, reach]] of outline.entries()) {
        const x = Math.cos(a + angle) * reach, y = Math.sin(a + angle) * reach;
        if (j === 0) window.moveTo(x, y);
        else window.lineTo(x, y);
      }
      window.closePath();
      shape.holes.push(window);
      // Offset cooling slots across the wiped steel band. Opposite pairs
      // have equal mass and sit clear of the scalloped outer edge.
      const slots = detail === 'high' ? 2 : 1;
      for (let j = 0; j < slots; j++) {
        const angle = a + 0.27 + 0.36 * j;
        const r = radius * (0.855 + j * 0.046);
        const hole = new T.Path();
        hole.absellipse(Math.cos(angle) * r, Math.sin(angle) * r,
          radius * 0.028, radius * 0.052, 0, Math.PI * 2, true, angle - 0.24);
        shape.holes.push(hole);
      }
    }
  } else {
    const holes = detail === 'high' ? 12 : detail === 'mid' ? 8 : 5;
    for (let k = 0; k < holes; k++) {
      const a = (k / holes) * Math.PI * 2,
        hole = new T.Path();
      if (detail === 'far') {
        // Five openings leave a visible carrier between the hub and brake track.
        // The large, simple cutouts remain legible across the racing field.
        for (const [index, [angle, reach]] of [
          [a - 0.34, 0.76],
          [a + 0.34, 0.76],
          [a + 0.18, 0.39],
          [a - 0.1, 0.39],
        ].entries()) {
          const x = Math.cos(angle) * radius * reach,
            y = Math.sin(angle) * radius * reach;
          if (index === 0) hole.moveTo(x, y);
          else hole.lineTo(x, y);
        }
        hole.closePath();
      } else
        hole.absarc(
          Math.cos(a) * radius * 0.73,
          Math.sin(a) * radius * 0.73,
          radius * (sprocket ? 0.12 : 0.085),
          0,
          Math.PI * 2,
          true,
        );
      shape.holes.push(hole);
    }
  }
  const g = new T.ExtrudeGeometry(shape, {
    depth: 0.004,
    steps: 1,
    bevelEnabled: false,
    curveSegments: detail === 'high' ? 3 : 2,
  });
  g.translate(0, 0, -0.002);
  g.rotateY(Math.PI / 2);
  if (!sprocket) {
    // Preserve the wheel plane after the rigid parts enter their draw batch.
    const position = g.getAttribute('position'), uv = g.getAttribute('uv');
    for (let i = 0; i < position.count; i++) uv.setXY(i, position.getY(i) / radius, position.getZ(i) / radius);
  }
  return g;
}

/** Staggered centre blocks and angled shoulder lugs. The outer tyre radius is
 * exact: wheel-ground contact does not change when the close detail appears. */
export function motocrossTread(
  radius: number,
  halfWidth: number,
  height: number,
  count: number,
  axle: 'front' | 'rear' = 'rear',
  distant = false,
  carcassSides = 36,
) {
  // Every block in a row has the same manufactured shape. Form and normal
  // that shape once, then rotate it directly into the wheel's final buffers.
  // The tyre is one mesh at every level, including its angular distant lugs.
  const crown = halfWidth * 1.15;
  const core = radius - height - crown;
  // A mesh carcass is an inscribed polygon in both directions. The block
  // roots must pass its lowest facet, even between two circumferential rings.
  const burial = (radius-height) * (1-Math.cos(Math.PI/carcassSides)) + 0.0018;
  const rows = (offsets: number[]) =>
    offsets.map((offset) => {
      const shoulder = Math.abs(offset) > 0.8, front = axle === 'front';
      const width = halfWidth * (shoulder ? 0.5 : front ? 0.46 : 0.74);
      const length = shoulder ? 0.026 : front ? 0.037 : 0.025;
      const g = distant ? new T.BoxGeometry(width, height, length)
        : motocrossLug(width, height, length, front ? -0.11 : 0.15);
      const position = g.getAttribute('position');
      const chevron = shoulder ? Math.sign(offset) * 0.32 : front ? 0.16 : -0.12;
      const shoulderAngle = Math.asin(offset * halfWidth * 0.84 / crown);
      for (let i = 0; i < position.count; i++) {
        // Lay each lug along the same rounded cross-section as the rubber.
        // Its lug walls grow out along that local normal; a tilted box at the
        // crown radius used to leave daylight under the shoulder blocks.
        const localX = position.getX(i);
        const a = shoulderAngle + localX / crown;
        const c = Math.cos(a);
        const depth = position.getY(i) / height + 0.5;
        const lift = height * depth - (1-depth) * burial / c;
        const radial = core + (crown + lift) * c;
        const angle = (position.getZ(i) + localX * chevron) / radius;
        position.setXYZ(i, (crown + lift) * Math.sin(a), radial * Math.cos(angle), radial * Math.sin(angle));
      }
      g.computeVertexNormals();
      return {
        geometry: g,
        position,
        normal: g.getAttribute('normal'),
        uv: g.getAttribute('uv'),
        phase: shoulder ? (Math.PI / count) * 0.28 : 0,
      };
    });
  const even = rows([0, -0.9, 0.9]);
  const odd = rows(distant ? [-0.43, 0.43] : [-0.43, 0.43, -0.94, 0.94]);
  const rings = Math.max(0, Math.ceil(count));
  const blocks = Math.ceil(rings / 2) * even.length + Math.floor(rings / 2) * odd.length;
  const vertices = blocks * even[0].position.count;
  const position = new Float32Array(vertices * 3),
    normal = new Float32Array(vertices * 3),
    uv = new Float32Array(vertices * 2);
  const indices = distant
    ? new (vertices > 65535 ? Uint32Array : Uint16Array)(blocks * even[0].geometry.index!.count)
    : null;
  let cursor = 0,
    indexCursor = 0;
  for (let k = 0; k < rings; k++) {
    const angle = (k / count) * Math.PI * 2;
    for (const row of k % 2 === 0 ? even : odd) {
      const cos = Math.cos(angle + row.phase),
        sin = Math.sin(angle + row.phase);
      uv.set(row.uv.array, cursor * 2);
      if (indices) {
        const local = row.geometry.index!;
        for (let i = 0; i < local.count; i++) indices[indexCursor++] = cursor + local.getX(i);
      }
      for (let i = 0; i < row.position.count; i++, cursor++) {
        const at = cursor * 3,
          y = row.position.getY(i),
          z = row.position.getZ(i);
        position[at] = row.position.getX(i);
        position[at + 1] = cos * y - sin * z;
        position[at + 2] = sin * y + cos * z;
        const ny = row.normal.getY(i),
          nz = row.normal.getZ(i);
        normal[at] = row.normal.getX(i);
        normal[at + 1] = cos * ny - sin * nz;
        normal[at + 2] = sin * ny + cos * nz;
      }
    }
  }
  for (const row of [...even, ...odd]) row.geometry.dispose();
  const result = new T.BufferGeometry();
  result.setAttribute('position', new T.BufferAttribute(position, 3));
  result.setAttribute('normal', new T.BufferAttribute(normal, 3));
  result.setAttribute('uv', new T.BufferAttribute(uv, 2));
  if (indices) result.setIndex(new T.BufferAttribute(indices, 1));
  return result;
}

/** Rounded manufacturing corners and a narrow worn crown on each tread lug.
 * Three chamfered rings keep the polygon cost bounded; no per-lug mesh, texture
 * or rounded-box subdivision is kept after the wheel has been merged. */
function motocrossLug(width: number, height: number, length: number, rake: number) {
  const positions: number[] = [],
    uv: number[] = [],
    indices: number[] = [];
  const corner = 0.17;
  const ring = [
    [-1 + corner, -1],
    [1 - corner, -1],
    [1, -1 + corner],
    [1, 1 - corner],
    [1 - corner, 1],
    [-1 + corner, 1],
    [-1, 1 - corner],
    [-1, -1 + corner],
  ];
  for (const [scale, y] of [
    [1, -height * 0.5],
    [0.88, height * 0.35],
    [0.76, height * 0.5],
  ])
    for (const [x, z] of ring) {
      positions.push((x * width * scale) / 2, y, (z * length * scale) / 2 + length*rake*(y/height+0.5));
      uv.push((x + 1) / 2, (z + 1) / 2);
    }
  for (let row = 0; row < 2; row++)
    for (let i = 0; i < 8; i++) {
      const a = row * 8 + i,
        b = row * 8 + ((i + 1) % 8);
      indices.push(a, a + 8, b, b, a + 8, b + 8);
    }
  // A crown vertex follows the true outer radius even on the centre row.
  // Its opposite face is buried inside the tyre through every LOD.
  positions.push(0, height/2, length*rake);
  uv.push(0.5, 0.5);
  for (let i = 0; i < 8; i++) indices.push(24, 16 + ((i+1)%8), 16 + i);
  const indexed = new T.BufferGeometry();
  indexed.setAttribute('position', new T.Float32BufferAttribute(positions, 3));
  indexed.setAttribute('uv', new T.Float32BufferAttribute(uv, 2));
  indexed.setIndex(indices);
  const geometry = indexed.toNonIndexed();
  indexed.dispose();
  return geometry;
}
