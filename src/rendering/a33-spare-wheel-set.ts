import * as T from 'three';
import source from './a33-spare-wheel-set.geometry.json' with { type: 'json' };
import manifest from './a33-spare-wheel-set.manifest.json' with { type: 'json' };
import { detailDistance } from './view-detail.ts';

export const A33 = Object.freeze(manifest);
export type A33Level = 0 | 1 | 2;
export type A33State = keyof typeof source.states;
export type A33Socket = keyof typeof source.sockets.front;
const UNIT = new T.Vector3(1, 1, 1);
const Y = new T.Vector3(0, 1, 0);
const Z = new T.Vector3(0, 0, 1);

/** Strict size checks precede decoding so corrupt embedded data cannot allocate
 * an unbounded buffer. The exact retained file hashes are independently checked
 * in the authoring/CI gate; no checksum is asserted without computing it. */
export function a33Bytes(encoded: string, bytes: number): Uint8Array<ArrayBuffer> {
  if (
    !Number.isSafeInteger(bytes) ||
    bytes < 1 ||
    bytes > 2 * 1024 * 1024 ||
    encoded.length !== 4 * Math.ceil(bytes / 3) ||
    !/^[A-Za-z0-9+/]*={0,2}$/.test(encoded)
  )
    throw new Error('Invalid A33 encoded buffer size');
  const text = atob(encoded);
  if (text.length !== bytes) throw new Error('Truncated A33 buffer');
  return Uint8Array.from(text, (c) => c.charCodeAt(0));
}
function floatBuffer(encoded: string, count: number) {
  const bytes = a33Bytes(encoded, count * 4);
  const data = new DataView(bytes.buffer);
  const out = new Float32Array(count);
  for (let i = 0; i < count; i++) {
    out[i] = data.getFloat32(i * 4, true);
    if (!Number.isFinite(out[i])) throw new Error('Nonfinite A33 attribute');
  }
  return out;
}
function normalBuffer(encoded: string, count: number) {
  const bytes = a33Bytes(encoded, count * 2);
  const data = new DataView(bytes.buffer);
  const out = new Float32Array(count);
  for (let i = 0; i < count; i++) out[i] = data.getInt16(i * 2, true) / 32767;
  for (let i = 0; i < count; i += 3)
    if (Math.abs(Math.hypot(out[i], out[i + 1], out[i + 2]) - 1) > 0.001)
      throw new Error('Invalid A33 normal');
  return out;
}
export function a33HalfWidth(wheel: number) {
  if (!Number.isInteger(wheel) || wheel < 0 || wheel > 3)
    throw new Error('Invalid A33 wheel index');
  return wheel < 2 ? source.halfWidths.front : source.halfWidths.rear;
}
export function a33Socket(wheel: number, socket: A33Socket, out = new T.Vector3()) {
  a33HalfWidth(wheel);
  const p = source.sockets[wheel < 2 ? 'front' : 'rear'][socket];
  if (!p) throw new Error('Invalid A33 socket');
  return out.set(p[0], p[1], p[2]);
}
/** Correct sidewall surface at the existing service hand-contact radius. */
export function a33GripX(wheel: number, radius: number) {
  const half = a33HalfWidth(wheel);
  if (!Number.isFinite(radius) || radius < 0.276 || radius > 0.296)
    throw new Error('A33 grip must remain on the sidewall contact arc');
  return half + 0.002 - (radius - 0.276) * 0.05;
}

export function a33Geometry(level: A33Level) {
  const m = source.meshes[level];
  if (
    !m ||
    source.schema !== 1 ||
    source.assetId !== 'A33' ||
    source.units !== 'metres-Y-up-X-axle'
  )
    throw new Error('Unsupported A33 source');
  if (
    !Number.isInteger(m.vertices) ||
    m.vertices < 3 ||
    m.vertices >= 65536 ||
    m.triangles !== A33.trianglesPerWheel[level] ||
    m.triangles > A33.triangleCeilings[level]
  )
    throw new Error('Invalid A33 topology budget');
  const position = floatBuffer(m.position, m.vertices * 3);
  const rear = floatBuffer(m.rearPosition, m.vertices * 3);
  const normal = normalBuffer(m.normal, m.vertices * 3);
  const rearNormal = normalBuffer(m.rearNormal, m.vertices * 3);
  const uv = floatBuffer(m.uv, m.vertices * 2);
  if (uv.some((v) => v < 0 || v > 1)) throw new Error('Invalid A33 atlas UV');
  for (const positions of [position, rear]) {
    for (let i = 0; i < positions.length; i += 3)
      if (Math.abs(positions[i]) > 0.25 || Math.hypot(positions[i + 1], positions[i + 2]) > 0.336)
        throw new Error('A33 wheel exceeds its dimensional envelope');
  }
  const bytes = a33Bytes(m.index, m.triangles * 6);
  const view = new DataView(bytes.buffer);
  const indices = new Uint16Array(m.triangles * 3);
  for (let i = 0; i < indices.length; i++) {
    indices[i] = view.getUint16(i * 2, true);
    if (indices[i] >= m.vertices) throw new Error('Invalid A33 index');
  }
  const g = new T.BufferGeometry();
  g.name = `A33 authored wheel LOD${level}`;
  g.setAttribute('position', new T.BufferAttribute(position, 3));
  g.setAttribute('normal', new T.BufferAttribute(normal, 3));
  g.setAttribute('uv', new T.BufferAttribute(uv, 2));
  g.setAttribute('color', new T.BufferAttribute(a33Bytes(m.color, m.vertices * 4), 4, true));
  g.setIndex(new T.BufferAttribute(indices, 1));
  // Absolute front/rear targets, selected only at 0 or 1. Built-in Three morph
  // sampling also runs in shadow/depth passes and needs no custom shader fork.
  g.morphTargetsRelative = false;
  g.morphAttributes.position = [new T.BufferAttribute(rear, 3)];
  g.morphAttributes.normal = [new T.BufferAttribute(rearNormal, 3)];
  g.userData = { assetId: 'A33', revision: A33.revision, lod: level };
  g.computeBoundingBox();
  g.computeBoundingSphere();
  return g;
}

function atlasTexture(name: 'normal' | 'orm') {
  const a = source.atlas;
  if (a.width !== 384 || a.height !== 128) throw new Error('Invalid A33 atlas extent');
  const texture = new T.DataTexture(a33Bytes(a[name], a.width * a.height * 4), a.width, a.height);
  texture.name = `A33 original ${name}`;
  texture.colorSpace = T.NoColorSpace;
  texture.flipY = false;
  texture.generateMipmaps = true;
  texture.minFilter = T.LinearMipmapLinearFilter;
  texture.magFilter = T.LinearFilter;
  texture.wrapS = texture.wrapT = T.ClampToEdgeWrapping;
  texture.anisotropy = 4;
  texture.userData.surfaceDetail = true;
  texture.needsUpdate = true;
  return texture;
}

/** Three fixed LOD batches, ONE PBR material, no per-wheel mesh or shader.
 * Front/rear position + normal targets have exact topology correspondence.
 * The material atlas preserves metal/rubber/carbon response in the same draw.
 * All allocations occur here, before a service phase is ever presented. */
export class A33WheelBatches {
  readonly batches: readonly T.InstancedMesh<T.BufferGeometry, T.MeshStandardMaterial>[];
  readonly material: T.MeshStandardMaterial;
  private readonly selector: T.Mesh;
  private readonly normal = atlasTexture('normal');
  private readonly orm = atlasTexture('orm');
  private readonly position = new T.Vector3();
  private readonly rotation = new T.Quaternion();
  private readonly local = new T.Matrix4();
  private readonly world = new T.Matrix4();
  private ended = false;
  private wheelCount = 0;
  constructor(readonly capacity = 96) {
    if (!Number.isInteger(capacity) || capacity < 1 || capacity > 96)
      throw new Error('Invalid A33 capacity');
    this.material = new T.MeshStandardMaterial({
      color: 0xffffff,
      vertexColors: true,
      roughness: 1,
      metalness: 1,
      normalMap: this.normal,
      normalScale: new T.Vector2(0.35, 0.35),
      roughnessMap: this.orm,
      metalnessMap: this.orm,
    });
    this.material.name = 'A33 original surface atlas';
    // Rubber stays rough; the carbon/alloy variation comes from the atlas.
    this.material.userData.assetId = 'A33';
    this.material.userData.weatherSurface = 'paint';
    this.material.userData.weatherExposure = 1;
    this.batches = ([0, 1, 2] as const).map((level) => {
      const batch = new T.InstancedMesh(a33Geometry(level), this.material, capacity);
      batch.name = `A33 spare wheels / LOD${level}`;
      batch.userData.assetId = 'A33';
      batch.userData.lod = level;
      batch.castShadow = batch.receiveShadow = true;
      batch.frustumCulled = false; // caller rejects service cars before submitting
      batch.instanceMatrix.setUsage(T.DynamicDrawUsage);
      return batch;
    });
    this.selector = new T.Mesh(this.batches[0].geometry, this.material);
    for (const batch of this.batches) {
      // Allocate shape data while count is still full capacity, not on first pit stop.
      batch.setMorphAt(0, this.selector);
      batch.morphTexture!.needsUpdate = true;
      batch.count = 0;
    }
  }
  begin() {
    if (this.ended) throw new Error('A33 batch is disposed');
    this.wheelCount = 0;
    for (const batch of this.batches) batch.count = 0;
  }
  put(wheel: number, transform: T.Matrix4, level: A33Level) {
    a33HalfWidth(wheel);
    if (
      this.ended ||
      !this.batches[level] ||
      this.wheelCount >= this.capacity ||
      !transform.elements.every(Number.isFinite) ||
      transform.determinant() <= 0
    )
      throw new Error('Invalid A33 instance or capacity exceeded');
    const batch = this.batches[level];
    batch.setMatrixAt(batch.count, transform);
    this.selector.morphTargetInfluences![0] = wheel < 2 ? 0 : 1;
    batch.setMorphAt(batch.count, this.selector);
    batch.count++;
    this.wheelCount++;
  }
  /** +X is outboard in the prototype; rotate left-side wheels, never use a
   * negative instance scale that would reverse winding and shadow facing. */
  putCarLocal(wheel: number, center: T.Vector3, car: T.Matrix4, level: A33Level) {
    a33HalfWidth(wheel);
    this.rotation.setFromAxisAngle(Y, wheel % 2 === 0 ? Math.PI : 0);
    this.local.compose(center, this.rotation, UNIT);
    this.world.multiplyMatrices(car, this.local);
    this.put(wheel, this.world, level);
  }
  putState(wheel: number, state: A33State, anchor: T.Matrix4, level: A33Level) {
    const half = a33HalfWidth(wheel);
    const preset = source.states[state];
    if (!preset) throw new Error('Invalid A33 handling state');
    this.position.fromArray(preset.position);
    if (state === 'storedHorizontal') this.position.y = half + 0.003;
    this.rotation.setFromAxisAngle(Z, preset.rotation[2]);
    this.local.compose(this.position, this.rotation, UNIT);
    this.world.multiplyMatrices(anchor, this.local);
    this.put(wheel, this.world, level);
  }
  finish() {
    for (const batch of this.batches) {
      batch.instanceMatrix.clearUpdateRanges();
      if (!batch.count) continue;
      batch.instanceMatrix.addUpdateRange(0, batch.count * 16);
      batch.instanceMatrix.needsUpdate = true;
      batch.morphTexture!.needsUpdate = true;
    }
  }
  diagnostics() {
    return {
      assetId: 'A33',
      revision: A33.revision,
      finalArtApproved: false,
      instances: this.wheelCount,
      capacity: this.capacity,
      activeBatches: this.batches.filter((b) => b.count > 0).length,
      lodCounts: this.batches.map((b) => b.count),
      triangles: this.batches.reduce(
        (n, b, i) => n + b.count * A33.trianglesPerWheel[i as A33Level],
        0,
      ),
      atlasBytes: source.atlas.width * source.atlas.height * 8,
    };
  }
  /** Attached geometry/materials belong to the renderer's deduplicated traversal.
   * Standalone owners use disposeDetached; repeated calls do not double-release. */
  disposeDetached() {
    if (this.ended) return;
    this.ended = true;
    for (const batch of this.batches) {
      batch.dispose();
      batch.geometry.dispose();
    }
    this.material.dispose();
    this.normal.dispose();
    this.orm.dispose();
  }
}

/** Rigid scenery fixture using A22's placement sockets without moving the bay,
 * changing collision geometry or introducing a second wheel-inventory system. */
export class A33GarageStorage {
  readonly root = new T.Group();
  readonly wheels = new A33WheelBatches(4);
  private readonly anchors = Array.from({ length: 4 }, () => new T.Matrix4());
  private readonly position = new T.Vector3();
  private level = -1;
  constructor(readonly garage: T.Group) {
    this.root.name = 'A33 garage spare-wheel storage';
    this.root.userData.a33Storage = true;
    this.wheels.material.userData.weatherExposure = 0; // authored garage shelter
    this.root.add(...this.wheels.batches);
    for (let i = 0; i < 4; i++) {
      const socket = garage.getObjectByName(`SOCKET_TYRE_${['FL', 'FR', 'RL', 'RR'][i]}`);
      if (!socket) throw new Error('Missing A22 wheel storage socket');
      // Socket is a garage-local ground datum. Add tyre radius/side support in putState.
      this.anchors[i].makeTranslation(socket.position.x, socket.position.y, socket.position.z);
    }
    garage.add(this.root);
    this.setDetail(0);
  }
  setDetail(level: A33Level) {
    if (this.level === level) return;
    this.level = level;
    this.wheels.begin();
    for (let i = 0; i < 4; i++) this.wheels.putState(i, 'storedHorizontal', this.anchors[i], level);
    this.wheels.finish();
  }
  update(camera: T.PerspectiveCamera) {
    this.root.getWorldPosition(this.position);
    const d = detailDistance(camera.position.distanceTo(this.position), camera.fov, camera.aspect);
    const near = this.level === 0 ? 22 : 18,
      far = this.level === 2 ? 48 : 58;
    this.setDetail(d < near ? 0 : d < far ? 1 : 2);
  }
}
