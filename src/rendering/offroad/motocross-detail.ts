import * as T from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { TessellateModifier } from 'three/addons/modifiers/TessellateModifier.js';
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
export function motocrossFender(front: boolean, detail: RiderDetail) {
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
        ends = Math.sin(t * Math.PI) ** 0.7;
      for (let column = 0; column <= columns; column++) {
        const u = (column / columns) * 2 - 1,
          side = Math.abs(u),
          ridge = 0.006 * Math.exp(-((u / 0.22) ** 2)),
          channel = 0.007 * Math.exp(-(((side - 0.5) / 0.14) ** 2)),
          lip = 0.007 * T.MathUtils.smoothstep(side, 0.77, 1),
          height = crown * (1 - u * u) ** 1.15 + (ridge - channel - lip) * ends;
        positions.push(u * width, y + height, z);
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
  const rows = detail === 'high' ? 10 : 6,
    columns = detail === 'high' ? 20 : 12,
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

/** Mould texture and fine riding scuffs in metres. The same physical grain
 * survives the very different fender, number-board and shroud UV layouts.
 * Derivative filtering removes unresolved grain instead of making it sparkle.
 * No extra textures, geometry or draws are allocated by this finish. */
export function installMotocrossPlasticFinish(material: T.MeshPhysicalMaterial) {
  chainShaderHook(material, 'motocross-moulded-polymer-v1', (shader) => {
    injectDeclarations(shader, 'common', 'varying vec3 vMxPlasticPosition;', 'vertex');
    injectAfter(shader, 'begin_vertex', 'vMxPlasticPosition = position;', 'vertex');
    injectDeclarations(
      shader,
      'common',
      `
varying vec3 vMxPlasticPosition;
float mxPlasticHeight, mxPlasticScuff;
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
  float footprint=length(fwidth(vMxPlasticPosition));
  float fine=1.-smoothstep(.0008,.0035,footprint);
  float grain=mxPlasticNoise(vMxPlasticPosition*850.);
  float scuff=mxPlasticNoise(vMxPlasticPosition*vec3(330.,92.,21.));
  mxPlasticScuff=smoothstep(.66,.87,scuff)*(1.-smoothstep(.004,.019,footprint));
  mxPlasticHeight=(grain-.5)*.000018*fine-mxPlasticScuff*.000018;
  diffuseColor.rgb*=1.+(grain-.5)*.022*fine;
}`,
      'fragment',
    );
    injectAfter(
      shader,
      'roughnessmap_fragment',
      'roughnessFactor = clamp(roughnessFactor + mxPlasticScuff * .17, .28, .86);',
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

/** Original race graphics authored for MOTObound. Reference photographs inform
 * the hierarchy and placement; no photographed manufacturer artwork is used. */
export function motocrossGraphics(
  colours: RiderColours,
  kind: 'shroud' | 'number' | 'jersey' | 'sleeve' | 'helmet',
  number = 2,
) {
  const width = kind === 'jersey' ? 1024 : 512;
  const hex = (n: number) => `#${n.toString(16).padStart(6, '0')}`;
  const primary = hex(colours.primary),
    secondary = hex(colours.secondary),
    accent = hex(colours.accent);
  const texture = canvasTexture(width, 512, (c) => {
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
      c.fillText('MOTOBOUND', 256, 48, 380);
      c.fillStyle = '#171a1d';
      c.font = 'italic 950 334px "Saira Variable", sans-serif';
      c.textBaseline = 'middle';
      c.fillText(String(number), 247, 278, 416);
      c.fillStyle = '#ffffff';
      c.font = '700 21px "Saira Variable", sans-serif';
      c.fillText('FACTORY  /  MX', 256, 477, 300);
    } else if (kind === 'jersey') {
      for (const centre of [256, 768]) {
        polygon(
          [
            [centre - 198, 0],
            [centre - 156, 512],
            [centre + 174, 512],
            [centre + 196, 0],
          ],
          secondary,
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
      c.textAlign = 'center';
      // The loft wraps U clockwise, so each chest/back panel needs its text
      // mirrored around its own centre to read normally on the outside.
      const print = (text: string, x: number, y: number, width: number) => {
        c.save();
        c.translate(x, y);
        c.scale(-1, 1);
        c.fillText(text, 0, 0, width);
        c.restore();
      };
      c.fillStyle = '#f0ede6';
      c.font = '800 42px "Saira Variable", sans-serif';
      print('MOTOBOUND', 256, 206, 292);
      c.font = '700 23px "Saira Variable", sans-serif';
      print('OFFROAD RACING', 256, 244, 246);
      print('FACTORY RIDER', 768, 121, 272);
      c.font = 'italic 950 225px "Saira Variable", sans-serif';
      print(String(number), 758, 359, 274);
      c.font = '800 24px "Saira Variable", sans-serif';
      print('MOTOBOUND', 768, 405, 270);
      c.fillStyle = accent;
      c.fillRect(166, 273, 180, 6);
      c.fillRect(674, 425, 188, 6);
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
      if (kind === 'shroud') {
        c.save();
        c.translate(246, 269);
        c.rotate(-0.2);
        c.textAlign = 'center';
        c.fillStyle = '#f3f0e8';
        c.font = 'italic 900 61px "Saira Variable", sans-serif';
        c.fillText('MOTOBOUND', 0, 0, 422);
        c.font = '800 28px "Saira Variable", sans-serif';
        c.fillText('MX  /  FACTORY', 0, 43, 326);
        c.restore();
        c.fillStyle = '#eeeae1';
        c.fillRect(345, 420, 116, 30);
        c.fillStyle = '#22272a';
        c.font = '800 22px "Saira Variable", sans-serif';
        c.textAlign = 'center';
        c.fillText('RACING', 403, 443, 107);
      }
    }
  });
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
    [
      [-0.17, 0.135],
      [0.085, 0.168],
      [0.325, 0.105],
      [0.23, -0.028],
      [0.209, -0.265],
      [0.103, -0.299],
      [0.027, -0.118],
      [-0.129, -0.052],
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
    const u = T.MathUtils.clamp((z + 0.17) / 0.495, 0, 1),
      v = T.MathUtils.clamp((y + 0.3) / 0.47, 0, 1);
    return (
      0.028 * Math.sin(u * Math.PI) * Math.sin(v * Math.PI) -
      0.021 * (1 - T.MathUtils.smoothstep(u, 0, 0.38)) +
      0.008 * T.MathUtils.smoothstep(v, 0.5, 0.8) * T.MathUtils.smoothstep(u, 0.35, 0.75)
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
export function motocrossRotor(radius: number, detail: RiderDetail, sprocket = false) {
  const shape = new T.Shape(),
    count = detail === 'high' ? 120 : 64;
  for (let i = 0; i <= count; i++) {
    const a = (i / count) * Math.PI * 2;
    const r = radius * (sprocket ? 0.97 + 0.03 * Math.cos(a * 40) : 0.97 + 0.03 * Math.cos(a * 10));
    if (i === 0) shape.moveTo(Math.cos(a) * r, Math.sin(a) * r);
    else shape.lineTo(Math.cos(a) * r, Math.sin(a) * r);
  }
  const centre = new T.Path();
  centre.absarc(0, 0, radius * 0.44, 0, Math.PI * 2, true);
  shape.holes.push(centre);
  const holes = detail === 'high' ? 12 : 8;
  for (let k = 0; k < holes; k++) {
    const a = (k / holes) * Math.PI * 2,
      hole = new T.Path();
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
  const g = new T.ExtrudeGeometry(shape, {
    depth: 0.004,
    steps: 1,
    bevelEnabled: false,
    curveSegments: detail === 'high' ? 3 : 2,
  });
  g.translate(0, 0, -0.002);
  g.rotateY(Math.PI / 2);
  return g;
}

/** Staggered centre blocks and angled shoulder lugs. The outer tyre radius is
 * exact: wheel-ground contact does not change when the close detail appears. */
export function motocrossTread(radius: number, halfWidth: number, height: number, count: number) {
  const parts: T.BufferGeometry[] = [];
  for (let k = 0; k < count; k++) {
    const a = (k / count) * Math.PI * 2;
    const rows = k % 2 === 0 ? [0, -0.9, 0.9] : [-0.43, 0.43, -0.94, 0.94];
    for (const row of rows) {
      const shoulder = Math.abs(row) > 0.8;
      const g = motocrossLug(shoulder ? halfWidth * 0.5 : halfWidth * 0.58, height, 0.026);
      const p = g.getAttribute('position');
      g.rotateZ(shoulder ? -Math.sign(row) * 0.46 : row * 0.12);
      g.translate(
        row * halfWidth * 0.84,
        radius - height * 0.52 - (shoulder ? height * 0.27 : 0),
        0,
      );
      // A rectangular lug's tangential corners otherwise exceed the tyre
      // envelope slightly. Keep every vertex within the physical radius.
      for (let i = 0; i < p.count; i++) {
        const radial = Math.hypot(p.getY(i), p.getZ(i));
        if (radial > radius)
          p.setXYZ(i, p.getX(i), (p.getY(i) * radius) / radial, (p.getZ(i) * radius) / radial);
      }
      g.computeVertexNormals();
      g.rotateX(a + (shoulder ? (Math.PI / count) * 0.28 : 0));
      parts.push(g);
    }
  }
  const result = mergeGeometries(parts, false)!;
  for (const g of parts) g.dispose();
  return result;
}

/** Rounded manufacturing corners and a narrow worn crown on each tread lug.
 * Three chamfered rings keep the polygon cost bounded; no per-lug mesh, texture
 * or rounded-box subdivision is kept after the wheel has been merged. */
function motocrossLug(width: number, height: number, length: number) {
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
      positions.push((x * width * scale) / 2, y, (z * length * scale) / 2);
      uv.push((x + 1) / 2, (z + 1) / 2);
    }
  for (let row = 0; row < 2; row++)
    for (let i = 0; i < 8; i++) {
      const a = row * 8 + i,
        b = row * 8 + ((i + 1) % 8);
      indices.push(a, a + 8, b, b, a + 8, b + 8);
    }
  for (let i = 1; i < 7; i++) {
    indices.push(0, i, i + 1);
    indices.push(16, 16 + i + 1, 16 + i);
  }
  const indexed = new T.BufferGeometry();
  indexed.setAttribute('position', new T.Float32BufferAttribute(positions, 3));
  indexed.setAttribute('uv', new T.Float32BufferAttribute(uv, 2));
  indexed.setIndex(indices);
  const geometry = indexed.toNonIndexed();
  indexed.dispose();
  geometry.computeVertexNormals();
  return geometry;
}
