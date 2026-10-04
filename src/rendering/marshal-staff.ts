import * as T from 'three';
import { F, H, HEADER, CAR_STRIDE, carBase } from '../simulation/protocol.ts';
import { FLAG } from '../simulation/marshal.ts';
import { crewPerformanceGeometry } from './crew-performance.ts';
import { CrewPose, installCrewSkin } from './crew-pose.ts';
import { marshalAction } from './start-finish-assets.ts';
import type { TrackDetailSite } from './track-infrastructure.ts';

/** A post relays the recorded local flag of the nearest car within 45 metres.
 * This is an explicitly bounded presentation witness, not a second race-control
 * simulation or the player's yellow copied to every post around the circuit. */
export function postSignal(frame: Float32Array, s: number) {
  const count = frame[H.CARS],
    length = frame[H.LENGTH];
  if (
    !Number.isInteger(count) ||
    count < 1 ||
    count > 12 ||
    frame.length < HEADER + count * CAR_STRIDE ||
    !Number.isFinite(length + s) ||
    length <= 0
  )
    throw new Error('Invalid marshal presentation snapshot');
  if (frame[H.FLAG] === FLAG.CHEQUERED && Math.min(s, length - s) < 180) return FLAG.CHEQUERED;
  let nearest = 45,
    signal: number = FLAG.GREEN;
  for (let id = 0; id < count; id++) {
    const b = carBase(id);
    if (!Number.isFinite(frame[b + F.S] + frame[b + F.LOCAL_FLAG]))
      throw new Error('Non-finite marshal witness');
    if (frame[b + F.IN_PIT] || frame[b + F.RETIRED]) continue;
    const delta = Math.abs(((frame[b + F.S] - s + length * 1.5) % length) - length * 0.5);
    if (delta < nearest) {
      nearest = delta;
      signal = frame[b + F.LOCAL_FLAG];
    }
  }
  return signal === FLAG.GREEN ||
    signal === FLAG.YELLOW ||
    signal === FLAG.DOUBLE_YELLOW ||
    signal === FLAG.BLUE
    ? signal
    : FLAG.GREEN;
}
/** Shared A41/A42 suit and kit at existing protected posts. The actual local
 * signal selects the authored attention/flag control; pole, cloth and gripping
 * glove share a transform. No wall-clock state or writes to race control. */
export class MarshalStaffView {
  readonly root = new T.Group();
  readonly bodies: T.InstancedMesh;
  readonly heads: T.InstancedMesh;
  readonly flags: T.InstancedMesh;
  readonly poles: T.InstancedMesh;
  readonly gloves: readonly [T.InstancedMesh, T.InstancedMesh];
  private readonly transform = new T.Object3D();
  private readonly origin = new T.Object3D();
  private readonly actor = new T.Object3D();
  private readonly flag = new T.Object3D();
  private readonly matrix = new T.Matrix4();
  private readonly part = new T.Matrix4();
  private readonly color = new T.Color();
  private readonly action = new T.Vector2();
  private readonly pose = new CrewPose();
  private readonly hands = [new T.Vector3(), new T.Vector3()];
  private readonly wrists = [new T.Vector3(), new T.Vector3()];
  private readonly handMatrices = [new T.Matrix4(), new T.Matrix4()];
  private readonly cuff = new T.Vector3(0, -0.067, -0.008);
  private readonly grip = new T.Vector3(0, 0.034, 0.041);
  private readonly scratch = new T.Vector3();
  private readonly expectedGrip = new T.Vector3();
  private readonly bones: T.DataTexture;
  private readonly boneData: Float32Array;
  private readonly slots: T.InstancedBufferAttribute;
  private readonly flagColors = [0x387a48, 0xf1cf32, 0xe6e2ce, 0xf1cf32, 0x3489dc];
  private readonly clothTime = { value: 0 };
  active = 0;
  maxGripError = 0;
  unreachable = 0;
  constructor(readonly posts: readonly TrackDetailSite[]) {
    const count = Math.max(1, posts.length * 2);
    this.boneData = new Float32Array(count * 15 * 16);
    this.bones = new T.DataTexture(this.boneData, 60, count, T.RGBAFormat, T.FloatType);
    this.bones.minFilter = this.bones.magFilter = T.NearestFilter;
    this.bones.generateMipmaps = false;
    this.bones.needsUpdate = true;
    this.slots = new T.InstancedBufferAttribute(
      Float32Array.from({ length: count }, (_, i) => i),
      1,
    );
    const body = crewPerformanceGeometry('suit_mid'),
      c = body.getAttribute('color'),
      pos = body.getAttribute('position'),
      cloth = body.getAttribute('crewCloth');
    // Role-specific orange fabric and reflective bands, on the retained skin.
    const orange = new T.Color(0xe6813c),
      reflector = new T.Color(0xe8e6c8);
    for (let i = 0; i < c.count; i++)
      if (cloth.getX(i) > 0.5) {
        const y = pos.getY(i),
          col = Math.abs(y - 1.2) < 0.035 || Math.abs(y - 0.39) < 0.028 ? reflector : orange;
        c.setXYZ(i, col.r, col.g, col.b);
      }
    body.setAttribute('crewSlot', this.slots);
    const material = new T.MeshStandardMaterial({ vertexColors: true, roughness: 0.88 });
    installCrewSkin(material, this.bones, count, true);
    this.bodies = new T.InstancedMesh(body, material, count);
    const depth = new T.MeshDepthMaterial({ depthPacking: T.RGBADepthPacking }),
      distance = new T.MeshDistanceMaterial();
    installCrewSkin(depth, this.bones, count, false);
    installCrewSkin(distance, this.bones, count, false);
    this.bodies.customDepthMaterial = depth;
    this.bodies.customDistanceMaterial = distance;
    material.addEventListener('dispose', () => this.bones.dispose());
    this.heads = new T.InstancedMesh(
      crewPerformanceGeometry('helmet'),
      new T.MeshStandardMaterial({ vertexColors: true, roughness: 0.4 }),
      count,
    );
    this.gloves = [true, false].map(
      (left) =>
        new T.InstancedMesh(
          crewPerformanceGeometry('glove', left),
          new T.MeshStandardMaterial({ vertexColors: true, roughness: 0.82 }),
          count,
        ),
    ) as unknown as [T.InstancedMesh, T.InstancedMesh];
    const flagGeometry = new T.PlaneGeometry(0.65, 0.4, 12, 6).translate(0.33, 0.62, 0);
    const flagMaterial = new T.MeshStandardMaterial({
      color: 0xffffff,
      roughness: 0.94,
      side: T.DoubleSide,
    });
    const installFlag = (material: T.Material, coloured: boolean) => {
      material.onBeforeCompile = (shader) => {
        shader.uniforms.flagTime = this.clothTime;
        shader.vertexShader =
          'uniform float flagTime;\nvarying vec2 vFlagUV;\n' + shader.vertexShader;
        shader.vertexShader = shader.vertexShader
          .replace('#include <uv_vertex>', '#include <uv_vertex>\nvFlagUV=uv;')
          .replace(
            '#include <begin_vertex>',
            '#include <begin_vertex>\ntransformed.z+=sin(uv.x*9.-flagTime*3.+uv.y)*.035*uv.x;',
          );
        if (coloured)
          shader.fragmentShader =
            'varying vec2 vFlagUV;\n' +
            shader.fragmentShader.replace(
              '#include <color_fragment>',
              `#include <color_fragment>
          float white=step(.6,min(diffuseColor.r,min(diffuseColor.g,diffuseColor.b)));
          float check=mod(floor(vFlagUV.x*8.)+floor(vFlagUV.y*5.),2.);
          diffuseColor.rgb*=mix(1.,mix(.04,1.,check),white);`,
            );
      };
      material.customProgramCacheKey = () => `aurel-held-flag-v2-${coloured}`;
    };
    installFlag(flagMaterial, true);
    this.flags = new T.InstancedMesh(flagGeometry, flagMaterial, Math.max(1, posts.length));
    this.flags.customDepthMaterial = new T.MeshDepthMaterial({
      depthPacking: T.RGBADepthPacking,
      side: T.DoubleSide,
    });
    this.flags.customDistanceMaterial = new T.MeshDistanceMaterial({ side: T.DoubleSide });
    installFlag(this.flags.customDepthMaterial, false);
    installFlag(this.flags.customDistanceMaterial, false);
    this.poles = new T.InstancedMesh(
      new T.CylinderGeometry(0.012, 0.012, 0.95, 8).translate(0, 0.35, 0),
      new T.MeshStandardMaterial({ color: 0xd2cebb, roughness: 0.55 }),
      Math.max(1, posts.length),
    );
    this.root.add(this.bodies, this.heads, this.flags, this.poles, ...this.gloves);
    this.root.name = 'A45 recorded-signal articulated marshal staff';
    for (const batch of this.root.children as T.InstancedMesh[]) {
      batch.count = 0;
      batch.frustumCulled = false;
      batch.castShadow = batch.receiveShadow = true;
      batch.instanceMatrix.setUsage(T.DynamicDrawUsage);
    }
  }
  update(frame: Float32Array, camera: T.Vector3, visible = true) {
    if (!Number.isFinite(frame[H.TIME] + camera.x + camera.y + camera.z))
      throw new Error('Invalid staff view');
    for (const b of this.root.children as T.InstancedMesh[]) b.count = 0;
    this.active = this.unreachable = this.maxGripError = 0;
    if (!visible) return;
    this.clothTime.value = ((frame[H.TIME] % (Math.PI * 2)) + Math.PI * 2) % (Math.PI * 2);
    for (const [index, site] of this.posts.entries()) {
      if (Math.hypot(camera.x - site.x, camera.z - site.z) > 160) continue;
      const signal = postSignal(frame, site.s);
      this.origin.position.set(site.x, site.y + 0.18, site.z);
      this.origin.rotation.set(0, site.yaw - (site.side * Math.PI) / 2, 0);
      this.origin.updateMatrix();
      for (let person = 0; person < 2; person++) {
        const slot = this.active,
          waving = person === 0 && signal !== FLAG.GREEN;
        marshalAction(frame[H.TIME] + index * 0.37 + person * 0.8, waving, this.action);
        this.actor.position.set((person - 0.5) * 1.05, 0, 0.18);
        this.actor.rotation.set(0, person ? -0.1 : 0.03, 0);
        this.actor.scale.setScalar(1);
        this.actor.updateMatrix();
        this.flag.position.set(-0.19, 1.12, 0.28);
        this.flag.rotation.set(0, 0, this.action.y);
        this.flag.scale.setScalar(1);
        this.flag.updateMatrix();
        this.hands[0].set(waving ? -0.19 : -0.21, waving ? 1.12 : 0.9, waving ? 0.28 : 0.15);
        this.hands[1].set(0.21, 0.92, 0.12);
        for (let hand = 0; hand < 2; hand++) {
          this.transform.position.copy(this.hands[hand]);
          this.transform.rotation.set(0, 0, waving && hand === 0 ? this.action.y : Math.PI);
          this.transform.scale.setScalar(1);
          this.transform.position.sub(
            this.scratch.copy(this.grip).applyQuaternion(this.transform.quaternion),
          );
          this.transform.updateMatrix();
          this.handMatrices[hand].copy(this.transform.matrix).premultiply(this.actor.matrix);
          this.wrists[hand].copy(this.cuff).applyMatrix4(this.handMatrices[hand]);
        }
        this.pose.set(this.actor.matrix, 0.86, 0.025, this.wrists, 0.02);
        this.pose.rotations[2].setFromAxisAngle(this.actor.up, this.action.x);
        this.pose.write(this.boneData, slot);
        this.unreachable += Number(!this.pose.reachable[0]) + Number(!this.pose.reachable[1]);
        this.matrix.multiplyMatrices(this.origin.matrix, this.actor.matrix);
        this.bodies.setMatrixAt(this.bodies.count++, this.matrix);
        this.transform.position.copy(this.pose.joints[2]);
        this.transform.quaternion.copy(this.pose.rotations[2]);
        this.transform.scale.setScalar(1);
        this.transform.updateMatrix();
        this.part
          .multiplyMatrices(this.actor.matrix, this.transform.matrix)
          .premultiply(this.origin.matrix);
        this.heads.setMatrixAt(this.heads.count++, this.part);
        for (let hand = 0; hand < 2; hand++) {
          this.part.multiplyMatrices(this.origin.matrix, this.handMatrices[hand]);
          this.gloves[hand].setMatrixAt(this.gloves[hand].count++, this.part);
          this.scratch.copy(this.grip).applyMatrix4(this.handMatrices[hand]);
          this.maxGripError = Math.max(
            this.maxGripError,
            this.scratch.distanceTo(
              this.expectedGrip.copy(this.hands[hand]).applyMatrix4(this.actor.matrix),
            ),
          );
        }
        if (waving) {
          this.part
            .multiplyMatrices(this.actor.matrix, this.flag.matrix)
            .premultiply(this.origin.matrix);
          this.flags.setMatrixAt(this.flags.count, this.part);
          this.flags.setColorAt(this.flags.count++, this.color.setHex(this.flagColors[signal]));
          this.poles.setMatrixAt(this.poles.count++, this.part);
        }
        this.active++;
      }
    }
    this.bones.needsUpdate = true;
    for (const b of this.root.children as T.InstancedMesh[]) {
      b.instanceMatrix.needsUpdate = true;
      if (b.instanceColor) b.instanceColor.needsUpdate = true;
    }
  }
}
