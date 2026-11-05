import * as T from 'three';
import { gateMxDetail } from './mx-quality.ts';

/** A single-scattering appearance for the existing MX dust point pool.
 * References 023/036/066/094–096: translucent, illuminated fines separate
 * from the heavy, solid clods. The colour remains soil albedo, never emission.
 * This is a bounded lighting approximation, not a volumetric fluid solver. */
const VERTEX = /* glsl */ `
uniform float size;
uniform float scale;
attribute float mxParticleSize;
attribute float mxParticleAlpha;
attribute vec2 mxParticleShape;
varying float vMxDustAlpha;
varying float vMxDustSeed;
varying vec3 vMxDustAmbient;
varying vec3 vMxDustSun;
varying vec3 vMxDustSunDir;
#include <common>
#include <color_pars_vertex>
#include <fog_pars_vertex>
#include <logdepthbuf_pars_vertex>
#include <clipping_planes_pars_vertex>
#include <lights_pars_begin>

// Normalized Henyey–Greenstein phase, g = 0.38. Light vectors point toward
// the source; photons travel the other way. Backlit fines scatter more light
// toward the eye, without changing the particle opacity or adding a halo.
float mxDustPhase( vec3 toLight, vec3 toEye ) {
  float cosine = clamp( dot( -toLight, toEye ), -1.0, 1.0 );
  float denominator = 1.1444 - 0.76 * cosine;
  return 0.07957747 * 0.8556 / ( denominator * sqrt( denominator ) );
}

// Directional radiance and its luminance-weighted direction (view space).
// Lights from opposing sides shorten the mean direction, so a stadium ring
// of lamps reads as diffuse fill rather than one invented key light.
void mxDustLamp( vec3 radiance, vec3 toLight ) {
  vMxDustSun += radiance;
  vMxDustSunDir += toLight * dot( radiance, vec3( 0.2126, 0.7152, 0.0722 ) );
}

void main() {
  #include <color_vertex>
  vec3 transformed = vec3( position );
  #include <project_vertex>
  vMxDustAlpha = mxParticleAlpha * mxParticleShape.x;
  vMxDustSeed = mxParticleShape.y;
  vMxDustAmbient = vec3( 0.0 );
  vMxDustSun = vec3( 0.0 );
  vMxDustSunDir = vec3( 0.0 );
  gl_PointSize = size * mxParticleSize;
  if ( isPerspectiveMatrix( projectionMatrix ) ) {
    gl_PointSize *= scale / max( -mvPosition.z, 0.01 );
    // A puff that reaches the lens is a screen-filling flat sprite; real
    // fines thin out around the camera instead of popping through it.
    vMxDustAlpha *= smoothstep( 0.35, 1.6, -mvPosition.z );
  }

  // Park inactive/solid slots before doing any light work. Solids still use
  // their existing lit InstancedMesh; this shares its original 2,400 slots.
  if ( vMxDustAlpha <= 0.0 || mxParticleSize <= 0.0 ) {
    gl_Position = vec4( 2.0, 2.0, 2.0, 1.0 );
    gl_PointSize = 0.0;
  } else {
    vec3 toEye = isPerspectiveMatrix( projectionMatrix )
      ? normalize( -mvPosition.xyz ) : vec3( 0.0, 0.0, 1.0 );
    IncidentLight lamp;
    vMxDustAmbient = ambientLightColor;
    #if NUM_HEMI_LIGHTS > 0
      #pragma unroll_loop_start
      for ( int i = 0; i < NUM_HEMI_LIGHTS; i ++ ) {
        // Dust has no surface normal: use the mean sky/ground radiance.
        vMxDustAmbient += 0.5 * ( hemisphereLights[ i ].skyColor
          + hemisphereLights[ i ].groundColor );
      }
      #pragma unroll_loop_end
    #endif
    #if defined( USE_LIGHT_PROBES )
      vMxDustAmbient += max( vec3( 0.0 ), lightProbe[ 0 ] * 0.282095 );
    #endif
    #if NUM_DIR_LIGHTS > 0
      #pragma unroll_loop_start
      for ( int i = 0; i < NUM_DIR_LIGHTS; i ++ ) {
        mxDustLamp( directionalLights[ i ].color
          * mxDustPhase( directionalLights[ i ].direction, toEye ),
          directionalLights[ i ].direction );
      }
      #pragma unroll_loop_end
    #endif
    #if NUM_POINT_LIGHTS > 0
      #pragma unroll_loop_start
      for ( int i = 0; i < NUM_POINT_LIGHTS; i ++ ) {
        getPointLightInfo( pointLights[ i ], mvPosition.xyz, lamp );
        mxDustLamp( lamp.color * mxDustPhase( lamp.direction, toEye ), lamp.direction );
      }
      #pragma unroll_loop_end
    #endif
    #if NUM_SPOT_LIGHTS > 0
      #pragma unroll_loop_start
      for ( int i = 0; i < NUM_SPOT_LIGHTS; i ++ ) {
        getSpotLightInfo( spotLights[ i ], mvPosition.xyz, lamp );
        mxDustLamp( lamp.color * mxDustPhase( lamp.direction, toEye ), lamp.direction );
      }
      #pragma unroll_loop_end
    #endif
    vMxDustSunDir /= max( dot( vMxDustSun, vec3( 0.2126, 0.7152, 0.0722 ) ), 1e-6 );
  }
  #include <logdepthbuf_vertex>
  #include <clipping_planes_vertex>
  #include <fog_vertex>
}
`;

const FRAGMENT = /* glsl */ `
varying float vMxDustAlpha;
varying float vMxDustSeed;
varying vec3 vMxDustAmbient;
varying vec3 vMxDustSun;
varying vec3 vMxDustSunDir;
#include <common>
#include <color_pars_fragment>
#include <fog_pars_fragment>
#include <logdepthbuf_pars_fragment>
#include <clipping_planes_pars_fragment>

float mxDustHash( vec2 p ) {
  vec3 q = fract( vec3( p.xyx ) * 0.1031 );
  q += dot( q, q.yzx + 33.33 );
  return fract( ( q.x + q.y ) * q.z );
}
float mxDustNoise( vec2 p ) {
  vec2 i = floor( p ), f = fract( p );
  f = f * f * ( 3.0 - 2.0 * f );
  return mix( mix( mxDustHash( i ), mxDustHash( i + vec2( 1.0, 0.0 ) ), f.x ),
              mix( mxDustHash( i + vec2( 0.0, 1.0 ) ), mxDustHash( i + 1.0 ), f.x ), f.y );
}

void main() {
  #include <clipping_planes_fragment>
  #include <logdepthbuf_fragment>
  vec2 p = gl_PointCoord * 2.0 - 1.0;
  float angle = vMxDustSeed * 6.2831853;
  vec2 q = mat2( cos( angle ), -sin( angle ), sin( angle ), cos( angle ) ) * p;
  q.x *= 0.84 + vMxDustSeed * 0.25;
  float r2 = dot( q, q );
  if ( r2 >= 1.0 ) discard;
  #ifdef MX_HIGH_DETAIL
  // Cauliflower lumps in the puff's own frame: two value-noise octaves with
  // a per-puff offset, so no two clouds share a silhouette or a sine stripe.
  vec2 offset = vec2( vMxDustSeed * 37.0, vMxDustSeed * 91.0 );
  float lumps = 0.64 * mxDustNoise( q * 2.4 + offset )
    + 0.36 * mxDustNoise( q * 5.3 - offset.yx );
  #else
  // Low/Medium: one analytic billow per puff instead of two noise octaves.
  float lumps = 0.5 + 0.24 * sin( q.x * 3.1 + vMxDustSeed * 19.0 )
    * sin( q.y * 2.7 - vMxDustSeed * 7.0 );
  #endif
  float envelope = 1.0 - smoothstep( 0.05, 0.95, r2 + ( lumps - 0.5 ) * 0.42 );
  // The chord through a sphere: a dense rounded body, feathered limb.
  float chord = sqrt( max( 0.0, 1.0 - r2 ) );
  float density = envelope * envelope * ( 0.55 + 0.7 * lumps ) * ( 0.45 + 0.55 * chord );
  float opacity = vMxDustAlpha * clamp( density * 1.25, 0.0, 1.0 );
  if ( opacity < 0.008 ) discard;
  // Self-shadowed volume: a pseudo-sphere normal in view space (point-coord
  // y runs downward). The side away from the key light darkens through the
  // puff; thin backlit limbs transmit (a silver lining), dense cores do not.
  vec3 puffNormal = normalize( vec3( p.x, -p.y, chord * 1.2 + 0.25 ) );
  float coherence = clamp( length( vMxDustSunDir ), 0.0, 1.0 );
  vec3 toLight = vMxDustSunDir / max( coherence, 1e-4 );
  float shade = mix( 0.38, 1.0, smoothstep( -0.6, 0.8, dot( puffNormal, toLight ) ) );
  float limb = max( 0.0, -toLight.z ) * ( 1.0 - chord );
  shade = mix( 1.0, shade, coherence ) + limb * coherence * 0.55;
  shade *= 0.8 + 0.4 * lumps;
  // The crown of a cloud sees more sky than its underside.
  float skyView = 0.9 + 0.16 * puffNormal.y;
  vec3 light = vMxDustAmbient * skyView * ( 0.86 + 0.28 * lumps ) + vMxDustSun * shade;
  vec4 diffuseColor = vec4( 1.0, 1.0, 1.0, opacity );
  #include <color_fragment>
  vec3 outgoingLight = diffuseColor.rgb * max( light, vec3( 0.0 ) );
  #include <opaque_fragment>
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
  #include <fog_fragment>
  #include <premultiplied_alpha_fragment>
}
`;

export class MxDustMaterial extends T.ShaderMaterial {
  private readonly viewport = new T.Vector2();

  constructor() {
    super({
      name: 'MX illuminated airborne dust',
      uniforms: T.UniformsUtils.merge([
        T.UniformsLib.lights,
        T.UniformsLib.fog,
        { size: { value: 1 }, scale: { value: 1 } },
      ]),
      vertexShader: VERTEX,
      fragmentShader: FRAGMENT,
      vertexColors: true,
      lights: true,
      fog: true,
      clipping: true,
      transparent: true,
      depthWrite: false,
    });
    // The production atmosphere uses this point position for the same aerial
    // perspective and local weather pockets as terrain and other particles.
    this.userData.localWeatherPosition = 'position';
    gateMxDetail(this);
  }

  /** Match Three's PointsMaterial size/attenuation contract, including DPR
   * and resizing. The fixed vector is reused by every draw and paused frame. */
  updateViewport(renderer: T.WebGLRenderer) {
    renderer.getSize(this.viewport);
    this.uniforms.size.value = renderer.getPixelRatio();
    this.uniforms.scale.value = this.viewport.y * 0.5;
  }
}
