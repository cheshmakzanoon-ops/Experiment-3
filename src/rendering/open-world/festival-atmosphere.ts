import * as T from 'three';
import { clamp } from '../../core/math.ts';
import { lightingDirection, type LightingMode } from '../daylight.ts';
import {
  AERIAL_PERSPECTIVE,
  AERIAL_PERSPECTIVE_FRAGMENT,
  AERIAL_PERSPECTIVE_PARS,
  createAerialUniforms,
  setAerialExtinction,
  setAerialPerspective,
  useAerialUniforms,
  type AerialPalette,
} from '../studio/aerial-perspective.ts';
import { chainShaderHook, injectAfter } from '../studio/shader-hooks.ts';

/** Reference 029's hazy valley below clear foreground trees, and the receding
 * blue ridges in 032/036/044. This is a regional aerosol layer, not a cloud
 * volume: it reuses the sky's spectral extinction and analytic ray integral. */
export const FESTIVAL_ATMOSPHERE = Object.freeze({
  /** Fair-weather aerosol scale height above the region's sea datum, metres. */
  scaleHeight: 420,
  /** A closed wet deck occupies a deeper layer than clear coastal air. */
  wetScaleHeight: AERIAL_PERSPECTIVE.scaleHeight,
});

/** Festival-owned aerial uniforms and material hooks. No render pass, texture,
 * random noise or clock; one closed-form fog integral per visible fragment.
 * Cached catalogue car materials, the HUD and guidance are deliberately not
 * installed by FestivalRenderer. Other venues keep their own atmosphere. */
export class FestivalAtmosphere {
  readonly uniforms = createAerialUniforms();
  readonly sunDirection: T.IUniform<T.Vector3> = { value: new T.Vector3() };
  private readonly watched = new Set<T.Object3D>();
  private readonly childAdded = ({ child }: { child: T.Object3D }) => this.install(child);

  constructor(seaLevel: number) {
    if (!Number.isFinite(seaLevel)) throw new Error('Invalid festival atmosphere datum');
    this.uniforms.apexAerialFalloff.value.set(seaLevel, 1 / FESTIVAL_ATMOSPHERE.scaleHeight);
    this.sunDirection.value.copy(lightingDirection('day')).normalize();
  }

  /** Read the same presented cover, rain and sky palette as the scene lights.
   * Rain deepens the layer so highland roads do not become clear in a storm. */
  update(haze: number, cover: number, rain: number, mode: LightingMode, palette?: AerialPalette) {
    const depth = Math.max(clamp(cover, 0, 1) * 0.65, clamp(rain / 24, 0, 1));
    this.uniforms.apexAerialFalloff.value.y =
      1 /
      (FESTIVAL_ATMOSPHERE.scaleHeight +
        (FESTIVAL_ATMOSPHERE.wetScaleHeight - FESTIVAL_ATMOSPHERE.scaleHeight) * depth);
    setAerialExtinction(haze, rain, this.uniforms);
    setAerialPerspective(cover, mode, this.uniforms, palette);
    this.sunDirection.value.copy(lightingDirection(mode)).normalize();
  }

  install(root: T.Object3D) {
    root.traverse((node) => {
      if (!(node instanceof T.Mesh)) return;
      for (const material of Array.isArray(node.material) ? node.material : [node.material])
        this.installMaterial(material);
    });
  }

  /** Streamers attach complete tile subtrees. Inspect only new subtrees when
   * they arrive, rather than walking all resident vegetation every frame. */
  watch(root: T.Object3D) {
    if (this.watched.has(root)) return;
    this.install(root);
    root.addEventListener('childadded', this.childAdded);
    this.watched.add(root);
  }

  installMaterial(material: T.Material) {
    if (
      !(
        material instanceof T.MeshStandardMaterial ||
        material instanceof T.MeshLambertMaterial ||
        material instanceof T.MeshPhongMaterial
      ) ||
      !material.fog
    )
      return false;
    return chainShaderHook(material, 'festival-atmosphere-v1', (shader) => {
      // A caller can supply a material already owned by LocalAtmosphere. Its
      // existing integral must keep its uniforms and must never run twice.
      if (shader.fragmentShader.includes('vec3 apexAerialPerspective(')) return;
      useAerialUniforms(shader, this.uniforms);
      // Bind local direction without mutating studioFrame's shared object.
      shader.uniforms.studioSunDir = this.sunDirection;
      const varying = '#ifdef USE_FOG\nvarying vec3 vApexFogWorld;\n#endif';
      injectAfter(shader, 'fog_pars_vertex', varying, 'vertex');
      injectAfter(
        shader,
        'fog_vertex',
        `#ifdef USE_FOG
vec4 festivalFogPosition = vec4(transformed, 1.0);
#ifdef USE_BATCHING
festivalFogPosition = batchingMatrix * festivalFogPosition;
#endif
#ifdef USE_INSTANCING
festivalFogPosition = instanceMatrix * festivalFogPosition;
#endif
vApexFogWorld = (modelMatrix * festivalFogPosition).xyz;
#endif`,
        'vertex',
      );
      injectAfter(
        shader,
        'fog_pars_fragment',
        `${varying}\n${AERIAL_PERSPECTIVE_PARS}`,
        'fragment',
      );
      shader.fragmentShader = shader.fragmentShader.replace(
        '#include <fog_fragment>',
        AERIAL_PERSPECTIVE_FRAGMENT,
      );
    });
  }

  dispose() {
    for (const root of this.watched) root.removeEventListener('childadded', this.childAdded);
    this.watched.clear();
  }
}
