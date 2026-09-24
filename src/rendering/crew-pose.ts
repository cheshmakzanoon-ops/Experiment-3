import * as T from 'three';
import { clamp } from '../core/math.ts';
import { CREW_BONES, CREW_REST } from './people-asset.ts';

const UNIT = new T.Vector3(1, 1, 1);
const DOWN = new T.Vector3(0, -1, 0);
const X = new T.Vector3(1, 0, 0);
const armPole = [new T.Vector3(-0.8, -0.25, -0.3), new T.Vector3(0.8, -0.25, -0.3)];
const legPole = new T.Vector3(0, 0, 1);
export const CREW_UPPER_ARM = 0.36;
export const CREW_FOREARM = 0.34;
export const CREW_THIGH = 0.42;
export const CREW_SHIN = Math.hypot(0.405, 0.035);

/** Reusable analytic two-bone solver. Its actual bone transforms, not a second
 * diagnostic-only skeleton, drive the authored cloth in colour and shadow. */
export class CrewPose {
  readonly joints = Array.from({ length: CREW_BONES }, () => new T.Vector3());
  readonly rotations = Array.from({ length: CREW_BONES }, () => new T.Quaternion());
  readonly matrices = Array.from({ length: CREW_BONES }, () => new T.Matrix4());
  readonly reachable = [true, true];
  readonly root = new T.Matrix4();
  private inverse = new T.Matrix4();
  private delta = new T.Vector3();
  private perpendicular = new T.Vector3();
  private target = new T.Vector3();
  private restInverse = new T.Matrix4();
  private shinRest = CREW_REST[10].clone().sub(CREW_REST[11]).negate().normalize();

  private bend(
    a: T.Vector3,
    b: T.Vector3,
    upper: number,
    lower: number,
    pole: T.Vector3,
    out: T.Vector3,
  ) {
    this.delta.copy(b).sub(a);
    const actual = this.delta.length();
    const distance = clamp(actual, Math.abs(upper - lower) + 1e-5, upper + lower - 1e-5);
    if (actual < 1e-8) this.delta.copy(DOWN);
    else this.delta.multiplyScalar(1 / actual);
    this.perpendicular.copy(pole).addScaledVector(this.delta, -pole.dot(this.delta));
    if (this.perpendicular.lengthSq() < 1e-8)
      this.perpendicular.copy(X).addScaledVector(this.delta, -X.dot(this.delta));
    this.perpendicular.normalize();
    const along = (upper * upper + distance * distance - lower * lower) / (2 * distance);
    out
      .copy(a)
      .addScaledVector(this.delta, along)
      .addScaledVector(this.perpendicular, Math.sqrt(Math.max(0, upper * upper - along * along)));
    return actual <= upper + lower + 1e-4 && actual >= Math.abs(upper - lower) - 1e-4;
  }
  private aim(bone: number, end: T.Vector3, rest = DOWN) {
    this.delta.copy(end).sub(this.joints[bone]).normalize();
    this.rotations[bone].setFromUnitVectors(rest, this.delta);
  }
  set(
    root: T.Matrix4,
    hipHeight: number,
    lean: number,
    hands: readonly T.Vector3[],
    footSpread = 0.15,
  ) {
    if (
      hands.length !== 2 ||
      !Number.isFinite(hipHeight + lean + footSpread) ||
      !root.elements.every(Number.isFinite) ||
      Math.abs(root.determinant()) < 1e-8 ||
      !hands.every((hand) => Number.isFinite(hand.x + hand.y + hand.z))
    )
      throw new Error('Invalid crew pose');
    this.root.copy(root);
    this.inverse.copy(root).invert();
    this.joints[0].set(0, hipHeight, 0);
    this.rotations[0].identity();
    this.joints[1].copy(this.joints[0]);
    this.rotations[1].setFromAxisAngle(X, lean);
    for (const bone of [2, 3, 6])
      this.joints[bone]
        .copy(CREW_REST[bone])
        .sub(CREW_REST[0])
        .applyQuaternion(this.rotations[1])
        .add(this.joints[0]);
    this.rotations[2].setFromAxisAngle(X, lean * 0.25);
    for (let side = 0; side < 2; side++) {
      const arm = side === 0 ? 3 : 6;
      this.joints[arm + 2].copy(hands[side]).applyMatrix4(this.inverse);
      this.reachable[side] = this.bend(
        this.joints[arm],
        this.joints[arm + 2],
        CREW_UPPER_ARM,
        CREW_FOREARM,
        armPole[side],
        this.joints[arm + 1],
      );
      this.aim(arm, this.joints[arm + 1]);
      this.aim(arm + 1, this.joints[arm + 2]);
      this.rotations[arm + 2].copy(this.rotations[arm + 1]);
      const leg = side === 0 ? 9 : 12,
        sign = side === 0 ? -1 : 1;
      this.joints[leg].set(sign * 0.092, hipHeight, 0);
      this.joints[leg + 2].set(sign * 0.14, 0.055, footSpread + 0.035);
      this.target.copy(this.joints[leg + 2]);
      this.bend(
        this.joints[leg],
        this.target,
        CREW_THIGH,
        CREW_SHIN,
        legPole,
        this.joints[leg + 1],
      );
      this.aim(leg, this.joints[leg + 1]);
      this.aim(leg + 1, this.joints[leg + 2], this.shinRest);
      this.rotations[leg + 2].identity(); // planted soles, independent of the shin bend
    }
    for (let i = 0; i < CREW_BONES; i++) {
      this.restInverse.makeTranslation(-CREW_REST[i].x, -CREW_REST[i].y, -CREW_REST[i].z);
      this.matrices[i].compose(this.joints[i], this.rotations[i], UNIT).multiply(this.restInverse);
    }
    return this;
  }
  write(array: Float32Array, actor: number) {
    const offset = actor * CREW_BONES * 16;
    if (!Number.isInteger(actor) || actor < 0 || offset + CREW_BONES * 16 > array.length)
      throw new Error('Crew bone atlas capacity exceeded');
    for (let i = 0; i < CREW_BONES; i++) this.matrices[i].toArray(array, offset + i * 16);
  }
  /** Readback follows the same matrices uploaded to the GPU. */
  endpoint(bone: number, restPoint: T.Vector3, out = new T.Vector3()) {
    return out.copy(restPoint).applyMatrix4(this.matrices[bone]).applyMatrix4(this.root);
  }
}

/** GPU instance skinning: four texels per bone, one 60-texel row per actor. Two
 * normalized influences are guaranteed by the authored asset contract. */
export function installCrewSkin(
  material: T.Material,
  bones: T.DataTexture,
  rows: number,
  colour: boolean,
) {
  material.onBeforeCompile = (shader) => {
    for (const hook of ['void main() {', '#include <begin_vertex>'])
      if (!shader.vertexShader.includes(hook)) throw new Error(`Crew skin hook missing: ${hook}`);
    shader.uniforms.crewBones = { value: bones };
    shader.uniforms.crewRows = { value: rows };
    shader.vertexShader =
      `
attribute vec4 crewJoint;
attribute vec4 crewWeight;
attribute float crewSlot;
uniform sampler2D crewBones;
uniform float crewRows;
${colour ? 'attribute float crewCloth; varying float vCrewCloth; varying vec3 vCrewPattern;' : ''}
mat4 crewBone(float joint) {
  float row = (crewSlot + .5) / crewRows;
  float column = joint * 4.;
  return mat4(texture2D(crewBones,vec2((column+.5)/60.,row)),
    texture2D(crewBones,vec2((column+1.5)/60.,row)),
    texture2D(crewBones,vec2((column+2.5)/60.,row)),
    texture2D(crewBones,vec2((column+3.5)/60.,row)));
}
` + shader.vertexShader;
    shader.vertexShader = shader.vertexShader.replace(
      'void main() {',
      'void main() {\nmat4 crewTransform = crewBone(crewJoint.x)*crewWeight.x + crewBone(crewJoint.y)*crewWeight.y;',
    );
    shader.vertexShader = shader.vertexShader.replace(
      '#include <beginnormal_vertex>',
      '#include <beginnormal_vertex>\nobjectNormal = mat3(crewTransform) * objectNormal;',
    );
    shader.vertexShader = shader.vertexShader.replace(
      '#include <begin_vertex>',
      `vec3 transformed = (crewTransform * vec4(position,1.)).xyz;${colour ? '\nvCrewCloth=crewCloth; vCrewPattern=position;' : ''}`,
    );
    if (colour) {
      shader.fragmentShader =
        'varying float vCrewCloth; varying vec3 vCrewPattern;\n' + shader.fragmentShader;
      shader.fragmentShader = shader.fragmentShader.replace(
        '#include <roughnessmap_fragment>',
        `#include <roughnessmap_fragment>
float weave = vCrewPattern.y * 220.;
float resolved = 1. - smoothstep(.5,2.,fwidth(weave));
roughnessFactor = mix(.58,.88+sin(weave)*resolved*.035,vCrewCloth);`,
      );
    }
  };
  material.customProgramCacheKey = () => `aurel-authored-instance-skin-v1-${colour}`;
  return material;
}
