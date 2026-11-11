import * as T from 'three';
import { chainShaderHook, injectAfter, injectDeclarations } from './studio/shader-hooks.ts';

/** Bike-space ambient and specular occlusion for the GP prototypes.
 *
 * The rest-pose machine (bodywork, frame, engine, wheels, fork and swingarm;
 * not the rider, who moves through it) is rasterised once per definition into
 * a binary occupancy grid in the sprung frame. The GPU box-filters it into a
 * mip pyramid, and every bike and rider fragment cone-traces that pyramid:
 * five short cones around the normal for the hemisphere (indirect diffuse,
 * sheen) and one along the mirror direction (environment specular, clear
 * coat). Crevices under the tank, inside the fairing ducts, between the fork
 * legs and the wheel, under the seat and behind the swingarm stop reflecting
 * the open sky; open panels are untouched. Direct sunlight keeps its own
 * shadow maps, and a rider moving off the bike leaves the occluded volume.
 *
 * The rider moves through that volume, so he is not in it. He enters as a
 * handful of analytic capsules instead (torso, head, arms, thighs, shins:
 * `GP_CAPSULES`), refreshed from his bones each frame. Their sphere-occlusion
 * term darkens the seat and tank under him and the cockpit around his arms,
 * and his own armpits, inner elbows, knees and chin-to-chest creases, where
 * his segments close on each other. A fragment on a convex capsule faces away
 * from its own axis and sees nothing of it.
 *
 * Cost: a few cached megabytes of R8 texels per definition, about twenty
 * trilinear 3D fetches and 2 x 10 capsule terms per bike fragment, and
 * nothing at all below the High tier (the strength uniforms are zero and the
 * branch is skipped). */
export const GP_OCCLUSION = Object.freeze({
  /** Finest cell edge (m). Taps start 1.5 cells off the surface at each level. */
  voxel: 0.02,
  /** Empty border (m) so every tap that leaves the machine reads open air. */
  margin: 0.36,
  /** Upper bound on cells per axis: a stray far-off mesh must not explode the grid. */
  maxCells: 192,
  /** Fraction of indirect diffuse removed at full occlusion. */
  diffuse: 0.82,
  /** Fraction of environment specular (and clear coat) removed at full occlusion. */
  specular: 0.9,
  /** Share of the rider capsules' sphere occlusion applied (0 disables them). */
  rider: 0.85,
});
/** Capsule occluders for the rider: torso, head, two upper arms, two forearms,
 * two thighs and two shins. Unused slots carry radius 0. */
export const GP_CAPSULES = 10;

export interface GpOcclusionSource {
  readonly geometry: T.BufferGeometry;
  /** Geometry space to occlusion (sprung) frame. */
  readonly matrix: T.Matrix4;
}
export interface GpOcclusionGrid {
  /** 255 where a surface passes through the cell; x fastest, then y, then z. */
  readonly data: Uint8Array;
  readonly dims: readonly [number, number, number];
  /** Frame-space corner of cell (0,0,0) (m). */
  readonly min: T.Vector3;
  readonly voxel: number;
  readonly filled: number;
}

/** Every opaque, visible mesh below `root` (instances expanded), expressed in
 * `frame` space. Subtrees in `skip` (the rider) are left out. */
export function gpOcclusionSources(
  root: T.Object3D,
  frame: T.Object3D,
  skip: readonly T.Object3D[] = [],
): GpOcclusionSource[] {
  root.updateWorldMatrix(true, true);
  frame.updateWorldMatrix(true, false);
  const toFrame = frame.matrixWorld.clone().invert(),
    instance = new T.Matrix4(),
    out: GpOcclusionSource[] = [];
  const opaque = (m: T.Material) => m.visible && !m.transparent && m.colorWrite;
  const visit = (o: T.Object3D) => {
    // The root itself may be a hidden level of detail; its parts still count.
    if ((o !== root && !o.visible) || skip.includes(o)) return;
    if (
      o instanceof T.Mesh &&
      !(o instanceof T.SkinnedMesh) &&
      (Array.isArray(o.material) ? o.material.every(opaque) : opaque(o.material)) &&
      o.geometry.getAttribute('position')
    ) {
      const base = toFrame.clone().multiply(o.matrixWorld);
      if (o instanceof T.InstancedMesh)
        for (let k = 0; k < o.count; k++) {
          o.getMatrixAt(k, instance);
          out.push({ geometry: o.geometry, matrix: base.clone().multiply(instance) });
        }
      else out.push({ geometry: o.geometry, matrix: base });
    }
    for (const child of o.children) visit(child);
  };
  visit(root);
  return out;
}

/** Conservative surface rasterisation: each triangle is sampled on a
 * barycentric lattice finer than half a cell, so no surface crossing a cell
 * is missed and thin shells (fairings, guards) become closed cell layers. */
export function voxelizeGpOcclusion(
  sources: readonly GpOcclusionSource[],
  voxel: number = GP_OCCLUSION.voxel,
  margin: number = GP_OCCLUSION.margin,
): GpOcclusionGrid {
  if (!(voxel > 0) || !(margin >= 0)) throw new RangeError('Invalid GP occlusion grid');
  const box = new T.Box3(),
    part = new T.Box3();
  for (const { geometry, matrix } of sources) {
    if (!geometry.boundingBox) geometry.computeBoundingBox();
    if (geometry.boundingBox!.isEmpty()) continue;
    box.union(part.copy(geometry.boundingBox!).applyMatrix4(matrix));
  }
  if (box.isEmpty()) throw new Error('GP occlusion has no geometry');
  box.expandByScalar(margin);
  const size = box.getSize(new T.Vector3());
  // Tolerate float32 position noise on exact multiples (30.0000003 cells is
  // 30); the empty margin already pads every surface.
  const nx = Math.ceil(size.x / voxel - 1e-4),
    ny = Math.ceil(size.y / voxel - 1e-4),
    nz = Math.ceil(size.z / voxel - 1e-4);
  if (Math.max(nx, ny, nz) > GP_OCCLUSION.maxCells)
    throw new RangeError('GP occlusion bounds exceed the machine envelope');
  const data = new Uint8Array(nx * ny * nz),
    min = box.min.clone(),
    a = new T.Vector3(),
    b = new T.Vector3(),
    c = new T.Vector3(),
    step = voxel * 0.5;
  let filled = 0;
  const mark = (x: number, y: number, z: number) => {
    const i = Math.floor((x - min.x) / voxel),
      j = Math.floor((y - min.y) / voxel),
      k = Math.floor((z - min.z) / voxel);
    if (i < 0 || j < 0 || k < 0 || i >= nx || j >= ny || k >= nz) return;
    const at = i + nx * (j + ny * k);
    if (!data[at]) {
      data[at] = 255;
      filled++;
    }
  };
  for (const { geometry, matrix } of sources) {
    const p = geometry.getAttribute('position'),
      index = geometry.getIndex(),
      count = index ? index.count : p.count;
    for (let t = 0; t + 2 < count; t += 3) {
      const ia = index ? index.getX(t) : t,
        ib = index ? index.getX(t + 1) : t + 1,
        ic = index ? index.getX(t + 2) : t + 2;
      a.fromBufferAttribute(p, ia).applyMatrix4(matrix);
      b.fromBufferAttribute(p, ib).applyMatrix4(matrix);
      c.fromBufferAttribute(p, ic).applyMatrix4(matrix);
      const longest = Math.max(a.distanceTo(b), b.distanceTo(c), c.distanceTo(a));
      if (!Number.isFinite(longest)) continue;
      const n = Math.max(1, Math.ceil(longest / step));
      const ux = (b.x - a.x) / n,
        uy = (b.y - a.y) / n,
        uz = (b.z - a.z) / n,
        vx = (c.x - a.x) / n,
        vy = (c.y - a.y) / n,
        vz = (c.z - a.z) / n;
      for (let i = 0; i <= n; i++)
        for (let j = 0; j <= n - i; j++)
          mark(a.x + ux * i + vx * j, a.y + uy * i + vy * j, a.z + uz * i + vz * j);
    }
  }
  return { data, dims: [nx, ny, nz], min, voxel, filled };
}

/** Linear R8 occupancy with a GPU-built trilinear mip pyramid. */
export function gpOcclusionTexture(grid: GpOcclusionGrid): T.Data3DTexture {
  const [nx, ny, nz] = grid.dims;
  const texture = new T.Data3DTexture(grid.data, nx, ny, nz);
  texture.name = 'GP bike-space occlusion (R8 occupancy)';
  texture.format = T.RedFormat;
  texture.type = T.UnsignedByteType;
  texture.colorSpace = T.NoColorSpace;
  texture.wrapS = texture.wrapT = texture.wrapR = T.ClampToEdgeWrapping;
  texture.magFilter = T.LinearFilter;
  texture.minFilter = T.LinearMipmapLinearFilter;
  texture.generateMipmaps = true;
  texture.unpackAlignment = 1;
  texture.needsUpdate = true;
  return texture;
}

export interface GpOcclusionUniforms {
  readonly gpOccVolume: T.IUniform<T.Data3DTexture | null>;
  /** World to occlusion (sprung) frame, refreshed each presented frame. */
  readonly gpOccFromWorld: T.IUniform<T.Matrix4>;
  readonly gpOccMin: T.IUniform<T.Vector3>;
  readonly gpOccInvSize: T.IUniform<T.Vector3>;
  /** x: diffuse strength, y: specular strength (0 disables), z: finest cell (m). */
  readonly gpOccParams: T.IUniform<T.Vector3>;
  /** Rider capsules in the occlusion frame: xyz one end, w radius (0 = unused) / xyz the other end. */
  readonly gpCapA: T.IUniform<T.Vector4[]>;
  readonly gpCapB: T.IUniform<T.Vector4[]>;
  /** Strength of the capsule term (0 disables). */
  readonly gpCapStrength: T.IUniform<number>;
}
/** One set per entrant, shared by all of its bike and rider materials. */
export function gpOcclusionUniforms(): GpOcclusionUniforms {
  return {
    gpOccVolume: { value: null },
    gpOccFromWorld: { value: new T.Matrix4() },
    gpOccMin: { value: new T.Vector3() },
    gpOccInvSize: { value: new T.Vector3(1, 1, 1) },
    gpOccParams: { value: new T.Vector3(0, 0, GP_OCCLUSION.voxel) },
    gpCapA: { value: Array.from({ length: GP_CAPSULES }, () => new T.Vector4(0, 0, 0, 0)) },
    gpCapB: { value: Array.from({ length: GP_CAPSULES }, () => new T.Vector4(0, 0, 0, 0)) },
    gpCapStrength: { value: 0 },
  };
}
/** Point an entrant's uniforms at a baked volume (still disabled until
 * `setGpOcclusionStrength` turns it on for the High tier). */
export function bindGpOcclusion(uniforms: GpOcclusionUniforms, volume: GpOcclusionVolume) {
  const [nx, ny, nz] = volume.grid.dims,
    v = volume.grid.voxel;
  uniforms.gpOccVolume.value = volume.texture;
  uniforms.gpOccMin.value.copy(volume.grid.min);
  uniforms.gpOccInvSize.value.set(1 / (nx * v), 1 / (ny * v), 1 / (nz * v));
  uniforms.gpOccParams.value.z = v;
}
export function setGpOcclusionStrength(uniforms: GpOcclusionUniforms, enabled: boolean) {
  const on = enabled && uniforms.gpOccVolume.value !== null;
  uniforms.gpOccParams.value.x = on ? GP_OCCLUSION.diffuse : 0;
  uniforms.gpOccParams.value.y = on ? GP_OCCLUSION.specular : 0;
  uniforms.gpCapStrength.value = on ? GP_OCCLUSION.rider : 0;
}
/** Write one rider capsule (slot `i`) in the occlusion frame. A radius of 0
 * retires the slot. */
export function setGpCapsule(
  uniforms: GpOcclusionUniforms,
  i: number,
  a: T.Vector3,
  b: T.Vector3,
  radius: number,
) {
  uniforms.gpCapA.value[i].set(a.x, a.y, a.z, radius);
  uniforms.gpCapB.value[i].set(b.x, b.y, b.z, 0);
}

/** CPU reference of the shader's capsule term (`gpCapsules`): the share of the
 * cosine-weighted hemisphere about `dir` hidden by the capsules at point `p`
 * (all in the occlusion frame). Each capsule counts as a ball of its radius at
 * the closest point of its axis: coverage is cos * r^2 / d^2, saturating inside
 * the skin, and the open fractions multiply. */
export function gpCapsuleOcclusion(
  p: T.Vector3,
  dir: T.Vector3,
  uniforms: Pick<GpOcclusionUniforms, 'gpCapA' | 'gpCapB' | 'gpCapStrength'>,
): number {
  const strength = uniforms.gpCapStrength.value,
    ab = new T.Vector3(),
    d = new T.Vector3();
  let open = 1;
  for (let i = 0; i < GP_CAPSULES; i++) {
    const a = uniforms.gpCapA.value[i],
      r = a.w;
    if (r <= 0) continue;
    const b = uniforms.gpCapB.value[i];
    ab.set(b.x - a.x, b.y - a.y, b.z - a.z);
    const t = Math.min(
      1,
      Math.max(0, d.set(p.x - a.x, p.y - a.y, p.z - a.z).dot(ab) / Math.max(ab.lengthSq(), 1e-6)),
    );
    d.set(a.x + ab.x * t - p.x, a.y + ab.y * t - p.y, a.z + ab.z * t - p.z);
    const dd = Math.max(d.lengthSq(), r * r),
      facing = Math.min(1, Math.max(0, dir.dot(d) / Math.sqrt(dd)));
    open *= 1 - (strength * facing * r * r) / dd;
  }
  return 1 - open;
}

/** The cone trace. Tap i sits 1.5 cells of mip i off the surface (so a flat
 * open panel never sees its own cell layer) and doubles in distance and cell
 * size: 3, 6, 12 and 24 cm. Each tap's occupancy is converted to the
 * transmittance across a coarse cell of 2^i fine cells. */
export const GP_OCCLUSION_GLSL = /* glsl */ `
uniform highp sampler3D gpOccVolume;
uniform mat4 gpOccFromWorld;
uniform vec3 gpOccMin;
uniform vec3 gpOccInvSize;
uniform vec3 gpOccParams;
uniform vec4 gpCapA[ ${GP_CAPSULES} ];
uniform vec4 gpCapB[ ${GP_CAPSULES} ];
uniform float gpCapStrength;
varying vec3 vGpOccPos;
// Sphere occlusion at the closest point of each capsule axis: the share of the
// cosine-weighted hemisphere about dir that a ball of radius r at distance
// d covers is about cos * r^2 / d^2; fragments inside the skin saturate.
float gpCapsules( vec3 p, vec3 dir ) {
  float open = 1.0;
  for ( int i = 0; i < ${GP_CAPSULES}; i ++ ) {
    float r = gpCapA[ i ].w;
    if ( r <= 0.0 ) continue;
    vec3 a = gpCapA[ i ].xyz;
    vec3 ab = gpCapB[ i ].xyz - a;
    float t = clamp( dot( p - a, ab ) / max( dot( ab, ab ), 1e-6 ), 0.0, 1.0 );
    vec3 d = a + ab * t - p;
    float dd = max( dot( d, d ), r * r );
    float facing = clamp( dot( dir, d ) * inversesqrt( dd ), 0.0, 1.0 );
    open *= 1.0 - gpCapStrength * facing * ( r * r ) / dd;
  }
  return 1.0 - open;
}
float gpOccCone( vec3 p, vec3 n, vec3 dir, int taps ) {
  float open = 1.0;
  float cell = gpOccParams.z;
  float d = 1.5 * cell;
  float along = dot( dir, n );
  for ( int i = 0; i < 4; i ++ ) {
    if ( i >= taps ) break;
    // Keep every tap at least 1.5 of its own cells above the surface plane,
    // also for the tilted cones, so an open panel never samples itself.
    vec3 q = p + dir * d + n * max( 0.0, 1.5 * cell - along * d );
    float rho = textureLod( gpOccVolume, ( q - gpOccMin ) * gpOccInvSize, float( i ) ).r;
    open *= pow( max( 1.0 - rho, 0.0 ), exp2( float( i ) ) );
    d *= 2.0;
    cell *= 2.0;
  }
  return 1.0 - open;
}`;
const VERTEX = /* glsl */ `
{
  vec4 gpOccP = vec4( transformed, 1.0 );
  #ifdef USE_BATCHING
    gpOccP = batchingMatrix * gpOccP;
  #endif
  #ifdef USE_INSTANCING
    gpOccP = instanceMatrix * gpOccP;
  #endif
  vGpOccPos = ( gpOccFromWorld * ( modelMatrix * gpOccP ) ).xyz;
}
`;
const FRAGMENT = /* glsl */ `
float gpOccDiffuse = 1.0, gpOccMirror = 1.0;
if ( gpOccParams.x + gpOccParams.y > 0.0 ) {
  mat3 gpOccRot = mat3( gpOccFromWorld );
  vec3 gpOccN = normalize( gpOccRot * inverseTransformDirection( geometryNormal, viewMatrix ) );
  vec3 gpOccV = normalize( gpOccRot * inverseTransformDirection( geometryViewDir, viewMatrix ) );
  vec3 gpOccT = normalize( cross( abs( gpOccN.y ) < 0.9 ? vec3( 0.0, 1.0, 0.0 ) : vec3( 1.0, 0.0, 0.0 ), gpOccN ) );
  vec3 gpOccB = cross( gpOccN, gpOccT );
  // Cosine-weighted hemisphere: one cone on the normal, four at ~55 degrees.
  float gpOcc = 0.36 * gpOccCone( vGpOccPos, gpOccN, gpOccN, 4 );
  gpOcc += 0.16 * gpOccCone( vGpOccPos, gpOccN, normalize( gpOccN + 1.4 * gpOccT ), 3 );
  gpOcc += 0.16 * gpOccCone( vGpOccPos, gpOccN, normalize( gpOccN - 1.4 * gpOccT ), 3 );
  gpOcc += 0.16 * gpOccCone( vGpOccPos, gpOccN, normalize( gpOccN + 1.4 * gpOccB ), 3 );
  gpOcc += 0.16 * gpOccCone( vGpOccPos, gpOccN, normalize( gpOccN - 1.4 * gpOccB ), 3 );
  float gpOccCap = gpCapStrength > 0.0 ? gpCapsules( vGpOccPos, gpOccN ) : 0.0;
  gpOcc = 1.0 - ( 1.0 - gpOcc ) * ( 1.0 - gpOccCap );
  gpOccDiffuse = 1.0 - gpOccParams.x * gpOcc;
  reflectedLight.indirectDiffuse *= gpOccDiffuse;
  #ifdef USE_SHEEN
    sheenSpecularIndirect *= gpOccDiffuse;
  #endif
  // Specular occlusion along the mirror direction; rough lobes widen toward
  // the hemisphere estimate.
  vec3 gpOccRefl = reflect( - gpOccV, gpOccN );
  float gpOccR = gpOccCone( vGpOccPos, gpOccN, gpOccRefl, 4 );
  if ( gpCapStrength > 0.0 ) gpOccR = 1.0 - ( 1.0 - gpOccR ) * ( 1.0 - gpCapsules( vGpOccPos, gpOccRefl ) );
  gpOccMirror = 1.0 - gpOccParams.y * gpOccR;
  reflectedLight.indirectSpecular *= 1.0 - gpOccParams.y * mix( gpOccR, gpOcc, material.roughness );
  #ifdef USE_CLEARCOAT
    clearcoatSpecularIndirect *= gpOccMirror;
  #endif
}
`;
/** Chain the occlusion onto one lit (standard/physical) material. */
export function installGpOcclusion(material: T.Material, uniforms: GpOcclusionUniforms): boolean {
  if (!(material instanceof T.MeshStandardMaterial))
    throw new TypeError('GP occlusion needs a standard or physical material');
  return chainShaderHook(material, 'gp-occlusion-v1', (shader) => {
    Object.assign(shader.uniforms, uniforms);
    injectDeclarations(
      shader,
      'common',
      'uniform mat4 gpOccFromWorld; varying vec3 vGpOccPos;',
      'vertex',
    );
    injectAfter(shader, 'project_vertex', VERTEX, 'vertex');
    injectDeclarations(shader, 'common', GP_OCCLUSION_GLSL, 'fragment');
    injectAfter(shader, 'aomap_fragment', FRAGMENT, 'fragment');
  });
}

export interface GpOcclusionVolume {
  readonly grid: GpOcclusionGrid;
  readonly texture: T.Data3DTexture;
}
interface CacheEntry {
  volume: GpOcclusionVolume;
  users: number;
}
const cache = new Map<string, CacheEntry>();
/** One baked volume per GP definition, shared by every entrant on it and
 * released with the last of them. `bake` runs only on a cache miss. */
export function acquireGpOcclusion(key: string, bake: () => GpOcclusionGrid): GpOcclusionVolume {
  let entry = cache.get(key);
  if (!entry) {
    const grid = bake();
    entry = { volume: { grid, texture: gpOcclusionTexture(grid) }, users: 0 };
    cache.set(key, entry);
  }
  entry.users++;
  return entry.volume;
}
export function releaseGpOcclusion(key: string) {
  const entry = cache.get(key);
  if (!entry) return;
  if (--entry.users > 0) return;
  entry.volume.texture.dispose();
  cache.delete(key);
}
/** Live cached volumes (for resource accounting in tests). */
export function gpOcclusionCacheSize() {
  return cache.size;
}
