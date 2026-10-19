import type * as T from 'three';
import type { SoilKind } from '../../simulation/offroad/course.ts';
import { chainShaderHook, injectAfter, injectDeclarations } from '../studio/shader-hooks.ts';

/** Prepared motocross soil: warm clay, mineral sand and cooler damp loam.
 * The existing scanned maps supply grain/roughness. These sRGB base colours
 * are decoded once by Three, preserving readable mineral tones in shade. */
export const MX_SOIL_COLOURS: Readonly<Record<SoilKind, number>> = Object.freeze({
  hardpack: 0x9b7652,
  loam: 0x826247,
  sand: 0xb29a70,
  mud: 0x594432,
  gravel: 0x8d857a,
  asphalt: 0x4b4c4d,
  turf: 0x627044,
});

export const MX_SOIL_DETAIL_HOOK = 'mx-groomed-soil-v3';

const DECLARATIONS = /* glsl */ `
varying vec4 vMxCourse;
varying float vMxCourseWidth;
uniform float mxCourseLength;
float mxPreparedGroove = 0.0;
float mxPreparedRelief = 0.0;
float mxPreparedWet = 0.0;
float mxPreparedPacked = 0.0;
float mxPreparedAggregate = 0.0;
float mxSoilHash( vec2 p ) {
  vec3 q = fract( vec3( p.xyx ) * 0.1031 );
  q += dot( q, q.yzx + 33.33 );
  return fract( ( q.x + q.y ) * q.z );
}
float mxSoilNoise( vec2 p ) {
  vec2 i = floor( p ), f = fract( p );
  f = f * f * ( 3.0 - 2.0 * f );
  return mix( mix( mxSoilHash( i ), mxSoilHash( i + vec2( 1.0, 0.0 ) ), f.x ),
              mix( mxSoilHash( i + vec2( 0.0, 1.0 ) ), mxSoilHash( i + 1.0 ), f.x ), f.y );
}
// Longitudinal traffic changes smoothly across the lap closure. Two hash
// taps suffice: unlike a stretched 2D noise lookup, neither end needs a seam.
float mxTrafficNoise( float station, float frequency, float seed ) {
  float sections = max( 2.0, floor( mxCourseLength * frequency + 0.5 ) );
  float phase = station * sections / mxCourseLength;
  float cell = floor( phase ), f = fract( phase );
  f = f * f * ( 3.0 - 2.0 * f );
  return mix( mxSoilHash( vec2( mod( cell, sections ), seed ) ),
    mxSoilHash( vec2( mod( cell + 1.0, sections ), seed ) ), f );
}
// References 035/047/050/056/058: compacted ridden passages cover
// the broad corridor. Evaluate only the three neighbouring lanes; each
// compact support ends before a lane can leave that neighbourhood.
// The narrow cut, displaced lip, broad packed swathe and cleats are separate
// scales. Real widths prevent both railway stripes and enlarged tire prints.
vec4 mxWheelPass( vec2 p, float lane, float spacing, float corner, float pixel ) {
  float seed = lane * 9.73 + 41.0;
  float variation = mxSoilHash( vec2( lane, 18.7 ) );
  float drift = ( mxTrafficNoise( p.y, 0.093, seed ) - 0.5 ) * spacing * 0.94;
  float centre = ( lane + ( variation - 0.5 ) * 0.27 ) * spacing + drift;
  float d = abs( p.x - centre );
  float width = ( 0.068 + 0.046 * variation ) * ( 1.0 + abs( corner ) * 0.46 );
  float pressure = smoothstep( 0.26, 0.72, mxTrafficNoise( p.y, 0.20, seed + 3.0 ) );
  float spread = 0.29 + 0.20 * mxTrafficNoise( p.y, 0.11, seed + 8.0 );
  float edge = max( pixel, fwidth( d ) );
  float resolved = 1.0 - smoothstep( width * 0.7, width * 3.5, edge );
  float core = ( 1.0 - smoothstep( width * 0.20, width + edge, d ) ) * resolved;
  float lip = ( 1.0 - smoothstep( 0.025, 0.075 + edge,
    abs( d - width * 1.48 ) ) ) * resolved;
  float pass = ( 1.0 - smoothstep( 0.09, spread + edge, d ) )
    * ( 1.0 - smoothstep( 0.36, 1.1, edge ) );
  // Cleats belong to this curved passage and each pass has its own phase.
  // Three staggered lug rows leave a pressed impression, not a painted line.
  float across = ( p.x - centre ) / width;
  float column = floor( across * 1.5 );
  float phase = p.y * floor( mxCourseLength * 8.2 ) / mxCourseLength
    + variation * 7.0 + mod( column, 2.0 ) * 0.5;
  float cleatPixel = fwidth( phase );
  float cleat = ( 1.0 - smoothstep( 0.12, 0.27 + cleatPixel,
    abs( fract( phase ) - 0.5 ) ) ) * core
    * ( 1.0 - smoothstep( 0.3, 0.85, cleatPixel ) );
  // Independent centres can merge/cross by a tyre width. A compact support
  // keeps the three-neighbour evaluation continuous when its index changes,
  // even if the pixel filter broadens a distant passage.
  float support = 1.0 - smoothstep( spacing * 0.70, spacing * 0.82, d );
  return vec4( core * pressure, lip * pressure,
    pass * ( 0.24 + 0.76 * pressure ), cleat * pressure ) * support;
}
`;

const COLOUR = /* glsl */ `{
  // The authored half-width carries traffic out to the broad MX/SX lines;
  // a fixed five-pass pattern previously left the outer half almost blank.
  // Cornering shifts and compresses the family toward its outside bank.
  // These are prepared traffic marks, never an ideal-line or grip override.
  vec2 p = vMxCourse.xy;
  float onSoil = clamp( vMxCourse.z, 0.0, 1.0 );
  float pixel = max( fwidth( p.x ), 0.001 );
  float halfWidth = max( vMxCourseWidth, 1.0 );
  float spacing = clamp( halfWidth * 0.19, 0.88, 1.22 )
    * ( 1.0 - abs( vMxCourse.w ) * 0.10 );
  float shift = -vMxCourse.w * halfWidth * 0.16
    + ( mxTrafficNoise( p.y, 0.027, 6.4 ) - 0.5 ) * 0.46;
  vec2 traffic = vec2( p.x - shift, p.y );
  // Torn soil edges are millimetres/centimetres, subordinate to the tyre
  // width. Fade this breakup before its frequency becomes sub-pixel.
  float tearFade = 1.0 - smoothstep( 0.025, 0.12, length( fwidth( p ) ) );
  float tearAcross = floor( p.x * 5.0 );
  float tearBlend = fract( p.x * 5.0 );
  tearBlend = tearBlend * tearBlend * ( 3.0 - 2.0 * tearBlend );
  float tear = mix( mxTrafficNoise( p.y, 1.7, tearAcross + 73.0 ),
    mxTrafficNoise( p.y, 1.7, tearAcross + 74.0 ), tearBlend );
  traffic.x += ( tear - 0.5 ) * 0.055 * tearFade;
  float lane = floor( traffic.x / spacing + 0.5 );
  vec4 passes = mxWheelPass( traffic, lane - 1.0, spacing, vMxCourse.w, pixel );
  passes = max( passes, mxWheelPass( traffic, lane, spacing, vMxCourse.w, pixel ) );
  passes = max( passes, mxWheelPass( traffic, lane + 1.0, spacing, vMxCourse.w, pixel ) );
  float shoulder = 1.0 - smoothstep( halfWidth * 0.76, halfWidth + 0.35, abs( p.x ) );
  passes *= shoulder;
  float broad = mxSoilNoise( p * vec2( 0.3, 0.085 ) );
  float broken = mxSoilNoise( p * vec2( 2.1, 0.67 ) );
  float wander = 0.045 * sin( p.y * 0.24 ) + ( broad - 0.5 ) * 0.16;
  float rakePhase = ( p.x + wander ) * 5.6;
  float rakeWidth = fwidth( rakePhase );
  float rake = ( 1.0 - smoothstep( 0.045, 0.16 + rakeWidth,
    abs( fract( rakePhase ) - 0.5 ) ) )
    * ( 1.0 - smoothstep( 0.32, 0.9, rakeWidth ) );
  float tread = passes.w;
  float aggregateFade = 1.0 - smoothstep( 0.035, 0.12, length( fwidth( p ) ) );
  float aggregate = smoothstep( 0.63, 0.84, mxSoilNoise( p * 19.0 ) ) * aggregateFade;
  mxPreparedPacked = onSoil * clamp( passes.z * ( 0.70 + broad * 0.30 )
    + vApexSoil.y * 0.60, 0.0, 1.0 );
  mxPreparedAggregate = onSoil * aggregate * ( 1.0 - mxPreparedPacked * 0.65 );
  mxPreparedGroove = onSoil * clamp( passes.x + vApexSoil.z * 5.0, 0.0, 1.0 );
  float rakeUnridden = rake * ( 1.0 - passes.z * 0.88 ) * ( 0.35 + broken * 0.65 );
  // Centimetre-scale skin only. The existing deformed CourseTerrain mesh
  // continues to own every jump, braking bump, wheel contact and shadow.
  mxPreparedRelief = onSoil * ( 0.0045 * rakeUnridden
    - 0.020 * passes.x - 0.006 * passes.z + 0.009 * passes.y - 0.0035 * tread )
    + 0.003 * mxPreparedAggregate;
  mxPreparedWet = clamp( vApexSoil.x + apexSoilWetness, 0.0, 1.0 );
  float grainTone = 0.92 + 0.15 * broad + 0.045 * broken;
  diffuseColor.rgb *= mix( 1.0, grainTone, onSoil )
    * ( 1.0 - mxPreparedPacked * 0.18 - mxPreparedGroove * 0.21
      + onSoil * passes.y * 0.095 + mxPreparedAggregate * 0.13 - tread * 0.045 );
  // 043/059/092: wet loam reflects chiefly along its depressions. Dry raised
  // aggregate remains rough; the complete course never becomes one mirror.
  float dampPatch = smoothstep( 0.38, 0.86, mxPreparedWet )
    * ( 0.62 + 0.38 * smoothstep( 0.25, 0.8, broad ) );
  diffuseColor.rgb *= 1.0 - mxPreparedGroove * dampPatch * 0.18;
}`;

const NORMAL = /* glsl */ `{
  // Driven-over bands expose smoother compact mineral soil. Leave the loose
  // shoulder scan intact; retain the directional cut over the packed band.
  normal = normalize( mix( normal, nonPerturbedNormal, mxPreparedPacked * 0.36 ) );
  vec3 dpdx = dFdx( -vViewPosition );
  vec3 dpdy = dFdy( -vViewPosition );
  vec3 r1 = cross( dpdy, normal ), r2 = cross( normal, dpdx );
  float determinant = dot( dpdx, r1 );
  vec3 gradient = sign( determinant ) *
    ( dFdx( mxPreparedRelief ) * r1 + dFdy( mxPreparedRelief ) * r2 );
  normal = normalize( max( abs( determinant ), 1e-8 ) * normal - gradient );
}`;

/** Adds directional rake and tread marks without geometry displacement or
 * textures/draw calls. The course mesh supplies (lateral m, station m,
 * dirt mask, corner hand) and actual half-width. The two-tap longitudinal
 * noise closes at the lap seam. Scanned soil and replay deformation stay intact. */
export function installMxSoilDetail(material: T.MeshPhysicalMaterial, courseLength: number) {
  return chainShaderHook(material, MX_SOIL_DETAIL_HOOK, (shader) => {
    shader.uniforms.mxCourseLength = { value: Math.max(1, courseLength) };
    injectDeclarations(
      shader,
      'common',
      'attribute vec4 mxCourse;\nattribute float mxCourseWidth;\nvarying vec4 vMxCourse;\nvarying float vMxCourseWidth;',
      'vertex',
    );
    injectAfter(
      shader,
      'begin_vertex',
      'vMxCourse = mxCourse;\nvMxCourseWidth = mxCourseWidth;',
      'vertex',
    );
    injectAfter(shader, 'common', DECLARATIONS, 'fragment');
    injectAfter(shader, 'color_fragment', COLOUR, 'fragment');
    injectAfter(shader, 'normal_fragment_maps', NORMAL, 'fragment');
    injectAfter(
      shader,
      'roughnessmap_fragment',
      `roughnessFactor = mix( roughnessFactor,
        clamp( roughnessFactor * 0.78, 0.58, 0.9 ), mxPreparedPacked * 0.45 );
      roughnessFactor = mix( roughnessFactor, max( 0.29, roughnessFactor * 0.52 ),
        mxPreparedGroove * smoothstep( 0.42, 0.94, mxPreparedWet ) );
      roughnessFactor = mix( roughnessFactor, max( 0.86, roughnessFactor ),
        mxPreparedAggregate * 0.45 );`,
      'fragment',
    );
  });
}
