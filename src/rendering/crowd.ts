import * as T from 'three';
import { peopleGeometry, PEOPLE_ASSET } from './people-asset.ts';
import { clamp } from '../core/math.ts';
import { crowdResponse } from './crowd-response.ts';
import { installCrowdImpostorShader, spectatorImpostorGeometry } from './crowd-impostor.ts';

export type CrowdDetail = 0 | 1 | 2 | 3;

/** Authored seated/standing correspondence from the retained Blender scene.
 * The existing seat plan and grounded boot soles are kept at every level. */
export function spectatorGeometry(detail: Exclude<CrowdDetail, 3>) {
  if (![0, 1, 2].includes(detail)) throw new Error('Invalid crowd detail');
  const geometry = peopleGeometry(`spectator_${detail}`);
  const standing = geometry.getAttribute('standingPosition');
  const point = new T.Vector3();
  for (let i = 0; i < standing.count; i++)
    geometry.boundingBox!.expandByPoint(point.fromBufferAttribute(standing, i));
  geometry.boundingBox!.getBoundingSphere(geometry.boundingSphere!);
  return geometry;
}

/** Stable, inspectable cohorts. Width/height change the garments above the
 * planted feet, never seat positions or aisle clearance. */
export function spectatorVariation(index: number, seed: number, canStand: boolean) {
  if (!Number.isInteger(index) || index < 0 || !Number.isSafeInteger(seed))
    throw new Error('Invalid spectator identity');
  const hash = (value: number) => {
    let h = Math.imul(value ^ (value >>> 16), 0x7feb352d);
    h = Math.imul(h ^ (h >>> 15), 0x846ca68b);
    return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
  };
  const group = hash((Math.floor(index / 3) + 1) ^ seed);
  return [
    0.9 + hash((index + 1) ^ seed) * 0.2,
    0.94 + hash((index + 631) ^ seed) * 0.12,
    canStand && group > 0.7 ? 1 : 0,
    hash((index + 917) ^ seed),
  ] as const;
}

interface CrowdUniforms {
  crowdClock: { value: T.Vector2 };
  crowdMotion: { value: number };
  crowdReaction?: { value: T.Vector2 };
  crowdLodRange?: { value: T.Vector2 };
}

/** A spatial, not time-integrated handoff. Every spectator has one stable rank
 * and is rendered at exactly one LOD even inside a transition band. Individual
 * silhouettes switch at different distances instead of an entire stand popping.
 * Rewinds and paused camera movement do not accumulate a fading animation. */
export function crowdLodRanges(distance: number, out: readonly T.Vector2[]) {
  if (!Number.isFinite(distance) || distance < 0 || out.length !== 4)
    throw new Error('Invalid crowd handoff');
  out.forEach((range) => range.set(0, 0));
  const smooth = (start: number, end: number) => {
    const t = clamp((distance - start) / (end - start), 0, 1);
    return t * t * (3 - 2 * t);
  };
  if (distance < 108) {
    const weight = smooth(92, 108);
    out[0].set(weight, 1);
    out[1].set(0, weight);
  } else if (distance < 242) {
    const weight = smooth(218, 242);
    out[1].set(weight, 1);
    out[2].set(0, weight);
  } else {
    const weight = smooth(420, 480);
    out[2].set(weight, 1);
    out[3].set(0, weight);
  }
  return out;
}
const deform = `
attribute vec3 crowdPerson;
#define crowdJoint crowdPerson.x
#define skinMask crowdPerson.y
#define crowdAccessory crowdPerson.z
attribute float spectatorPhase;
attribute vec4 spectatorStyle;
attribute vec3 standingPosition;
attribute vec3 standingNormal;
varying float vCrowdAccessory;
uniform vec2 crowdClock;
uniform float crowdMotion;
uniform vec2 crowdReaction;
mat3 crowdTurn() {
  float wave = (sin(crowdClock.x + spectatorPhase) * 0.7
    + sin(crowdClock.y + spectatorPhase * 1.73) * 0.3) * crowdMotion;
  float angle = crowdJoint > 2.5 ? wave * 0.075 : wave * 0.035;
  if (crowdJoint > .5 && crowdJoint < 2.5) {
    float participant = smoothstep(.18,.5,fract(spectatorPhase * 2.17));
    float gesture = .86 + .14 * sin(crowdClock.x * 3. + spectatorPhase * 1.9);
    // Stable one-arm/both-arm cohorts, not twelve thousand synchronized poses.
    float handChoice=fract(spectatorPhase*4.13);
    float activeHand=handChoice<.34 ? step(1.5,crowdJoint) : handChoice<.68 ? 1.-step(1.5,crowdJoint) : 1.;
    participant*=activeHand;
    angle -= participant * (crowdReaction.x * .82 * gesture + crowdReaction.y * .48);
  }
  if (crowdJoint < 0.5) angle = 0.0;
  float c = cos(angle), s = sin(angle);
  if (crowdJoint > 2.5) return mat3(c,0.,-s, 0.,1.,0., s,0.,c);
  return mat3(c,s,0., -s,c,0., 0.,0.,1.);
}
vec3 crowdShape(vec3 p) {
  p.z *= spectatorStyle.x;
  if (p.y > .1) p.y = .1 + (p.y-.1) * spectatorStyle.y;
  return p;
}
vec3 crowdPivot() {
  vec3 p = crowdJoint > 2.5 ? vec3(0.,.50,0.) : vec3(0.,.43,crowdJoint < 1.5 ? -.142 : .142);
  p += vec3(-.255,.53,0.) * spectatorStyle.z;
  return crowdShape(p);
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
    shader.uniforms.crowdReaction = uniforms.crowdReaction ?? { value: new T.Vector2() };
    shader.uniforms.crowdLodRange = uniforms.crowdLodRange ?? { value: new T.Vector2(0, 1) };
    shader.vertexShader =
      'varying float vCrowdRank;\n' +
      deform +
      (colour ? 'attribute vec3 spectatorSkin;\n' : '') +
      shader.vertexShader;
    shader.vertexShader = shader.vertexShader.replace(
      '#include <begin_vertex>',
      `vCrowdRank = min(.9999999, spectatorPhase / 6.28318530718);
vCrowdAccessory = crowdAccessory < .5 ? 1. : crowdAccessory < 1.5 ? step(.55,spectatorStyle.w) : step(.82,spectatorStyle.w);
vec3 shaped = crowdShape(mix(position,standingPosition,spectatorStyle.z));
vec3 transformed = crowdTurn() * (shaped - crowdPivot()) + crowdPivot();`,
    );
    shader.vertexShader = shader.vertexShader.replace(
      '#include <beginnormal_vertex>',
      `#include <beginnormal_vertex>
objectNormal = mix(objectNormal,standingNormal,spectatorStyle.z);
objectNormal.z /= spectatorStyle.x;
if (mix(position.y,standingPosition.y,spectatorStyle.z) > .1) objectNormal.y /= spectatorStyle.y;
objectNormal = crowdTurn() * normalize(objectNormal);`,
    );
    // Complementary half-open ranges use the same rank in colour AND depth.
    // No transparent sorting, alpha blend, wall time or camera-facing shadow trick.
    if (!shader.fragmentShader.includes('#include <alphatest_fragment>'))
      throw new Error('Crowd shader coverage hook missing');
    shader.fragmentShader =
      'uniform vec2 crowdLodRange; varying float vCrowdRank; varying float vCrowdAccessory;\n' +
      shader.fragmentShader;
    shader.fragmentShader = shader.fragmentShader.replace(
      '#include <alphatest_fragment>',
      '#include <alphatest_fragment>\nif (vCrowdRank < crowdLodRange.x || vCrowdRank >= crowdLodRange.y || vCrowdAccessory < .5) discard;',
    );
    if (colour) {
      if (!shader.vertexShader.includes('#include <color_vertex>'))
        throw new Error('Crowd shader colour hook missing');
      shader.vertexShader = shader.vertexShader.replace(
        '#include <color_vertex>',
        `#include <color_vertex>
float style=fract(spectatorPhase*3.47);
float torsoPanel=step(.35,position.y)*step(position.y,.40)*(1.-step(.5,crowdJoint));
float sleevePanel=step(.5,crowdJoint)*(1.-step(2.5,crowdJoint))*step(.31,position.y);
float cloth=1.-step(.5,skinMask);
vColor.rgb=mix(vColor.rgb,vColor.rgb*.4,cloth*torsoPanel*step(.34,style));
vColor.rgb=mix(vColor.rgb,vec3(.74,.72,.64),cloth*sleevePanel*step(.68,style));
vColor.rgb = mix(vColor.rgb, spectatorSkin, clamp(skinMask,0.0,1.0));
vec3 hair = mix(vec3(0.012,0.008,0.006), vec3(0.15,0.078,0.025),fract(spectatorPhase*1.31));
vColor.rgb = mix(vColor.rgb,hair,step(1.5,skinMask));`,
      );
    }
  };
  material.customProgramCacheKey = () =>
    `apex-authored-crowd-v6-cohorts-${colour ? 'colour' : 'depth'}`;
}

export function crowdDetail(distance: number, previous: CrowdDetail): CrowdDetail {
  if (!Number.isFinite(distance) || distance < 0) throw new Error('Invalid crowd distance');
  if (previous === 0 && distance < 108) return 0;
  if (previous === 1 && distance > 92 && distance < 242) return 1;
  if (previous === 2 && distance > 218 && distance < 480) return 2;
  if (previous === 3 && distance > 420) return 3;
  return distance < 100 ? 0 : distance < 230 ? 1 : distance < 450 ? 2 : 3;
}

/** A spatially culled cluster shares all instance storage across its levels.
 * One draw outside handoff bands, two only within a band, never three. */
export class CrowdCluster {
  readonly root = new T.Group();
  readonly levels: readonly T.InstancedMesh[];
  readonly uniforms = {
    crowdClock: { value: new T.Vector2() },
    crowdMotion: { value: 0 },
    crowdReaction: { value: new T.Vector2() },
  };
  level: CrowdDetail = 0;
  readonly lodRanges = [new T.Vector2(0, 1), new T.Vector2(), new T.Vector2(), new T.Vector2()];
  private centre = new T.Vector3();
  private localCentre = new T.Vector3();
  constructor(
    matrices: readonly T.Matrix4[],
    colors: readonly T.Color[],
    seed: number,
    material: T.MeshStandardMaterial,
  ) {
    if (!matrices.length || matrices.length !== colors.length || !Number.isSafeInteger(seed))
      throw new Error('Invalid spectator cluster');
    this.root.name = `Authored crowd cluster ${seed}`;
    this.root.userData.authoredPeople = PEOPLE_ASSET;
    const phase = new Float32Array(matrices.length),
      skin = new Float32Array(matrices.length * 3),
      style = new Float32Array(matrices.length * 4);
    const frontRow = Math.min(...matrices.map((m) => m.elements[13]));
    const skinPalette = [0xc58a66, 0x86583f, 0xe5b58e, 0x573b2f, 0xac7654].map(
      (c) => new T.Color(c),
    );
    for (let i = 0; i < matrices.length; i++) {
      let hash = (i + 1) ^ seed;
      hash = Math.imul(hash ^ (hash >>> 16), 0x7feb352d);
      hash = Math.imul(hash ^ (hash >>> 15), 0x846ca68b);
      hash ^= hash >>> 16;
      phase[i] = ((hash >>> 0) / 4294967296) * Math.PI * 2;
      style.set(spectatorVariation(i, seed, matrices[i].elements[13] > frontRow + 0.6), i * 4);
      const c = skinPalette[Math.abs((i * 17 + seed) % skinPalette.length)];
      skin.set([c.r, c.g, c.b], i * 3);
      this.localCentre.add(new T.Vector3().setFromMatrixPosition(matrices[i]));
    }
    this.localCentre.multiplyScalar(1 / matrices.length);
    const phases = new T.InstancedBufferAttribute(phase, 1),
      skins = new T.InstancedBufferAttribute(skin, 3),
      styles = new T.InstancedBufferAttribute(style, 4);
    const levels: T.InstancedMesh[] = [];
    for (const level of [0, 1, 2, 3] as const) {
      const colorMaterial = material.clone();
      colorMaterial.vertexColors = true;
      const depth =
        level === 3 ? undefined : new T.MeshDepthMaterial({ depthPacking: T.RGBADepthPacking });
      const distanceMaterial = level === 3 ? undefined : new T.MeshDistanceMaterial();
      const uniforms = { ...this.uniforms, crowdLodRange: { value: this.lodRanges[level] } };
      if (level === 3) installCrowdImpostorShader(colorMaterial, this.lodRanges[level]);
      else {
        installCrowdShader(colorMaterial, uniforms, true);
        installCrowdShader(depth!, uniforms, false);
        installCrowdShader(distanceMaterial!, uniforms, false);
      }
      const geometry = level === 3 ? spectatorImpostorGeometry() : spectatorGeometry(level);
      geometry.setAttribute('spectatorPhase', phases);
      geometry.setAttribute('spectatorSkin', skins);
      geometry.setAttribute('spectatorStyle', styles);
      const people = new T.InstancedMesh(geometry, colorMaterial, matrices.length);
      if (levels.length) {
        people.instanceMatrix = levels[0].instanceMatrix;
        people.instanceColor = levels[0].instanceColor;
      } else
        matrices.forEach((matrix, i) => {
          people.setMatrixAt(i, matrix);
          people.setColorAt(i, colors[i]);
        });
      people.name = `${this.root.name} detail ${level}`;
      people.castShadow = level !== 3;
      people.receiveShadow = true;
      people.customDepthMaterial = depth;
      people.customDistanceMaterial = distanceMaterial;
      people.visible = level === 0;
      people.computeBoundingBox();
      people.computeBoundingSphere();
      // Raised forearms move by at most 32 cm; the card may rotate about its
      // seat. Keep both in the culling volume without changing seat transforms.
      const guard = 0.44;
      people.boundingBox!.expandByScalar(guard);
      people.boundingSphere!.radius += guard;
      levels.push(people);
      this.root.add(people);
    }
    this.levels = levels;
  }
  update(time: number, camera: T.Vector3, rain: number, frame?: Float32Array) {
    if (
      !Number.isFinite(time) ||
      !Number.isFinite(rain) ||
      !Number.isFinite(camera.x + camera.y + camera.z)
    )
      throw new Error('Invalid crowd presentation');
    this.root.updateWorldMatrix(true, false);
    this.centre.copy(this.localCentre).applyMatrix4(this.root.matrixWorld);
    const distance = this.centre.distanceTo(camera);
    crowdResponse(frame, this.centre, this.uniforms.crowdReaction.value).multiplyScalar(
      clamp((180 - distance) / 50, 0, 1) * (1 - clamp(rain / 60, 0, 0.4)),
    );
    this.level = crowdDetail(distance, this.level);
    crowdLodRanges(distance, this.lodRanges);
    this.levels.forEach((mesh, i) => {
      mesh.visible = this.lodRanges[i].y > this.lodRanges[i].x;
    });
    // Both frequencies wrap at their own complete cycle, avoiding a long-race
    // float-time jump. The exact same replay timestamp restores the same pose.
    const cycle = Math.PI * 2;
    this.uniforms.crowdClock.value.set((time * 0.71) % cycle, (time * 0.43) % cycle);
    this.uniforms.crowdMotion.value =
      clamp((120 - distance) / 40, 0, 1) * (1 - clamp(rain / 40, 0, 0.4));
  }
}
