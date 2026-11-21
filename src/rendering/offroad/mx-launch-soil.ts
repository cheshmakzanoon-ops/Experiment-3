import * as T from 'three';
import type { GateSpec } from '../../simulation/offroad/course.ts';

/** The grates, dirted concrete and earth just after the gate share these
 * measured slot centres. A larger field can move all three between motos. */
export function mxStartLanes(gate?: GateSpec) {
  const spacing = gate?.spacing ?? 1, count = gate?.slots ?? 0;
  return { value: new T.Vector3(spacing, -Math.max(0, count - 1) * spacing / 2, count) };
}

/** Short prepared starts on the far side of each grate. The churning rear
 * wheel leaves a hollow, thrown lips and interrupted block prints until
 * the field converges. All distances are course metres, including at s=0. */
export const MX_LAUNCH_SOIL = /* glsl */ `
uniform float mxGateStation;
uniform vec3 mxStartLanes;
vec4 mxGateSoil( vec2 p, vec2 fp ) {
  float d = mod( p.y - mxGateStation + 2.0, mxCourseLength ) - 2.0;
  if ( d < -0.16 || d > 25.0 || mxStartLanes.z < 0.5 ) return vec4( 0.0 );
  float lane = floor( (p.x - mxStartLanes.y) / mxStartLanes.x + 0.5 );
  if ( lane < 0.0 || lane >= mxStartLanes.z ) return vec4( 0.0 );
  float seed = mxSoilHash( vec2( lane, 123.5 ) );
  float jitter = mxSoilNoise( vec2( d * 0.73, lane * 3.7 + 0.4 ) );
  float end = mix( 14.0, 25.0, seed );
  float run = smoothstep( -0.16, 0.09, d ) * (1.0 - smoothstep( end * 0.38, end, d ));
  float drift = smoothstep( 1.5, 13.0, d ) *
    ( (seed - 0.5) * 0.38 + 0.085 * sin( d * 0.47 + seed * 6.28 ) );
  float x = p.x - (mxStartLanes.y + lane * mxStartLanes.x + drift) - (jitter - 0.5) * 0.042;
  float shoulder = 0.105 + (jitter - 0.5) * 0.038;
  float aa = min( fp.x * 0.6, 0.16 );
  float hollow = 1.0 - smoothstep( shoulder * 0.38, shoulder + aa, abs( x ) );
  float lip = 1.0 - smoothstep( 0.013, 0.07 + aa, abs( abs( x ) - shoulder - 0.033 ) );
  float pressed = 1.0 - smoothstep( 0.085, 0.32 + aa, abs( x ) );
  float phase = d * 8.8 - abs( x ) * 5.1 + step( 0.0, x ) * 0.36 + seed;
  float freq = fp.y * 8.8 + fp.x * 5.1;
  float blocks = (1.0 - smoothstep( 0.10, 0.26 + min( freq, 0.4 ), abs( fract( phase ) - 0.5 ) ))
    * (1.0 - smoothstep( 0.25, 0.85, freq )) * hollow;
  return vec4( hollow, lip * (0.6 + 0.4 * jitter), pressed, blocks ) * run;
}
`;
