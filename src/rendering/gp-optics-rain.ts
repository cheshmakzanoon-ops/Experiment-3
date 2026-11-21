import * as T from 'three';
import { chainShaderHook, injectAfter, injectDeclarations } from './studio/shader-hooks.ts';

/** Shared by the GP entrant's cockpit screen and iridium shield at every LOD. */
export class GpOpticalRain {
  readonly state = { value: new T.Vector3() };

  set(time = 0, rainMmH = 0, speed = 0) {
    this.state.value.set(
      Number.isFinite(time) ? time : 0,
      T.MathUtils.smoothstep(Number.isFinite(rainMmH) ? rainMmH : 0, 0, 7),
      T.MathUtils.smoothstep(Number.isFinite(speed) ? Math.abs(speed) : 0, 6, 60),
    );
  }
}

const WATER = /* glsl */ `
varying vec2 gpOpticMetres;
uniform vec3 gpOpticWeather;

float gpOpticHash( vec2 p ) {
  vec3 q = fract( vec3( p.xyx ) * vec3( 0.1031, 0.1030, 0.0973 ) );
  q += dot( q, q.yzx + 33.33 );
  return fract( ( q.x + q.y ) * q.z );
}
// One cell contains a pinned or travelling bead. Its footprint never crosses
// the cell. The offset row lattice and per-cell phase conceal repeated rows.
float gpBeadHeight( vec2 metres ) {
  vec2 grid = metres * 49.0;
  grid.x += floor( grid.y ) * 0.37;
  vec2 cell = floor( grid );
  float seed = gpOpticHash( cell );
  float size = gpOpticHash( cell + 13.3 );
  float phase = fract( gpOpticWeather.x * ( 0.14 + seed * 0.13 ) + size );
  float growth = smoothstep( 0.0, 0.16, phase ) * ( 1.0 - smoothstep( 0.77, 1.0, phase ) );
  float density = smoothstep( seed - 0.04, seed + 0.04, gpOpticWeather.y * 0.82 );
  float travel = smoothstep( 0.35, 1.0, phase ) * ( 0.03 + gpOpticWeather.z * 0.23 );
  vec2 centre = vec2( 0.25 + 0.5 * size, 0.32 + 0.27 * gpOpticHash( cell + 6.2 ) + travel );
  vec2 d = fract( grid ) - centre;
  d.y /= 1.0 + 1.7 * gpOpticWeather.z * phase;
  float radius = 0.045 + 0.08 * size;
  float dome = max( 0.0, 1.0 - dot( d, d ) / ( radius * radius ) );
  return growth * density * dome * dome * ( 0.00032 + 0.00085 * size );
}
vec3 gpOpticNormal( vec3 n, vec2 gradient, vec3 dx, vec3 dy ) {
  vec3 r1 = cross( dy, n ), r2 = cross( n, dx );
  float determinant = dot( dx, r1 );
  vec3 bent = abs( determinant ) * n - sign( determinant ) * ( gradient.x * r1 + gradient.y * r2 );
  return dot( bent, bent ) > 1e-24 ? normalize( bent ) : n;
}`;

export function installGpOpticalRain(
  material: T.MeshPhysicalMaterial,
  rain: GpOpticalRain,
  visor = false,
) {
  chainShaderHook(material, 'gp-optical-rain-' + (visor ? 'visor-v1' : 'screen-v1'), (shader) => {
    shader.uniforms.gpOpticWeather = rain.state;
    injectDeclarations(shader, 'common', 'varying vec2 gpOpticMetres;', 'vertex');
    // Screen positions are in bike space. Visor U follows the curved eye port
    // continuously from temple to temple. Both share a metric vertical scale.
    injectAfter(
      shader,
      'begin_vertex',
      visor
        ? 'gpOpticMetres = vec2( uv.x * 0.34, position.y );'
        : 'gpOpticMetres = vec2( position.x, dot( position.yz, vec2( 0.72, -0.69 ) ) );',
      'vertex',
    );
    injectDeclarations(shader, 'common', WATER, 'fragment');
    injectAfter(
      shader,
      'normal_fragment_maps',
      /* glsl */ `
vec2 gpWetGradient = vec2( 0.0 );
vec3 gpOpticDx = dFdx( -vViewPosition ), gpOpticDy = dFdy( -vViewPosition );
if ( gpOpticWeather.y > 0.0 ) {
  vec2 footprint = fwidth( gpOpticMetres );
  float resolved = 1.0 - smoothstep( 0.0013, 0.0045, max( footprint.x, footprint.y ) );
  float height = gpBeadHeight( gpOpticMetres );
  gpWetGradient = vec2( dFdx( height ), dFdy( height ) ) * resolved;
  normal = gpOpticNormal( normal, gpWetGradient, gpOpticDx, gpOpticDy );
}`,
      'fragment',
    );
    injectAfter(
      shader,
      'clearcoat_normal_fragment_maps',
      /* glsl */ `
#ifdef USE_CLEARCOAT
if ( gpOpticWeather.y > 0.0 ) clearcoatNormal = gpOpticNormal( clearcoatNormal, gpWetGradient, gpOpticDx, gpOpticDy );
#endif`,
      'fragment',
    );
  });
}
