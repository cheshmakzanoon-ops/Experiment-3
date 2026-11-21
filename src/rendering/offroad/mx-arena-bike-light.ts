import * as T from 'three';
import { chainShaderHook, injectAfter, injectDeclarations } from '../studio/shader-hooks.ts';
import { MX_ARENA_LAMP_LINEAR, MX_ARENA_LIGHT, type MxArenaGrid } from './mx-arena-lighting.ts';
import { gateMxDetail, mxHighDetail } from './mx-quality.ts';

function normalizeBank(bank: T.Vector4) {
  const length = Math.hypot(bank.x, bank.y, bank.z);
  if (length > 0) bank.set(bank.x / length, bank.y / length, bank.z / length, bank.w);
}

/** The same roof lamps that light the dirt also illuminate the rider and its
 * moving hardware. A bike occupies only a small part of one pool. Evaluate
 * the 16 nearby lamps once per entrant, then shade its different surfaces
 * from six directional irradiances. Two energy-weighted roof banks resolve
 * separately on polished metal, clearcoat and goggles at high detail. */
export class MxArenaBikeLight {
  readonly positive = { value: new T.Vector3() };
  readonly negative = { value: new T.Vector3() };
  readonly key = { value: new T.Vector4() };
  readonly west = { value: new T.Vector4(0, 1, 0, 0) };
  readonly east = { value: new T.Vector4(0, 1, 0, 0) };
  private readonly roots = new WeakSet<T.Object3D>();
  private readonly direction = new T.Vector3();
  private lastGrid?: MxArenaGrid;
  private lastDetail = false;
  private readonly last = new T.Vector3(Infinity, Infinity, Infinity);

  update(grid: MxArenaGrid | undefined, position: T.Vector3) {
    const detailed = mxHighDetail();
    if (grid === this.lastGrid && detailed === this.lastDetail && this.last.equals(position))
      return;
    this.lastGrid = grid;
    this.lastDetail = detailed;
    this.last.copy(position);
    const plus = this.positive.value.set(0, 0, 0);
    const minus = this.negative.value.set(0, 0, 0);
    this.key.value.set(0, 1, 0, 0);
    const west = this.west.value.set(0, 0, 0, 0),
      east = this.east.value.set(0, 0, 0, 0);
    if (!grid) return;
    const cellX = grid.spanX / grid.columns,
      cellZ = grid.spanZ / grid.rows;
    const cx = (position.x - grid.minX) / cellX - 0.5,
      cz = (position.z - grid.minZ) / cellZ - 0.5;
    const ix = Math.floor(cx),
      iz = Math.floor(cz);
    let energy = 0;
    for (let z = Math.max(0, iz - 1); z <= Math.min(grid.rows - 1, iz + 2); z++) {
      for (let x = Math.max(0, ix - 1); x <= Math.min(grid.columns - 1, ix + 2); x++) {
        const reach =
          1 -
          T.MathUtils.smoothstep(
            Math.hypot(x - cx, z - cz),
            MX_ARENA_LIGHT.reachCells / 2,
            MX_ARENA_LIGHT.reachCells,
          );
        const dx = (x - cx) * cellX,
          dy = grid.y - position.y,
          dz = (z - cz) * cellZ;
        const r2 = dx * dx + dy * dy + dz * dz;
        if (!reach || r2 < 1) continue;
        const light = (MX_ARENA_LIGHT.intensity * reach) / r2;
        const gain = light / Math.sqrt(r2);
        plus.x += gain * Math.max(0, dx);
        minus.x += gain * Math.max(0, -dx);
        plus.y += gain * Math.max(0, dy);
        minus.y += gain * Math.max(0, -dy);
        plus.z += gain * Math.max(0, dz);
        minus.z += gain * Math.max(0, -dz);
        energy += light;
        if (detailed) {
          // Share a passing fixture gradually between the two banks. The
          // weights always sum to one, including directly under a fixture.
          const right = T.MathUtils.smoothstep(x - cx, -0.65, 0.65);
          const leftGain = gain * (1 - right),
            rightGain = gain * right;
          west.x += dx * leftGain;
          west.y += dy * leftGain;
          west.z += dz * leftGain;
          west.w += light * (1 - right);
          east.x += dx * rightGain;
          east.y += dy * rightGain;
          east.z += dz * rightGain;
          east.w += light * right;
        }
      }
    }
    this.direction.subVectors(plus, minus).normalize();
    this.key.value.set(this.direction.x, this.direction.y, this.direction.z, energy);
    if (detailed) {
      normalizeBank(west);
      normalizeBank(east);
    }
  }

  bind(root: T.Object3D) {
    if (this.roots.has(root)) return;
    this.roots.add(root);
    root.traverse((object) => {
      if (!(object instanceof T.Mesh)) return;
      for (const material of Array.isArray(object.material) ? object.material : [object.material]) {
        if (
          !(material instanceof T.MeshStandardMaterial) ||
          material.transparent ||
          (material instanceof T.MeshPhysicalMaterial && material.transmission > 0)
        )
          continue;
        gateMxDetail(material);
        chainShaderHook(material, 'mx-arena-bike-light-v2', (shader) => {
          shader.uniforms.mxBikeRoofPos = this.positive;
          shader.uniforms.mxBikeRoofNeg = this.negative;
          shader.uniforms.mxBikeRoofKey = this.key;
          shader.uniforms.mxBikeRoofWest = this.west;
          shader.uniforms.mxBikeRoofEast = this.east;
          shader.uniforms.mxBikeRoofColour = { value: MX_ARENA_LAMP_LINEAR };
          injectDeclarations(
            shader,
            'common',
            'uniform vec3 mxBikeRoofPos, mxBikeRoofNeg, mxBikeRoofColour; uniform vec4 mxBikeRoofKey, mxBikeRoofWest, mxBikeRoofEast;',
            'fragment',
          );
          injectAfter(
            shader,
            'lights_fragment_end',
            /* glsl */ `
if (mxBikeRoofKey.w > 0.0) {
  vec3 mxN = inverseTransformDirection(normal, viewMatrix);
  vec3 sides = mix(mxBikeRoofNeg, mxBikeRoofPos, step(vec3(0.0), mxN));
  float diffuseFlux = dot(mxN * mxN, sides);
  reflectedLight.directDiffuse = reflectedLight.directDiffuse * ${MX_ARENA_LIGHT.keyShare.toFixed(2)}
    + mxBikeRoofColour * diffuseFlux * BRDF_Lambert(material.diffuseColor);
  PhysicalMaterial roofMaterial = material;
  #ifdef MX_HIGH_DETAIL
  roofMaterial.roughness = max(roofMaterial.roughness, 0.245);
  #ifdef USE_CLEARCOAT
  roofMaterial.clearcoatRoughness = max(roofMaterial.clearcoatRoughness, 0.25);
  #endif
  for (int bank = 0; bank < 2; ++bank) {
    vec4 source = bank == 0 ? mxBikeRoofWest : mxBikeRoofEast;
    if (source.w > 0.0) {
      vec3 lamp = mat3(viewMatrix) * source.xyz;
      vec3 flux = mxBikeRoofColour * (0.15 * source.w);
      reflectedLight.directSpecular += flux * saturate(dot(normal, lamp))
        * BRDF_GGX(lamp, geometryViewDir, normal, roofMaterial);
      #ifdef USE_CLEARCOAT
      clearcoatSpecularDirect += flux * saturate(dot(geometryClearcoatNormal, lamp))
        * BRDF_GGX_Clearcoat(lamp, geometryViewDir, geometryClearcoatNormal, roofMaterial);
      #endif
    }
  }
  #else
  vec3 lamp = mat3(viewMatrix) * mxBikeRoofKey.xyz;
  roofMaterial.roughness = max(roofMaterial.roughness, 0.31);
  reflectedLight.directSpecular += mxBikeRoofColour * (0.15 * mxBikeRoofKey.w * saturate(dot(normal, lamp)))
    * BRDF_GGX(lamp, geometryViewDir, normal, roofMaterial);
  #endif
}`,
            'fragment',
          );
        });
      }
    });
  }
}
