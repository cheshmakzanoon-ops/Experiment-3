import * as T from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { chainShaderHook, injectAfter, injectDeclarations } from '../studio/shader-hooks.ts';
import { tagWeatherSurface } from '../weather-presentation.ts';

const HUB = new T.Vector3(0.3, 1.3, 0),
  POST = 0.069;
const RAD = 0.65,
  GORES = 8;
const palette = [0x546d83, 0x813c3a, 0xc1ac75, 0x354951, 0x63775b, 0xc4c3b5];
const shaftX = (y: number) => POST + ((HUB.x - POST) * (y + 0.12)) / (HUB.y + 0.12);

/** Panel edge stations are shared with their wire ribs. In the folded pose
 * the nylon hangs down the canted shaft. An open gore sags between its two
 * wire ends and sheds water below the hub. Units are metres from the rail. */
function cloth(open: boolean, panel: number, r: number, v: number) {
  const angle = ((panel + v) * 2 * Math.PI) / GORES,
    bay = Math.sin(Math.PI * v);
  const y = HUB.y - (open ? 0.235 * r ** 1.58 + 0.025 * r * r * bay : 0.638 * r);
  const radius = open ? RAD * r * (1 - 0.043 * r * bay) : r * (0.025 + 0.028 * bay);
  return new T.Vector3(
    (open ? HUB.x : shaftX(y)) + radius * Math.cos(angle),
    y,
    radius * Math.sin(angle),
  );
}

function umbrellaPose(open: boolean) {
  const parts: T.BufferGeometry[] = [];
  function add(source: T.BufferGeometry, tint: number, fabric = false) {
    const g = source.index ? source.toNonIndexed() : source;
    if (g !== source) source.dispose();
    const count = g.getAttribute('position').count;
    const color = new T.Color(tint),
      col = new Float32Array(3 * count);
    for (let i = 0; i < count; i++) color.toArray(col, 3 * i);
    g.setAttribute('color', new T.BufferAttribute(col, 3));
    g.setAttribute(
      'gpUmbrellaFabric',
      new T.BufferAttribute(new Float32Array(count).fill(+fabric), 1),
    );
    parts.push(g);
  }
  function bar(a: T.Vector3, b: T.Vector3, r: number, color: number, sides = 6) {
    const axis = b.clone().sub(a);
    const g = new T.CylinderGeometry(r, r, axis.length(), sides, 1, true);
    g.applyQuaternion(
      new T.Quaternion().setFromUnitVectors(new T.Vector3(0, 1, 0), axis.normalize()),
    );
    add(g.translate((a.x + b.x) / 2, (a.y + b.y) / 2, (a.z + b.z) / 2), color);
  }
  // Two clamp bands wrap the existing 68 mm spectator-rail post. Their
  // jaws carry the cantilever on the spectator side of the barrier.
  for (const y of [-0.135, -0.04]) {
    add(new T.TorusGeometry(0.038, 0.006, 4, 12).rotateX(Math.PI / 2).translate(0, y, 0), 0x757a79);
    add(new T.BoxGeometry(0.055, 0.019, 0.025).translate(0.047, y, 0), 0x4b5052);
  }
  bar(new T.Vector3(POST, -0.15, 0), HUB, 0.0135, 0x686c6b, 8);
  const runnerY = open ? HUB.y - 0.18 : HUB.y - 0.48;
  add(
    new T.CylinderGeometry(0.019, 0.017, 0.037, 8).translate(shaftX(runnerY), runnerY, 0),
    0x373a3d,
  );
  for (let k = 0; k < GORES; k++) {
    const positions: number[] = [],
      uv: number[] = [],
      indices: number[] = [];
    const apex = cloth(open, k, 0, 0);
    positions.push(...apex.toArray());
    uv.push(0, 0);
    const rows = 4,
      cols = 4;
    for (let i = 1; i <= rows; i++)
      for (let j = 0; j <= cols; j++) {
        const r = i / rows,
          v = j / cols;
        positions.push(...cloth(open, k, r, v).toArray());
        uv.push(r, v);
        if (j === cols) continue;
        const a = 1 + (i - 1) * (cols + 1) + j;
        if (i === 1) indices.push(0, a + 1, a);
        else indices.push(a - cols - 1, a - cols, a, a - cols, a + 1, a);
      }
    const g = new T.BufferGeometry();
    g.setAttribute('position', new T.Float32BufferAttribute(positions, 3));
    g.setAttribute('uv', new T.Float32BufferAttribute(uv, 2));
    g.setIndex(indices);
    g.computeVertexNormals();
    add(g, k % 4 === 2 ? 0xd9d9d7 : k % 2 ? 0xf6f6f4 : 0xffffff, true);
    let a = cloth(open, k, 0, 0);
    a.y -= 0.009;
    for (const r of [0.42, 0.74, 1]) {
      const b = cloth(open, k, r, 0);
      b.y -= 0.007;
      bar(a, b, 0.0035, 0x464b4d, 4);
      a = b;
    }
    const brace = cloth(open, k, 0.42, 0);
    brace.y -= 0.009;
    bar(new T.Vector3(shaftX(runnerY), runnerY, 0), brace, 0.0038, 0x656a6c, 4);
  }
  add(new T.ConeGeometry(0.02, 0.026, 9).translate(HUB.x, HUB.y + 0.01, 0), 0x373a3a);
  const g = mergeGeometries(parts, false)!;
  parts.forEach((part) => part.dispose());
  return g;
}

function umbrellaGeometry() {
  const base = umbrellaPose(false),
    open = umbrellaPose(true);
  const positions: T.BufferAttribute[] = [],
    normals: T.BufferAttribute[] = [];
  const pos = open.getAttribute('position'),
    norm = open.getAttribute('normal');
  const rest = base.getAttribute('position'),
    restN = base.getAttribute('normal');
  for (const channel of ['open', 'across', 'along']) {
    const p = new Float32Array(pos.count * 3),
      n = new Float32Array(pos.count * 3);
    for (let i = 0; i < pos.count; i++) {
      const x = pos.getX(i),
        y = pos.getY(i),
        z = pos.getZ(i);
      const nx = norm.getX(i),
        ny = norm.getY(i),
        nz = norm.getZ(i);
      const flex = T.MathUtils.smoothstep(y, -0.035, 0.15);
      if (channel === 'open') {
        p.set([x - rest.getX(i), y - rest.getY(i), z - rest.getZ(i)], 3 * i);
        n.set([nx - restN.getX(i), ny - restN.getY(i), nz - restN.getZ(i)], 3 * i);
      } else if (channel === 'across') {
        p.set([flex * y, -flex * (x - POST), 0], 3 * i);
        n.set([flex * ny, -flex * nx, 0], 3 * i);
      } else {
        p.set([0, -flex * z, flex * y], 3 * i);
        n.set([0, -flex * nz, flex * ny], 3 * i);
      }
    }
    positions.push(new T.BufferAttribute(p, 3));
    normals.push(new T.BufferAttribute(n, 3));
  }
  open.dispose();
  base.morphTargetsRelative = true;
  base.morphAttributes.position = positions;
  base.morphAttributes.normal = normals;
  // Include both tips and the maximum recorded crosswind deflection.
  base.boundingBox = new T.Box3(
    new T.Vector3(-0.51, -0.19, -0.83),
    new T.Vector3(1.12, 1.45, 0.83),
  );
  base.boundingSphere = base.boundingBox.getBoundingSphere(new T.Sphere());
  return base;
}

/** One instanced draw along each open viewing bank. Native morph targets use
 * the same canopy and rib positions in the colour, depth and distance passes. */
export class GpRailUmbrellas {
  readonly mesh: T.InstancedMesh;
  private readonly pose: T.Mesh;
  private readonly phases: number[];
  private readonly last = new T.Vector4(NaN, NaN, NaN, NaN);
  private gust = NaN;
  constructor(
    anchors: readonly T.Vector3[],
    private readonly side: number,
    seed: number,
  ) {
    const material = tagWeatherSurface(
      new T.MeshStandardMaterial({
        color: 0xffffff,
        roughness: 0.69,
        metalness: 0.03,
        vertexColors: true,
        side: T.DoubleSide,
        name: 'GP coated spectator nylon and umbrella hardware',
      }),
      'fabric',
    );
    chainShaderHook(material, 'gp-rail-umbrella-v1', (shader) => {
      injectDeclarations(
        shader,
        'common',
        'attribute float gpUmbrellaFabric; varying float vGpCanopy;',
        'vertex',
      );
      injectAfter(
        shader,
        'color_vertex',
        `
        vGpCanopy=gpUmbrellaFabric;
        #if defined(USE_COLOR) && defined(USE_INSTANCING_COLOR)
          vColor.rgb=mix(color.rgb,vColor.rgb,gpUmbrellaFabric);
        #endif`,
        'vertex',
      );
      injectDeclarations(shader, 'common', 'varying float vGpCanopy;', 'fragment');
      injectAfter(
        shader,
        'metalnessmap_fragment',
        'metalnessFactor=mix(.47,metalnessFactor,vGpCanopy);',
        'fragment',
      );
    });
    const geometry = umbrellaGeometry();
    this.mesh = new T.InstancedMesh(geometry, material, anchors.length);
    this.pose = new T.Mesh(geometry, material);
    this.mesh.name = 'GP rail-clamped spectator umbrellas';
    const m = new T.Matrix4().makeRotationY(side > 0 ? 0 : Math.PI);
    this.phases = anchors.map((point, i) => {
      this.mesh.setMatrixAt(i, m.setPosition(point));
      this.mesh.setColorAt(i, new T.Color(palette[(seed + 5 * i) % palette.length]));
      const phase = ((seed * 29 + i * 137) % 953) / 953;
      this.mesh.setMorphAt(i, this.pose);
      return phase;
    });
    this.mesh.computeBoundingSphere();
    this.mesh.castShadow = this.mesh.receiveShadow = true;
  }
  presentWorld(rain: number, wind: T.Vector4) {
    this.mesh.updateWorldMatrix(true, false);
    const e = this.mesh.matrixWorld.elements;
    const x = this.side * (wind.x * e[0] + wind.y * e[2]),
      z = this.side * (wind.x * e[8] + wind.y * e[10]);
    const t = wind.z,
      gust = wind.w;
    if (!Number.isFinite(rain + x + z + t + gust)) return;
    if (
      this.last.x === rain &&
      this.last.y === x &&
      this.last.z === z &&
      this.last.w === t &&
      this.gust === gust
    )
      return;
    if (rain <= 0 && this.last.x <= 0) return;
    this.last.set(rain, x, z, t);
    this.gust = gust;
    const influence = this.pose.morphTargetInfluences!;
    for (let i = 0; i < this.phases.length; i++) {
      const phase = this.phases[i],
        open = T.MathUtils.smoothstep(rain, 0.15 + phase * 1.5, 2.25 + phase * 3.1);
      const flex =
        open *
        (0.8 + 0.12 * Math.cos(phase * 12 + t * 1.73) + 0.08 * T.MathUtils.clamp(gust, 0, 1));
      const gain = (0.095 * flex) / (7 + Math.hypot(x, z));
      influence[0] = open;
      influence[1] = x * gain;
      influence[2] = z * gain;
      this.mesh.setMorphAt(i, this.pose);
    }
    if (this.mesh.morphTexture) this.mesh.morphTexture.needsUpdate = true;
  }
}
