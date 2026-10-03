import * as T from 'three';
import source from './start-finish.geometry.json' with { type: 'json' };
import manifest from './start-finish.manifest.json' with { type: 'json' };

export const START_FINISH_ASSET = Object.freeze({ ...manifest, finalArtApproved: false });
export type VenueTier = 'near' | 'mid' | 'far';
export type VenueMesh = keyof typeof source.meshes;
interface AssetMesh {
  position: number[];
  normal: number[];
  index: number[];
  color: number[];
  uv: number[];
  material: string;
  crowdJoint?: number[];
  skinMask?: number[];
  accessory?: number[];
  standing?: number[];
  standingNormal?: number[];
}
let verified = false;
export function verifyStartFinish() {
  if (verified) return;
  if (source.version !== 1 || source.units !== 'metres-Y-up')
    throw new Error('Invalid venue asset');
  for (const [name, data] of Object.entries(source.meshes) as [VenueMesh, AssetMesh][]) {
    const n = data.position.length / 3;
    if (
      !Number.isInteger(n) ||
      n < 3 ||
      n > 20000 ||
      data.index.length !== manifest.triangles[name] * 3
    )
      throw new Error(`Invalid venue topology: ${name}`);
    for (const [values, size] of [
      [data.normal, 3],
      [data.color, 3],
      [data.uv, 2],
    ] as const)
      if (values.length !== n * size) throw new Error(`Invalid venue attribute: ${name}`);
    for (const values of Object.values(data))
      if (Array.isArray(values) && !values.every(Number.isFinite))
        throw new Error('Nonfinite venue data');
    if (data.index.some((i) => !Number.isInteger(i) || i < 0 || i >= n))
      throw new Error('Invalid venue index');
  }
  for (const clip of Object.values(source.clips)) {
    if (clip.frames.length !== clip.duration * clip.fps + 1)
      throw new Error('Invalid audience clip');
    for (const frame of clip.frames)
      if (frame.length !== 16 || !frame.every(Number.isFinite))
        throw new Error('Invalid audience pose');
  }
  verified = true;
}
/** Owned buffers, with matching reflected winding. No negative instance scales. */
export function venueGeometry(name: VenueMesh, mirror = false) {
  verifyStartFinish();
  const data: AssetMesh = source.meshes[name];
  const g = new T.BufferGeometry();
  for (const [key, values, size] of [
    ['position', data.position, 3],
    ['normal', data.normal, 3],
    ['uv', data.uv, 2],
    ['color', data.color, 3],
    ['standingPosition', data.standing, 3],
    ['standingNormal', data.standingNormal, 3],
  ] as const)
    if (values) g.setAttribute(key, new T.Float32BufferAttribute(values, size));
  g.setIndex(data.index);
  if (data.crowdJoint && data.skinMask && data.accessory) {
    const packed = new Float32Array(data.crowdJoint.length * 3);
    for (let i = 0; i < data.crowdJoint.length; i++)
      packed.set([data.crowdJoint[i], data.skinMask[i], data.accessory[i]], i * 3);
    g.setAttribute('crowdPerson', new T.BufferAttribute(packed, 3));
  }
  if (mirror) {
    g.scale(-1, 1, 1);
    for (const name of ['standingPosition', 'standingNormal']) {
      const attribute = g.getAttribute(name);
      if (attribute)
        for (let i = 0; i < attribute.count; i++) attribute.setX(i, -attribute.getX(i));
    }
    for (let i = 0; i < g.index!.count; i += 3) {
      const b = g.index!.getX(i + 1);
      g.index!.setX(i + 1, g.index!.getX(i + 2));
      g.index!.setX(i + 2, b);
    }
  }
  g.name = name;
  g.userData.authoredAsset = 'start-finish';
  g.computeBoundingBox();
  g.computeBoundingSphere();
  if (data.standing) {
    const p = new T.Vector3();
    const a = g.getAttribute('standingPosition');
    for (let i = 0; i < a.count; i++) g.boundingBox!.expandByPoint(p.fromBufferAttribute(a, i));
    g.boundingBox!.getBoundingSphere(g.boundingSphere!);
  }
  return g;
}
export function audienceGeometry(level: 0 | 1, family: number) {
  if (!Number.isInteger(family) || family < 0 || family > 3)
    throw new Error('Invalid audience family');
  return venueGeometry(`spectator_${family}_${level}` as VenueMesh);
}
/** 4 bones x 121 samples x 4 actions; immutable, nearest sampled quaternion atlas. */
export function audienceAtlas() {
  verifyStartFinish();
  const data = new Float32Array(4 * 121 * 4 * 4);
  Object.values(source.clips).forEach((clip, action) =>
    clip.frames.forEach((frame, i) => data.set(frame, (action * 121 + i) * 16)),
  );
  const texture = new T.DataTexture(data, 4, 484, T.RGBAFormat, T.FloatType);
  texture.minFilter = texture.magFilter = T.NearestFilter;
  texture.generateMipmaps = false;
  texture.needsUpdate = true;
  texture.name = 'Four evaluated Blender audience actions';
  return texture;
}
export function marshalAction(time: number, waving: boolean, out: T.Vector2) {
  if (!Number.isFinite(time)) throw new Error('Invalid marshal action time');
  const clip = source.marshal[waving ? 'marshal_flag' : 'marshal_watch'];
  const f = (((time % 4) + 4) % 4) * 30,
    i = Math.floor(f),
    u = f - i;
  return out.set(
    clip.frames[i][0] + (clip.frames[i + 1][0] - clip.frames[i][0]) * u,
    clip.frames[i][1] + (clip.frames[i + 1][1] - clip.frames[i][1]) * u,
  );
}
