import * as T from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { clamp } from '../core/math.ts';

export type CrowdDetail = 0 | 1 | 2;

/** Seated people face local -X. Hip height is the seat plane; feet terminate
 * at -0.30 m, on the existing grandstand deck rather than floating over it. */
export function spectatorGeometry(detail: CrowdDetail) {
  if (![0, 1, 2].includes(detail)) throw new Error('Invalid crowd detail');
  const parts: T.BufferGeometry[] = [];
  const segments = detail === 0 ? 8 : detail === 1 ? 6 : 4;
  const add = (g: T.BufferGeometry, joint: number, skin: boolean, color: number) => {
    const count = g.getAttribute('position').count;
    g.setAttribute('crowdJoint', new T.Float32BufferAttribute(new Float32Array(count).fill(joint), 1));
    g.setAttribute('skinMask', new T.Float32BufferAttribute(new Float32Array(count).fill(skin ? 1 : 0), 1));
    const c = new T.Color(color), colors = new Float32Array(count * 3);
    for (let i = 0; i < count; i++) colors.set([c.r, c.g, c.b], i * 3);
    g.setAttribute('color', new T.BufferAttribute(colors, 3));
    parts.push(g);
  };
  const sphere = (x: number, y: number, z: number, sx: number, sy: number, sz: number) =>
    new T.SphereGeometry(1, segments, Math.max(3, segments - 2)).scale(sx, sy, sz).translate(x, y, z);
  const limb = (a: T.Vector3, b: T.Vector3, radius: number) => {
    const g = new T.CylinderGeometry(radius * 0.85, radius, a.distanceTo(b), segments);
    const rotation = new T.Quaternion().setFromUnitVectors(new T.Vector3(0, 1, 0), b.clone().sub(a).normalize());
    return g.applyQuaternion(rotation).translate((a.x + b.x) / 2, (a.y + b.y) / 2, (a.z + b.z) / 2);
  };
  add(sphere(0, 0.30, 0, 0.12, 0.215, 0.16), 0, false, 0xffffff);
  add(sphere(-0.016, 0.615, 0, 0.09, 0.108, 0.086), 3, true, 0xffffff);
  for (const side of [-1, 1]) {
    const hip = new T.Vector3(0, 0.09, side * 0.078);
    const knee = new T.Vector3(-0.255, 0.065, side * 0.087);
    const ankle = new T.Vector3(-0.27, -0.246, side * 0.085);
    add(limb(hip, knee, 0.066), 0, false, 0x42484c);
    add(limb(knee, ankle, 0.044), 0, false, 0x42484c);
    add(new T.BoxGeometry(0.17, 0.051, 0.084).translate(-0.31, -0.2745, side * 0.085), 0, false, 0x252a2c);
    if (detail !== 2) {
      const shoulder = new T.Vector3(0, 0.43, side * 0.142);
      const elbow = new T.Vector3(-0.075, 0.23, side * 0.175);
      const hand = new T.Vector3(-0.245, 0.19, side * 0.083);
      const joint = side < 0 ? 1 : 2;
      add(limb(shoulder, elbow, 0.048), joint, false, 0xffffff);
      add(limb(elbow, hand, 0.035), joint, false, 0xe7e7e7);
      add(sphere(hand.x, hand.y, hand.z, 0.045, 0.023, 0.027), joint, true, 0xffffff);
    }
  }
  const g = mergeGeometries(parts, false)!;
  parts.forEach((p) => p.dispose());
  g.computeBoundingBox(); g.computeBoundingSphere();
  return g;
}

interface CrowdUniforms {
  crowdClock: { value: T.Vector2 };
  crowdMotion: { value: number };
  crowdLodRange?: { value: T.Vector2 };
}

/** A spatial, not time-integrated handoff. Every spectator has one stable rank
 * and is rendered at exactly one LOD even inside a transition band. Individual
 * silhouettes switch at different distances instead of an entire stand popping.
 * Rewinds and paused camera movement do not accumulate a fading animation. */
export function crowdLodRanges(distance: number, out: readonly T.Vector2[]) {
  if (!Number.isFinite(distance) || distance < 0 || out.length !== 3)
    throw new Error('Invalid crowd handoff');
  out.forEach((range) => range.set(0, 0));
  const smooth = (start: number, end: number) => {
    const t = clamp((distance - start) / (end - start), 0, 1);
    return t * t * (3 - 2 * t);
  };
  if (distance < 108) {
    const weight = smooth(92, 108);
    out[0].set(weight, 1); out[1].set(0, weight);
  } else {
    const weight = smooth(218, 242);
    out[1].set(weight, 1); out[2].set(0, weight);
  }
  return out;
}
const deform = `
attribute float crowdJoint;
attribute float spectatorPhase;
uniform vec2 crowdClock;
uniform float crowdMotion;
mat3 crowdTurn() {
  float wave = (sin(crowdClock.x + spectatorPhase) * 0.7
    + sin(crowdClock.y + spectatorPhase * 1.73) * 0.3) * crowdMotion;
  float angle = crowdJoint > 2.5 ? wave * 0.075 : wave * 0.035;
  if (crowdJoint < 0.5) angle = 0.0;
  float c = cos(angle), s = sin(angle);
  if (crowdJoint > 2.5) return mat3(c,0.,-s, 0.,1.,0., s,0.,c);
  return mat3(c,s,0., -s,c,0., 0.,0.,1.);
}
vec3 crowdPivot() {
  if (crowdJoint > 2.5) return vec3(0.,0.50,0.);
  return vec3(0.,0.43, crowdJoint < 1.5 ? -0.142 : 0.142);
}
`;

/** Match colour and shadow deformation. Bounded angles are smaller than the
 * expanded instance bounds. No wall-clock animation, opacity sorting or alpha
 * test is needed; colour/skin variation comes from original vertex attributes. */
export function installCrowdShader(material: T.Material, uniforms: CrowdUniforms, colour: boolean) {
  material.onBeforeCompile = (shader) => {
    if (!shader.vertexShader.includes('#include <begin_vertex>'))
      throw new Error('Crowd shader position hook missing');
    Object.assign(shader.uniforms, uniforms);
    shader.uniforms.crowdLodRange = uniforms.crowdLodRange ?? { value: new T.Vector2(0, 1) };
    shader.vertexShader = 'varying float vCrowdRank;\n' + deform + (colour ? 'attribute float skinMask;\nattribute vec3 spectatorSkin;\n' : '') + shader.vertexShader;
    shader.vertexShader = shader.vertexShader.replace('#include <begin_vertex>',
      'vCrowdRank = min(.9999999, spectatorPhase / 6.28318530718);\nvec3 transformed = crowdTurn() * (position - crowdPivot()) + crowdPivot();');
    shader.vertexShader = shader.vertexShader.replace('#include <beginnormal_vertex>',
      '#include <beginnormal_vertex>\nobjectNormal = crowdTurn() * objectNormal;');
    // Complementary half-open ranges use the same rank in colour AND depth.
    // No transparent sorting, alpha blend, wall time or camera-facing shadow trick.
    if (!shader.fragmentShader.includes('#include <alphatest_fragment>'))
      throw new Error('Crowd shader coverage hook missing');
    shader.fragmentShader = 'uniform vec2 crowdLodRange; varying float vCrowdRank;\n' + shader.fragmentShader;
    shader.fragmentShader = shader.fragmentShader.replace('#include <alphatest_fragment>',
      '#include <alphatest_fragment>\nif (vCrowdRank < crowdLodRange.x || vCrowdRank >= crowdLodRange.y) discard;');
    if (colour) {
      if (!shader.vertexShader.includes('#include <color_vertex>'))
        throw new Error('Crowd shader colour hook missing');
      shader.vertexShader = shader.vertexShader.replace('#include <color_vertex>',
        '#include <color_vertex>\nvColor.rgb = mix(vColor.rgb, spectatorSkin, skinMask);');
    }
  };
  material.customProgramCacheKey = () => `apex-seated-crowd-v2-ranked-${colour ? 'colour' : 'depth'}`;
}

export function crowdDetail(distance: number, previous: CrowdDetail): CrowdDetail {
  if (!Number.isFinite(distance) || distance < 0) throw new Error('Invalid crowd distance');
  if (previous === 0 && distance < 108) return 0;
  if (previous === 1 && distance > 92 && distance < 242) return 1;
  if (previous === 2 && distance > 218) return 2;
  return distance < 100 ? 0 : distance < 230 ? 1 : 2;
}

/** A spatially culled cluster shares all instance storage across its levels.
 * One draw outside handoff bands, two only within a band, never three. */
export class CrowdCluster {
  readonly root = new T.Group();
  readonly levels: readonly T.InstancedMesh[];
  readonly uniforms: CrowdUniforms = { crowdClock: { value: new T.Vector2() }, crowdMotion: { value: 0 } };
  level: CrowdDetail = 0;
  readonly lodRanges = [new T.Vector2(0, 1), new T.Vector2(), new T.Vector2()];
  private centre = new T.Vector3();
  private localCentre = new T.Vector3();
  constructor(matrices: readonly T.Matrix4[], colors: readonly T.Color[], seed: number,
    material: T.MeshStandardMaterial) {
    if (!matrices.length || matrices.length !== colors.length || !Number.isSafeInteger(seed))
      throw new Error('Invalid spectator cluster');
    this.root.name = `Seated crowd cluster ${seed}`;
    const phase = new Float32Array(matrices.length), skin = new Float32Array(matrices.length * 3);
    const skinPalette = [0xc58a66, 0x86583f, 0xe5b58e, 0x573b2f, 0xac7654].map((c) => new T.Color(c));
    for (let i = 0; i < matrices.length; i++) {
      let hash = (i + 1) ^ seed;
      hash = Math.imul(hash ^ (hash >>> 16), 0x7feb352d);
      hash = Math.imul(hash ^ (hash >>> 15), 0x846ca68b);
      hash ^= hash >>> 16;
      phase[i] = (hash >>> 0) / 4294967296 * Math.PI * 2;
      const c = skinPalette[Math.abs((i * 17 + seed) % skinPalette.length)];
      skin.set([c.r, c.g, c.b], i * 3);
      this.localCentre.add(new T.Vector3().setFromMatrixPosition(matrices[i]));
    }
    this.localCentre.multiplyScalar(1 / matrices.length);
    const phases = new T.InstancedBufferAttribute(phase, 1), skins = new T.InstancedBufferAttribute(skin, 3);
    const levels: T.InstancedMesh[] = [];
    for (const level of [0, 1, 2] as const) {
      const colorMaterial = material.clone(); colorMaterial.vertexColors = true;
      const depth = new T.MeshDepthMaterial({ depthPacking: T.RGBADepthPacking });
      const uniforms = { ...this.uniforms, crowdLodRange: { value: this.lodRanges[level] } };
      installCrowdShader(colorMaterial, uniforms, true); installCrowdShader(depth, uniforms, false);
      const geometry = spectatorGeometry(level);
      geometry.setAttribute('spectatorPhase', phases);
      geometry.setAttribute('spectatorSkin', skins);
      const people = new T.InstancedMesh(geometry, colorMaterial, matrices.length);
      if (levels.length) {
        people.instanceMatrix = levels[0].instanceMatrix;
        people.instanceColor = levels[0].instanceColor;
      } else matrices.forEach((matrix, i) => { people.setMatrixAt(i, matrix); people.setColorAt(i, colors[i]); });
      people.name = `${this.root.name} detail ${level}`;
      people.castShadow = true; people.receiveShadow = true;
      people.customDepthMaterial = depth;
      people.visible = level === 0;
      people.computeBoundingBox(); people.computeBoundingSphere();
      // Shoulder/head motion is bounded to < 3 cm; retain a 5 cm guard.
      people.boundingBox!.expandByScalar(0.05); people.boundingSphere!.radius += 0.05;
      levels.push(people); this.root.add(people);
    }
    this.levels = levels;
  }
  update(time: number, camera: T.Vector3, rain: number) {
    if (!Number.isFinite(time) || !Number.isFinite(rain) ||
      !Number.isFinite(camera.x + camera.y + camera.z)) throw new Error('Invalid crowd presentation');
    this.root.updateWorldMatrix(true, false);
    this.centre.copy(this.localCentre).applyMatrix4(this.root.matrixWorld);
    const distance = this.centre.distanceTo(camera);
    this.level = crowdDetail(distance, this.level);
    crowdLodRanges(distance, this.lodRanges);
    this.levels.forEach((mesh, i) => { mesh.visible = this.lodRanges[i].y > this.lodRanges[i].x; });
    // Both frequencies wrap at their own complete cycle, avoiding a long-race
    // float-time jump. The exact same replay timestamp restores the same pose.
    const cycle = Math.PI * 2;
    this.uniforms.crowdClock.value.set((time * 0.71) % cycle, (time * 0.43) % cycle);
    this.uniforms.crowdMotion.value = clamp((120 - distance) / 40, 0, 1) * (1 - clamp(rain / 40, 0, 0.4));
  }
}
