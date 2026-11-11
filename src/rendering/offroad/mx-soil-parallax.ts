import type * as T from 'three';
import { chainShaderHook, injectAfter, injectBefore } from '../studio/shader-hooks.ts';
import { gateMxDetail } from './mx-quality.ts';

export const MX_SOIL_PARALLAX_HOOK = 'mx-soil-relief-march-v1';

/** Wheel passage relief, metres. The cross-section is the one the prepared
 * soil already paints (`mxPassesAt`: core, displaced lip); only its height is
 * new. A tyre cuts a few centimetres into loam, less into hardpack. */
export const MX_RUT_CUT = 0.045;
export const MX_RUT_LIP = 0.012;

const DECLARATIONS = /* glsl */ `
// Height of the prepared passages above the mesh surface at course point p:
// the cut is negative, the displaced lip positive. Lane parameters are fixed
// for the fragment, so each sample costs only the cross-sections and the tear.
float mxRutHeightAt( vec2 p, vec2 fp, MxFrame f, MxLane a, MxLane b, MxLane c, float soft ) {
  vec4 q = mxPassesTraffic( p, mxTrafficPos( p, fp, f ), fp, f, a, b, c );
  return ${(-MX_RUT_CUT).toFixed(4)} * soft * q.x + ${MX_RUT_LIP.toFixed(4)} * q.y;
}
`;

/** Relief march ahead of the colour chunk. Every derivative is taken before
 * the first divergent branch; the march itself is derivative free. */
const MARCH = /* glsl */ `
#ifdef MX_HIGH_DETAIL
{
  vec3 pomPos = -vViewPosition;
  vec3 pomDx = dFdx( pomPos ), pomDy = dFdy( pomPos );
  vec2 pomCx = dFdx( vMxCourse.xy ), pomCy = dFdy( vMxCourse.xy );
  vec2 pomFp = fwidth( vMxCourse.xy );
  mxFp = pomFp;
  float pomDet = pomCx.x * pomCy.y - pomCx.y * pomCy.x;
  float pomFade = ( 1.0 - smoothstep( 14.0, 34.0, length( vViewPosition ) ) )
    * clamp( vMxCourse.z, 0.0, 1.0 );
  mxPomOn = pomFade;
  if ( pomFade > 0.01 && abs( pomDet ) > 1e-10 ) {
    // Surface tangents per metre of lateral / station: the course frame in view space.
    vec3 pomTl = ( pomDx * pomCy.y - pomDy * pomCx.y ) / pomDet;
    vec3 pomTs = ( pomDy * pomCx.x - pomDx * pomCy.x ) / pomDet;
    mat3 pomFrame = mat3( pomTl, pomTs, normalize( vNormal ) );
    if ( abs( determinant( pomFrame ) ) > 1e-5 ) {
      mat3 pomInv = inverse( pomFrame );
      vec3 pomView = pomInv * normalize( vViewPosition );
      // Course-space slide per metre of height along the eye ray, limited at
      // grazing angles so a near-horizontal ray cannot sweep the whole lane.
      vec2 pomDir = pomView.xy / max( pomView.z, 0.09 );
      float pomLen = length( pomDir );
      pomDir *= min( 1.0, 6.0 / max( pomLen, 1e-4 ) );
      pomLen = min( pomLen, 6.0 );
      MxFrame pomF = mxFrameAt();
      vec2 pomP0 = vMxCourse.xy;
      vec2 pomT0 = mxTrafficPos( pomP0, pomFp, pomF );
      float pomLane = floor( pomT0.x / pomF.spacing + 0.5 );
      MxLane pomA = mxLaneAt( pomP0.y, pomLane - 1.0, pomF.spacing, pomF.corner );
      MxLane pomB = mxLaneAt( pomP0.y, pomLane, pomF.spacing, pomF.corner );
      MxLane pomC = mxLaneAt( pomP0.y, pomLane + 1.0, pomF.spacing, pomF.corner );
      float pomEdge = max( pomFp.x, 0.001 ) + 0.1 * pomFp.y;
      // Distance from this fragment to the nearest passage's lip, less its reach.
      float pomNear = min( min(
        abs( pomT0.x - pomA.centre ) - pomA.width * 1.48,
        abs( pomT0.x - pomB.centre ) - pomB.width * 1.48 ),
        abs( pomT0.x - pomC.centre ) - pomC.width * 1.48 ) - 0.075 - pomEdge;
      float pomReach = pomLen * ( ${(MX_RUT_CUT + MX_RUT_LIP).toFixed(3)} ) + 0.02;
      if ( pomView.z > 0.05 && pomNear < pomReach ) {
        // Softer ground (loam, sand, damp) takes a deeper cut than hardpack.
        float pomMix = dot( clamp( vMxSoilMix, 0.0, 1.0 ), vec4( 1.0 ) );
        float pomSoft = pomMix > 0.02
          ? dot( clamp( vMxSoilMix, 0.0, 1.0 ), vec4( 0.55, 1.0, 0.78, 0.92 ) ) / pomMix
          : 0.7;
        pomSoft *= 0.82 + 0.4 * clamp( vApexSoil.x + apexSoilWetness, 0.0, 1.0 );
        pomSoft *= 1.0 - 0.5 * smoothstep( 0.02, 0.08, vApexSoil.z );
        float pomTop = ${MX_RUT_LIP.toFixed(4)};
        float pomBottom = ${(-MX_RUT_CUT - 0.004).toFixed(4)};
        int pomSteps = 8 + int( 8.0 * clamp( pomLen / 5.0, 0.0, 1.0 ) );
        float pomStep = ( pomTop - pomBottom ) / float( pomSteps );
        float pomUp = pomTop, pomDown = pomBottom;
        bool pomFound = false;
        for ( int i = 1; i <= 16; i++ ) {
          if ( i > pomSteps ) break;
          float z = pomTop - pomStep * float( i );
          if ( z - mxRutHeightAt( pomP0 + z * pomDir, pomFp, pomF, pomA, pomB, pomC, pomSoft ) <= 0.0 ) {
            pomDown = z;
            pomFound = true;
            break;
          }
          pomUp = z;
        }
        float pomZ = 0.0;
        if ( pomFound ) {
          for ( int k = 0; k < 3; k++ ) {
            float zm = 0.5 * ( pomUp + pomDown );
            if ( zm - mxRutHeightAt( pomP0 + zm * pomDir, pomFp, pomF, pomA, pomB, pomC, pomSoft ) > 0.0 ) pomUp = zm;
            else pomDown = zm;
          }
          pomZ = 0.5 * ( pomUp + pomDown );
        }
        vec2 pomHit = pomP0 + pomZ * pomDir;
        mxPomShift = pomZ * pomDir * pomFade;
        // Analytic cross-section slope at the hit, not a screen derivative of
        // shaded values (which would blow up where the ray grazes a wall).
        float pomH1 = mxRutHeightAt( pomHit + vec2( 0.012, 0.0 ), pomFp, pomF, pomA, pomB, pomC, pomSoft );
        float pomH0 = mxRutHeightAt( pomHit - vec2( 0.012, 0.0 ), pomFp, pomF, pomA, pomB, pomC, pomSoft );
        mxPomSlope = vec2( ( pomH1 - pomH0 ) / 0.024, 0.0 ) * pomFade;
        mxPomT = normalize( pomTl );
        mxPomS = normalize( pomTs );
        float pomDepth = max( -pomZ, 0.0 );
        mxPomCavity = smoothstep( 0.0, ${MX_RUT_CUT.toFixed(3)}, pomDepth ) * 0.6 * pomFade;
        #if NUM_DIR_LIGHTS > 0
        vec3 pomSun = pomInv * directionalLights[ 0 ].direction;
        if ( pomSun.z > 0.06 && pomZ < ${MX_RUT_LIP.toFixed(4)} * 0.5 ) {
          vec2 pomLs = pomSun.xy / pomSun.z;
          pomLs *= min( 1.0, 6.0 / max( length( pomLs ), 1e-4 ) );
          float pomOcc = 0.0;
          for ( int j = 1; j <= 6; j++ ) {
            float zz = pomZ + ( pomTop - pomZ ) * float( j ) / 6.0;
            float blocker = mxRutHeightAt( pomHit + ( zz - pomZ ) * pomLs, pomFp, pomF, pomA, pomB, pomC, pomSoft ) - zz;
            pomOcc = max( pomOcc, blocker * 30.0 );
          }
          mxPomShadow = 1.0 - clamp( pomOcc, 0.0, 1.0 ) * 0.85 * pomFade;
        }
        #endif
        #ifdef APEX_SCAN
        // The photographed soil is mapped in world space: slide it by the
        // same surface shift so grain and tread follow the groove.
        vec3 pomShiftView = pomTl * mxPomShift.x + pomTs * mxPomShift.y;
        apexSoilShift = ( pomShiftView * mat3( viewMatrix ) ).xz;
        #endif
      }
    }
  }
}
#endif
`;

/** High/Ultra relief march for the prepared passages of a motocross or
 * supercross soil. The tyre cuts and displaced lips that the soil detail
 * paints are given real depth by marching the eye ray through their analytic
 * cross-section (about twenty cheap samples a fragment, none where no
 * passage is near), then shading at the point the ray reaches: the near
 * wall hides, the far wall shows, the grain slides, the groove floor sits in
 * its own shadow and cavity. Geometry, the physics ruts and lap closure are
 * untouched; Low and Medium keep the painted version. Needs the soil detail
 * and morphology hooks. */
export function installMxSoilParallax(material: T.MeshPhysicalMaterial) {
  gateMxDetail(material);
  return chainShaderHook(material, MX_SOIL_PARALLAX_HOOK, (shader) => {
    injectAfter(shader, 'common', DECLARATIONS, 'fragment');
    injectBefore(shader, 'color_fragment', MARCH, 'fragment');
    injectAfter(
      shader,
      'normal_fragment_maps',
      `#ifdef MX_HIGH_DETAIL
      normal = normalize( normal - mxPomSlope.x * mxPomT - mxPomSlope.y * mxPomS );
      #endif`,
      'fragment',
    );
    injectAfter(
      shader,
      'lights_fragment_end',
      `#ifdef MX_HIGH_DETAIL
      reflectedLight.directDiffuse *= mxPomShadow;
      reflectedLight.directSpecular *= mxPomShadow;
      reflectedLight.indirectDiffuse *= 1.0 - mxPomCavity * 0.45;
      reflectedLight.indirectSpecular *= 1.0 - mxPomCavity * 0.35;
      #endif`,
      'fragment',
    );
  });
}
