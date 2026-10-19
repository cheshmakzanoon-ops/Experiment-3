import * as T from 'three';

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
varying vec3 vMxDustLight;
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

void main() {
  #include <color_vertex>
  vec3 transformed = vec3( position );
  #include <project_vertex>
  vMxDustAlpha = mxParticleAlpha * mxParticleShape.x;
  vMxDustSeed = mxParticleShape.y;
  vMxDustLight = vec3( 0.0 );
  gl_PointSize = size * mxParticleSize;
  if ( isPerspectiveMatrix( projectionMatrix ) )
    gl_PointSize *= scale / max( -mvPosition.z, 0.01 );

  // Park inactive/solid slots before doing any light work. Solids still use
  // their existing lit InstancedMesh; this shares its original 2,400 slots.
  if ( vMxDustAlpha <= 0.0 || mxParticleSize <= 0.0 ) {
    gl_Position = vec4( 2.0, 2.0, 2.0, 1.0 );
    gl_PointSize = 0.0;
  } else {
    vec3 toEye = isPerspectiveMatrix( projectionMatrix )
      ? normalize( -mvPosition.xyz ) : vec3( 0.0, 0.0, 1.0 );
    IncidentLight lamp;
    vMxDustLight = ambientLightColor;
    #if NUM_HEMI_LIGHTS > 0
      #pragma unroll_loop_start
      for ( int i = 0; i < NUM_HEMI_LIGHTS; i ++ ) {
        // Dust has no surface normal: use the mean sky/ground radiance.
        vMxDustLight += 0.5 * ( hemisphereLights[ i ].skyColor
          + hemisphereLights[ i ].groundColor );
      }
      #pragma unroll_loop_end
    #endif
    #if defined( USE_LIGHT_PROBES )
      vMxDustLight += max( vec3( 0.0 ), lightProbe[ 0 ] * 0.282095 );
    #endif
    #if NUM_DIR_LIGHTS > 0
      #pragma unroll_loop_start
      for ( int i = 0; i < NUM_DIR_LIGHTS; i ++ ) {
        vMxDustLight += directionalLights[ i ].color
          * mxDustPhase( directionalLights[ i ].direction, toEye );
      }
      #pragma unroll_loop_end
    #endif
    #if NUM_POINT_LIGHTS > 0
      #pragma unroll_loop_start
      for ( int i = 0; i < NUM_POINT_LIGHTS; i ++ ) {
        getPointLightInfo( pointLights[ i ], mvPosition.xyz, lamp );
        vMxDustLight += lamp.color * mxDustPhase( lamp.direction, toEye );
      }
      #pragma unroll_loop_end
    #endif
    #if NUM_SPOT_LIGHTS > 0
      #pragma unroll_loop_start
      for ( int i = 0; i < NUM_SPOT_LIGHTS; i ++ ) {
        getSpotLightInfo( spotLights[ i ], mvPosition.xyz, lamp );
        vMxDustLight += lamp.color * mxDustPhase( lamp.direction, toEye );
      }
      #pragma unroll_loop_end
    #endif
  }
  #include <logdepthbuf_vertex>
  #include <clipping_planes_vertex>
  #include <fog_vertex>
}
`;

const FRAGMENT = /* glsl */ `
varying float vMxDustAlpha;
varying float vMxDustSeed;
varying vec3 vMxDustLight;
#include <common>
#include <color_pars_fragment>
#include <fog_pars_fragment>
#include <logdepthbuf_pars_fragment>
#include <clipping_planes_pars_fragment>

void main() {
  #include <clipping_planes_fragment>
  #include <logdepthbuf_fragment>
  vec2 p = gl_PointCoord * 2.0 - 1.0;
  float angle = vMxDustSeed * 6.2831853;
  vec2 q = mat2( cos( angle ), -sin( angle ), sin( angle ), cos( angle ) ) * p;
  q.x *= 0.84 + vMxDustSeed * 0.25;
  float envelope = 1.0 - smoothstep( 0.05, 0.95, dot( q, q ) );
  float billow = 0.68 + 0.18 * sin( q.x * 6.0 + vMxDustSeed * 19.0 )
    + 0.14 * sin( q.y * 8.0 - vMxDustSeed * 7.0 );
  float opacity = vMxDustAlpha * envelope * envelope * clamp( billow, 0.28, 1.0 );
  if ( opacity < 0.008 ) discard;
  vec4 diffuseColor = vec4( 1.0, 1.0, 1.0, opacity );
  #include <color_fragment>
  vec3 outgoingLight = diffuseColor.rgb * max( vMxDustLight, vec3( 0.0 ) );
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
  }

  /** Match Three's PointsMaterial size/attenuation contract, including DPR
   * and resizing. The fixed vector is reused by every draw and paused frame. */
  updateViewport(renderer: T.WebGLRenderer) {
    renderer.getSize(this.viewport);
    this.uniforms.size.value = renderer.getPixelRatio();
    this.uniforms.scale.value = this.viewport.y * 0.5;
  }
}
