import * as T from 'three';

/** Shadow intensity that marks the far light. Its map is sampled for the sun
 * (directional light 0) and it adds no light itself; any other second
 * shadowed directional light keeps three's ordinary behaviour. */
export const FAR_SHADOW_MARK = -1;

/** Fraction of the near shadow map, from its edge inwards, over which the far
 * map hands over to it. */
export const FAR_SHADOW_BLEND = 0.08;

const directionalLoop =
  /#if \( NUM_DIR_LIGHTS > 0 \) && defined\( RE_Direct \)[\s\S]*?#pragma unroll_loop_end\s*#endif/;
const shadowLine =
  /(\t\t#if defined\( USE_SHADOWMAP \) && \( UNROLLED_LOOP_INDEX < NUM_DIR_LIGHT_SHADOWS \)\n\t\tdirectionalLightShadow = directionalLightShadows\[ i \];\n[^\n]*\n\t\t#endif\n)/;
const directCall =
  'RE_Direct( directLight, geometryPosition, geometryNormal, geometryViewDir, geometryClearcoatNormal, material, reflectedLight );';

const farGuard = 'defined( USE_SHADOWMAP ) && NUM_DIR_LIGHT_SHADOWS > 1';

/** Four-tap bilinear comparison of the far map, outside the near map's
 * coverage only (it decides wherever it reaches, with a short hand-over). */
const FAR_SHADOW_GLSL = `
#if ${farGuard}
float apexFarShadow( sampler2D map, vec2 size, float bias, vec4 farCoord, vec4 nearCoord ) {
	vec3 near = nearCoord.xyz / nearCoord.w;
	float edge = min( min( near.x, 1.0 - near.x ), min( near.y, 1.0 - near.y ) );
	float nearWeight = near.z <= 1.0 ? smoothstep( 0.0, ${FAR_SHADOW_BLEND.toFixed(3)}, edge ) : 0.0;
	if ( nearWeight >= 1.0 ) return 1.0;
	vec3 c = farCoord.xyz / farCoord.w;
	c.z += bias;
	if ( c.x < 0.0 || c.x > 1.0 || c.y < 0.0 || c.y > 1.0 || c.z > 1.0 ) return 1.0;
	vec2 texel = 1.0 / size, p = c.xy * size - 0.5, f = fract( p ), base = ( floor( p ) + 0.5 ) * texel;
	float lit = mix(
		mix( texture2DCompare( map, base, c.z ), texture2DCompare( map, base + vec2( texel.x, 0.0 ), c.z ), f.x ),
		mix( texture2DCompare( map, base + vec2( 0.0, texel.y ), c.z ), texture2DCompare( map, base + texel, c.z ), f.x ),
		f.y );
	return mix( lit, 1.0, nearWeight );
}
#endif
`;

/** Patched copies of three's chunks: the sun (directional light 0) also
 * reads the far map; the marked far light skips its own lighting and shadow. */
export function farShadowChunks(lightsBegin: string, shadowPars: string) {
  const loop = lightsBegin.match(directionalLoop)?.[0];
  if (!loop || !shadowLine.test(loop) || !loop.includes(directCall))
    throw new Error('Unexpected three.js directional light chunk');
  const patched = loop.replace(
    shadowLine,
    `\t\t#if ${farGuard} && UNROLLED_LOOP_INDEX == 1
\t\tif ( directionalLightShadows[ 1 ].shadowIntensity >= 0.0 ) {
\t\t#endif
$1\t\t#if ${farGuard} && UNROLLED_LOOP_INDEX == 0
\t\tif ( receiveShadow && directLight.visible && directionalLightShadows[ 1 ].shadowIntensity < 0.0 )
\t\t\tdirectLight.color *= apexFarShadow( directionalShadowMap[ 1 ], directionalLightShadows[ 1 ].shadowMapSize, directionalLightShadows[ 1 ].shadowBias, vDirectionalShadowCoord[ 1 ], vDirectionalShadowCoord[ 0 ] );
\t\t#endif
`,
  );
  const closed = patched.replace(
    directCall,
    `${directCall}
\t\t#if ${farGuard} && UNROLLED_LOOP_INDEX == 1
\t\t}
\t\t#endif`,
  );
  return {
    lightsBegin: lightsBegin.replace(loop, closed),
    shadowPars: shadowPars + FAR_SHADOW_GLSL,
  };
}

let installed = false;
/** Install once, before any lit material compiles. */
export function installFarShadowChunks() {
  if (installed) return;
  const chunks = farShadowChunks(
    T.ShaderChunk.lights_fragment_begin,
    T.ShaderChunk.shadowmap_pars_fragment,
  );
  T.ShaderChunk.lights_fragment_begin = chunks.lightsBegin;
  T.ShaderChunk.shadowmap_pars_fragment = chunks.shadowPars;
  installed = true;
}
installFarShadowChunks();

export interface FarShadowBake {
  /** Sun direction (towards the sun), any length. */
  direction: T.Vector3;
  /** World-space region whose casters and receivers the map covers. */
  bounds: T.Box3;
  /** Roots left out of the map (cars, people, particles, moving equipment). */
  hidden: readonly (T.Object3D | null | undefined)[];
  /** Objects that cast only into the far map (groves and treelines beyond
   * the moving near frustum). */
  farCasters: readonly T.Object3D[];
  /** The sun, whose own map must not be re-rendered by the bake. */
  sun: T.DirectionalLight;
}

/** A static whole-circuit sun shadow map for everything beyond the near,
 * car-following map. It is rendered once per lighting direction, quality
 * or scenery change; three's shadow pass then reuses it every frame. */
export class FarShadow {
  readonly light = new T.DirectionalLight(0xffffff, 0);
  bakes = 0;
  private readonly camera = new T.OrthographicCamera(-1, 1, 1, -1, 1, 2);
  private readonly target = new T.WebGLRenderTarget(1, 1);
  private readonly view = new T.OrthographicCamera(-1, 1, 1, -1, 1, 2);
  constructor(size = 2048) {
    this.light.name = 'Far sun shadow (no light of its own)';
    this.light.castShadow = true;
    this.light.shadow.intensity = FAR_SHADOW_MARK;
    this.light.shadow.autoUpdate = false;
    this.light.shadow.needsUpdate = false;
    this.light.shadow.mapSize.set(size, size);
    // A camera that sees nothing: the bake renders shadow maps only.
    this.camera.position.set(0, -1e5, 0);
    this.camera.lookAt(0, -2e5, 0);
    this.camera.updateMatrixWorld();
  }
  get enabled() {
    return this.light.castShadow;
  }
  /** Turn the far map on or off (it follows the sun's own shadows). */
  setEnabled(enabled: boolean, size: number) {
    if (!Number.isInteger(size) || size < 1) throw new Error('Invalid far shadow size');
    this.light.castShadow = enabled;
    if (this.light.shadow.mapSize.x !== size) {
      this.light.shadow.map?.dispose();
      this.light.shadow.map = null;
      this.light.shadow.mapSize.set(size, size);
    }
  }
  /** Fit the light's orthographic frustum to `bounds` seen along `direction`. */
  fit(direction: T.Vector3, bounds: T.Box3) {
    if (bounds.isEmpty() || !(direction.lengthSq() > 0))
      throw new Error('Invalid far shadow region');
    const centre = bounds.getCenter(new T.Vector3());
    const radius = bounds.getSize(new T.Vector3()).length() / 2;
    const light = this.light;
    light.position
      .copy(direction)
      .normalize()
      .multiplyScalar(radius * 2)
      .add(centre);
    light.target.position.copy(centre);
    light.updateMatrixWorld();
    light.target.updateMatrixWorld();
    // The same orientation three's shadow camera takes from the light.
    this.view.position.copy(light.position);
    this.view.lookAt(centre);
    this.view.updateMatrixWorld();
    const corner = new T.Vector3(),
      box = new T.Box3();
    for (let i = 0; i < 8; i++) {
      corner.set(
        i & 1 ? bounds.max.x : bounds.min.x,
        i & 2 ? bounds.max.y : bounds.min.y,
        i & 4 ? bounds.max.z : bounds.min.z,
      );
      box.expandByPoint(corner.applyMatrix4(this.view.matrixWorldInverse));
    }
    const shadow = light.shadow,
      camera = shadow.camera;
    camera.left = box.min.x;
    camera.right = box.max.x;
    camera.bottom = box.min.y;
    camera.top = box.max.y;
    camera.near = Math.max(0.1, -box.max.z - 1);
    camera.far = -box.min.z + 1;
    camera.updateProjectionMatrix();
    // About one map texel of offsets keeps lit faces from self-shadowing.
    const texel = Math.max(box.max.x - box.min.x, box.max.y - box.min.y) / shadow.mapSize.x;
    shadow.normalBias = texel;
    shadow.bias = -texel / (camera.far - camera.near);
    return texel;
  }
  /** Render the far map now (shadow maps only), leaving every other pass,
   * visibility and caster flag as it was. */
  bake(renderer: T.WebGLRenderer, scene: T.Scene, options: FarShadowBake) {
    if (!this.enabled) return false;
    this.fit(options.direction, options.bounds);
    const sun = options.sun.shadow;
    const sunState = [sun.autoUpdate, sun.needsUpdate] as const;
    const hidden = options.hidden.filter((o): o is T.Object3D => !!o && o.visible);
    const casters = options.farCasters.filter((o) => !o.castShadow);
    const target = renderer.getRenderTarget(),
      autoUpdate = renderer.shadowMap.autoUpdate;
    try {
      sun.autoUpdate = false;
      sun.needsUpdate = false;
      for (const object of hidden) object.visible = false;
      for (const object of casters) object.castShadow = true;
      this.light.shadow.needsUpdate = true;
      renderer.shadowMap.autoUpdate = true;
      renderer.setRenderTarget(this.target);
      renderer.render(scene, this.camera);
      this.bakes++;
    } finally {
      renderer.setRenderTarget(target);
      renderer.shadowMap.autoUpdate = autoUpdate;
      this.light.shadow.needsUpdate = false;
      for (const object of casters) object.castShadow = false;
      for (const object of hidden) object.visible = true;
      [sun.autoUpdate, sun.needsUpdate] = sunState;
    }
    return true;
  }
  diagnostics() {
    const camera = this.light.shadow.camera;
    return {
      enabled: this.enabled,
      mapSize: this.light.shadow.mapSize.x,
      bakes: this.bakes,
      metresPerTexel:
        Math.max(camera.right - camera.left, camera.top - camera.bottom) /
        this.light.shadow.mapSize.x,
    };
  }
  dispose() {
    this.light.shadow.map?.dispose();
    this.light.shadow.dispose();
    this.target.dispose();
  }
}
