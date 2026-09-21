import * as T from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { F, H, HEADER, CAR_STRIDE, carBase } from '../simulation/protocol.ts';
import { FLAG } from '../simulation/marshal.ts';
import { tailoredCrewGeometry, crewHelmetGeometry, crewGloveGeometry } from './crew-geometry.ts';
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
  return [FLAG.GREEN, FLAG.YELLOW, FLAG.DOUBLE_YELLOW, FLAG.BLUE].includes(
    signal as typeof FLAG.GREEN,
  )
    ? signal
    : FLAG.GREEN;
}
function torsoGeometry() {
  const g = tailoredCrewGeometry();
  g.setAttribute('position', g.morphAttributes.position![0].clone());
  g.setAttribute('normal', g.morphAttributes.normal![0].clone());
  g.morphAttributes = {};
  return g.scale(0.16, 0.62, 0.15);
}
function standingBody() {
  const pieces: T.BufferGeometry[] = [];
  const add = (g: T.BufferGeometry, color: number) => {
    const c = new T.Color(color),
      values = new Float32Array(g.getAttribute('position').count * 3);
    for (let i = 0; i < values.length; i += 3) values.set([c.r, c.g, c.b], i);
    g.setAttribute('color', new T.BufferAttribute(values, 3));
    pieces.push(g);
  };
  add(torsoGeometry().translate(0, 1.21, 0), 0xe2792e);
  const limb = (a: T.Vector3, b: T.Vector3, r: number, color: number) => {
    const g = tailoredCrewGeometry();
    g.morphAttributes = {};
    g.scale(r, a.distanceTo(b), r * 0.85);
    g.applyQuaternion(
      new T.Quaternion().setFromUnitVectors(new T.Vector3(0, 1, 0), b.clone().sub(a).normalize()),
    );
    g.translate((a.x + b.x) / 2, (a.y + b.y) / 2, (a.z + b.z) / 2);
    add(g, color);
  };
  for (const side of [-1, 1]) {
    limb(
      new T.Vector3(side * 0.09, 0.94, 0),
      new T.Vector3(side * 0.1, 0.51, 0.025),
      0.087,
      0xd9762f,
    );
    limb(
      new T.Vector3(side * 0.1, 0.51, 0.025),
      new T.Vector3(side * 0.105, 0.11, 0),
      0.066,
      0xb7622b,
    );
    add(
      new T.CapsuleGeometry(0.061, 0.13, 3, 8)
        .rotateX(Math.PI / 2)
        .scale(1, 0.74, 1)
        .translate(side * 0.105, 0.055, 0.065),
      0x20282a,
    );
    limb(
      new T.Vector3(side * 0.19, 1.4, 0),
      new T.Vector3(side * 0.225, 1.12, 0.05),
      0.062,
      0xe2792e,
    );
    limb(
      new T.Vector3(side * 0.225, 1.12, 0.05),
      new T.Vector3(side * 0.2, 1.03, 0.24),
      0.048,
      0xe2792e,
    );
    add(
      crewGloveGeometry()
        .scale(0.045, 0.052, 0.039)
        .translate(side * 0.2, 1.03, 0.25),
      0x273032,
    );
    add(new T.BoxGeometry(0.047, 0.31, 0.016).translate(side * 0.1, 1.27, 0.126), 0xe7dfb4);
  }
  // Chest radio and two horizontal reflective panels: actual geometry, not lit decals.
  add(new T.BoxGeometry(0.043, 0.085, 0.023).translate(-0.085, 1.35, 0.14), 0x242b2d);
  add(new T.BoxGeometry(0.25, 0.027, 0.017).translate(0, 1.13, 0.13), 0xe7dfb4);
  const g = mergeGeometries(pieces, false)!;
  pieces.forEach((p) => p.dispose());
  return g;
}
/** Twenty-four bounded original staff at the twelve actual shelter pads.
 * Pose, visibility and signals are rebuilt from the accepted snapshot: pause and
 * arbitrary replay seek are exact. No actor drives or changes marshal rules. */
export class MarshalStaffView {
  readonly root = new T.Group();
  readonly bodies: T.InstancedMesh;
  readonly heads: T.InstancedMesh;
  readonly flags: T.InstancedMesh;
  private readonly transform = new T.Object3D();
  private readonly origin = new T.Object3D();
  private readonly matrix = new T.Matrix4();
  private readonly color = new T.Color();
  private readonly flagColors = [0x387a48, 0xf1cf32, 0xe6e2ce, 0xf1cf32, 0x3489dc];
  active = 0;
  constructor(readonly posts: readonly TrackDetailSite[]) {
    const material = new T.MeshStandardMaterial({ vertexColors: true, roughness: 0.9 });
    this.bodies = new T.InstancedMesh(standingBody(), material, posts.length * 2);
    this.heads = new T.InstancedMesh(
      crewHelmetGeometry(),
      new T.MeshStandardMaterial({ vertexColors: true, roughness: 0.57 }),
      posts.length * 2,
    );
    const flagGeometry = new T.PlaneGeometry(0.65, 0.4, 12, 6).translate(0.33, 0, 0);
    const flagMaterial = new T.MeshStandardMaterial({
      color: 0xffffff,
      roughness: 0.94,
      side: T.DoubleSide,
    });
    flagMaterial.onBeforeCompile = (shader) => {
      shader.vertexShader = shader.vertexShader
        .replace('#include <common>', '#include <common>\nvarying vec2 vFlagUV;')
        .replace('#include <uv_vertex>', '#include <uv_vertex>\nvFlagUV=uv;');
      shader.fragmentShader = shader.fragmentShader
        .replace('#include <common>', '#include <common>\nvarying vec2 vFlagUV;')
        .replace(
          '#include <color_fragment>',
          `#include <color_fragment>
        float white=step(.6,min(diffuseColor.r,min(diffuseColor.g,diffuseColor.b)));
        float check=mod(floor(vFlagUV.x*8.)+floor(vFlagUV.y*5.),2.);
        diffuseColor.rgb*=mix(1.,mix(.04,1.,check),white);`,
        );
    };
    flagMaterial.customProgramCacheKey = () => 'aurel-marshal-flags-v1';
    this.flags = new T.InstancedMesh(flagGeometry, flagMaterial, posts.length);
    this.root.add(this.bodies, this.heads, this.flags);
    this.root.name = 'Recorded-state trackside staff';
    for (const batch of [this.bodies, this.heads, this.flags]) {
      batch.count = 0;
      batch.frustumCulled = false;
      batch.castShadow = true;
      batch.receiveShadow = true;
      batch.instanceMatrix.setUsage(T.DynamicDrawUsage);
    }
  }
  update(frame: Float32Array, camera: T.Vector3, visible = true) {
    if (!Number.isFinite(frame[H.TIME] + camera.x + camera.y + camera.z))
      throw new Error('Invalid staff view');
    this.bodies.count = this.heads.count = this.flags.count = 0;
    this.active = 0;
    if (!visible) return;
    for (const [index, site] of this.posts.entries()) {
      if (Math.hypot(camera.x - site.x, camera.z - site.z) > 160) continue;
      const signal = postSignal(frame, site.s);
      this.origin.position.set(site.x, site.y + 0.18, site.z);
      this.origin.rotation.set(0, site.yaw - (site.side * Math.PI) / 2, 0);
      this.origin.updateMatrix();
      for (let actor = 0; actor < 2; actor++) {
        const n = this.bodies.count++,
          height = actor === 0 ? 1 : 0.955,
          x = (actor - 0.5) * 1.05;
        this.transform.position.set(x, 0, 0.18);
        this.transform.rotation.set(0, actor ? -0.1 : 0.03, 0);
        this.transform.scale.set(height, height, height);
        this.transform.updateMatrix();
        this.bodies.setMatrixAt(
          n,
          this.matrix.copy(this.transform.matrix).premultiply(this.origin.matrix),
        );
        this.transform.position.set(x, 1.62 * height, 0.18);
        this.transform.scale.set(0.103 * height, 0.12 * height, 0.115 * height);
        this.transform.rotation.y += Math.sin(frame[H.TIME] * 0.37 + index + actor) * 0.075;
        this.transform.updateMatrix();
        this.heads.setMatrixAt(
          this.heads.count++,
          this.matrix.copy(this.transform.matrix).premultiply(this.origin.matrix),
        );
      }
      if (signal !== FLAG.GREEN) {
        this.transform.position.set(-0.325, 1.03, 0.43);
        this.transform.scale.set(1, 1, 1);
        this.transform.rotation.set(0, 0, -0.28 + Math.sin(frame[H.TIME] * 4.1 + index) * 0.21);
        this.transform.updateMatrix();
        const f = this.flags.count++;
        this.flags.setMatrixAt(
          f,
          this.matrix.copy(this.transform.matrix).premultiply(this.origin.matrix),
        );
        this.flags.setColorAt(f, this.color.setHex(this.flagColors[signal]));
      }
      this.active += 2;
    }
    for (const b of [this.bodies, this.heads, this.flags]) {
      b.instanceMatrix.needsUpdate = true;
      if (b.instanceColor) b.instanceColor.needsUpdate = true;
    }
  }
}
