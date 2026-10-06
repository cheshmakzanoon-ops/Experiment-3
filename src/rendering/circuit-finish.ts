import { PERIODIC_COVERAGE_GLSL } from './periodic-coverage.ts';
import * as T from 'three';

export type CircuitFinish = 'asphalt' | 'grass' | 'terrain' | 'concrete' | 'paint' | 'kerb';

/** Neutral tone gain of the racing asphalt over its byte-limited texels (P4
 * allows tone in the shader): calibrated so sunlit off-line asphalt renders
 * #7d7a76-#938b83 under the P3 day lighting. Effective linear albedo ~0.18. */
export const ASPHALT_TONE = 1.4;

/** Screen-space footprint in noise cells per pixel. Keep resolved construction
 * detail; converge to its mean before a pixel samples multiple unrelated cells. */
export function finishDetailWeight(footprint: number) {
  if (!Number.isFinite(footprint) || footprint < 0) throw new Error('Invalid finish footprint');
  const t = T.MathUtils.clamp((footprint - 0.35) / 0.9, 0, 1);
  return 1 - t * t * (3 - 2 * t);
}

// World-space fields survive 80 m ribbon boundaries and texture-quality changes.
// These are construction/weathering details, never fabricated session rubber,
// water, marbles or physical bumps. Those remain owned by the simulation grid.
const noise = `
${PERIODIC_COVERAGE_GLSL}
varying vec3 vFinishWorld;
varying vec2 vFinishMetres;
float finishHash(vec2 p) { return fract(sin(dot(p,vec2(127.1,311.7)))*43758.5453); }
float finishNoise(vec2 p) {
  vec2 i=floor(p), f=fract(p); f=f*f*(3.0-2.0*f);
  return mix(mix(finishHash(i),finishHash(i+vec2(1,0)),f.x),
    mix(finishHash(i+vec2(0,1)),finishHash(i+vec2(1,1)),f.x),f.y);
}
float finishFilteredNoise(vec2 p) {
  float footprint=max(length(dFdx(p)),length(dFdy(p)));
  float weight=1.0-smoothstep(.35,1.25,footprint);
  return mix(.5,finishNoise(p),weight);
}
float finishLine(float x, float width) {
  float aa=max(fwidth(x),.0001);
  return 1.0-smoothstep(width-aa,width+aa,abs(x));
}
`;
const finishes: Record<CircuitFinish, string> = {
  asphalt: `
    float broad=finishFilteredNoise(vFinishWorld.xz*.11);
    float medium=finishFilteredNoise(vFinishWorld.xz*1.7);
    float repair=finishFilteredNoise(vFinishWorld.xz*.035+vec2(3.1,7.9));
    // Binder tone breaks up gently (P4: .92+broad*.08); broad aged regions
    // are a soft -7 %. Rectangular sealed repairs are the road layer's job.
    diffuseColor.rgb *= ${ASPHALT_TONE.toFixed(3)} * (.92 + broad*.08 + medium*.07) * mix(1.0,.93,smoothstep(.58,.82,repair));
    // A restrained longitudinal paving join, not a painted racing line.
    float joinPhase=(vFinishMetres.x-.1)/3.6;
    float join=apexStripeCoverage(joinPhase,fwidth(joinPhase),.014/3.6);
    diffuseColor.rgb *= 1.0-.17*join;
  `,
  grass: `
    // Irrigated circuit turf: shift the shared olive texels greener (linear
    // ratios of sRGB 80/104/48 over the texture's 89/101/53 mean).
    diffuseColor.rgb *= vec3(.79,1.066,.8);
    // Regional soil/moisture variation, not high-contrast camouflage patches.
    float broad=finishFilteredNoise(vFinishWorld.xz*.018);
    float patches=finishFilteredNoise(vFinishWorld.xz*.48);
    float dry=smoothstep(.36,.80,broad*.85+patches*.15);
    diffuseColor.rgb *= mix(vec3(.80,.88,.70),vec3(1.12,1.04,.85),dry);
    diffuseColor.rgb *= .93+.10*patches;
    // Broad vegetation/soil regions survive distance without subpixel speckle.
    // Shared world coordinates keep the terrain/apron boundary continuous.
    diffuseColor.rgb *= .92+.16*finishFilteredNoise(vFinishWorld.xz*.006);
    // Mown bands parallel to the circuit edge (ribbon U is lateral metres).
    // A filtered triangle wave keeps band edges stable in motion; the bands
    // converge to their mean before one pixel spans a band, and fade out before
    // the apron's outer edge so they never meet the unmown terrain as a seam.
    float mowPhase=abs(vFinishMetres.x)/9.0;
    float mowTri=abs(fract(mowPhase)-.5)*4.0-1.0;
    float mowAA=fwidth(mowPhase)*4.0+.03;
    float mowBand=smoothstep(-mowAA,mowAA,mowTri);
    float mowResolved=(1.0-smoothstep(.25,.9,mowAA))*(1.0-smoothstep(26.0,38.0,abs(vFinishMetres.x)));
    diffuseColor.rgb *= mix(1.0,mix(.9,1.08,mowBand),mowResolved);
  `,
  terrain: `
    // Distant landform shading from the world normal and elevation: lush
    // lowland, drier scrub on high ground, exposed rock on steep faces.
    float tBroad=finishFilteredNoise(vFinishWorld.xz*.0045);
    float tDetail=finishFilteredNoise(vFinishWorld.xz*.037);
    float tFine=finishFilteredNoise(vFinishWorld.xz*.21);
    float slope=1.0-clamp(normalize(vFinishNormal).y,0.0,1.0);
    float elevation=vFinishWorld.y;
    diffuseColor.rgb *= .9+.18*tBroad;
    float dryLand=smoothstep(14.0,95.0,elevation+(tBroad-.5)*40.0);
    diffuseColor.rgb=mix(diffuseColor.rgb,diffuseColor.rgb*vec3(1.22,1.05,.72),dryLand*.8);
    float scrub=smoothstep(.12,.3,slope+(tDetail-.5)*.18)*(1.0-dryLand*.4);
    diffuseColor.rgb=mix(diffuseColor.rgb,vec3(.055,.068,.035)*(.8+.4*tFine),scrub*.55);
    float rock=smoothstep(.34,.56,slope+(tDetail-.5)*.22)+smoothstep(150.0,240.0,elevation)*.45;
    vec3 stone=mix(vec3(.19,.18,.16),vec3(.31,.29,.25),tFine)*(.82+.3*tDetail);
    diffuseColor.rgb=mix(diffuseColor.rgb,stone,clamp(rock,0.0,1.0));
  `,
  concrete: `
    float grain=finishFilteredNoise(vFinishMetres*vec2(47.0,9.0));
    float streak=finishFilteredNoise(vFinishMetres*vec2(7.0,.3));
    float dampFoot=1.0-smoothstep(.03,.42,vFinishMetres.y);
    diffuseColor.rgb *= .84+.12*grain-.10*streak-.18*dampFoot;
    float formTie=length(vec2(mod(vFinishMetres.x+.95,1.9)-.95,
      vFinishMetres.y-.59));
    diffuseColor.rgb *= 1.0-.3*finishLine(formTie,.018);
  `,
  paint: `
    float grit=finishFilteredNoise(vFinishWorld.xz*24.0);
    float wear=finishFilteredNoise(vFinishWorld.xz*.72);
    diffuseColor.rgb *= .82+.16*grit+.05*wear;
  `,
  kerb: `
    float aa=max(length(fwidth(vFinishWorld.xz*33.0)),.001);
    float chips=smoothstep(.65,.79,finishFilteredNoise(vFinishWorld.xz*33.0));
    chips=mix(chips,.045,smoothstep(.3,1.5,aa));
    float jointPhase=vFinishMetres.y/3.0;
    float joints=apexStripeCoverage(jointPhase,fwidth(jointPhase),.012/3.0);
    diffuseColor.rgb=mix(diffuseColor.rgb,vec3(.19,.18,.16),chips*.55);
    diffuseColor.rgb *= (1.0-joints*.32) * (.84+.16*finishFilteredNoise(vFinishWorld.xz*1.4));
  `,
};

/** Compose rather than replace the stable bump and live water material hooks. */
export function installCircuitFinish(material: T.MeshStandardMaterial, kind: CircuitFinish) {
  material.userData.weatherSurface =
    kind === 'asphalt' ? 'paving' : kind === 'terrain' ? 'grass' : kind;
  const previous = material.onBeforeCompile;
  const previousKey = material.customProgramCacheKey.bind(material);
  // Capture now: the default key is onBeforeCompile.toString() and must not
  // recursively include the replacement hook when Three builds its cache key.
  const baseKey = previousKey();
  material.onBeforeCompile = (shader, renderer) => {
    previous.call(material, shader, renderer);
    shader.vertexShader = shader.vertexShader
      .replace(
        '#include <common>',
        '#include <common>\nvarying vec3 vFinishWorld; varying vec2 vFinishMetres;' +
          (kind === 'terrain' ? ' varying vec3 vFinishNormal;' : ''),
      )
      .replace('#include <begin_vertex>', '#include <begin_vertex>\nvFinishMetres=uv*5.0;')
      .replace(
        '#include <beginnormal_vertex>',
        kind === 'terrain'
          ? '#include <beginnormal_vertex>\nvFinishNormal=normalize(mat3(modelMatrix)*objectNormal);'
          : '#include <beginnormal_vertex>',
      )
      .replace(
        '#include <project_vertex>',
        `#include <project_vertex>
        vec4 finishPosition=vec4(transformed,1.0);
        #ifdef USE_INSTANCING
          finishPosition=instanceMatrix*finishPosition;
        #endif
        vFinishWorld=(modelMatrix*finishPosition).xyz;`,
      );
    shader.fragmentShader = shader.fragmentShader
      .replace(
        '#include <common>',
        '#include <common>\n' + noise + (kind === 'terrain' ? 'varying vec3 vFinishNormal;\n' : ''),
      )
      .replace('#include <map_fragment>', '#include <map_fragment>\n' + finishes[kind]);
  };
  material.customProgramCacheKey = () =>
    `${baseKey}:circuit-finish-v2-filtered:periodic-joints-v1:${kind}${kind === 'asphalt' ? ':binder-p4-v2' : ''}${kind === 'grass' ? ':regional-soil-v1:mown-v1' : kind === 'terrain' ? ':landform-v1' : ''}`;
  material.name = `Original ${kind} construction finish`;
}

/** Integral of a unit-period wire mask. CPU reference for the shader's analytic
 * pixel-footprint filtering, including pixels that cover many complete cells. */
export function wireIntegral(x: number, halfWidth: number) {
  const whole = Math.floor(x),
    f = x - whole;
  return whole * 2 * halfWidth + Math.min(f, halfWidth) + Math.max(0, f - 1 + halfWidth);
}
export function wireCoverage(centre: number, footprint: number, halfWidth = 0.016) {
  if (
    ![centre, footprint, halfWidth].every(Number.isFinite) ||
    footprint <= 0 ||
    halfWidth <= 0 ||
    halfWidth >= 0.5
  )
    throw new Error('Invalid fence footprint');
  // Beyond dozens of complete diamond periods, return the exact mean wire
  // coverage. This avoids subtracting nearly equal large integrals at distance.
  if (footprint > 32) return 2 * halfWidth;
  const a = wireIntegral(centre + footprint * 0.5, halfWidth);
  const b = wireIntegral(centre - footprint * 0.5, halfWidth);
  return T.MathUtils.clamp((a - b) / footprint, 0, 1);
}

export function catchFenceMaterial() {
  const material = new T.MeshStandardMaterial({
    color: 0x77807e,
    metalness: 0.5,
    roughness: 0.67,
    side: T.DoubleSide,
    transparent: true,
    depthWrite: false,
    // Transparent DoubleSide materials otherwise render separate front/back
    // passes. Chain-link coverage is symmetric, so one pass is sufficient.
    forceSinglePass: true,
  });
  material.name = 'Metre-scaled analytically filtered catch fence';
  material.onBeforeCompile = (shader) => {
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nvarying vec2 vFenceMetres;')
      .replace('#include <begin_vertex>', '#include <begin_vertex>\nvFenceMetres=uv*5.0;');
    shader.fragmentShader = shader.fragmentShader
      .replace(
        '#include <common>',
        `#include <common>
        varying vec2 vFenceMetres;
        float wireIntegral(float x) {
          float f=fract(x);
          return floor(x)*.032+min(f,.016)+max(0.0,f-.984);
        }
        float wireCoverage(float x) {
          float w=max(fwidth(x),.0001);
          if (w>32.0) return .032;
          return clamp((wireIntegral(x+w*.5)-wireIntegral(x-w*.5))/w,0.0,1.0);
        }`,
      )
      .replace(
        '#include <map_fragment>',
        `#include <map_fragment>
        vec2 diamond=vec2(vFenceMetres.x+vFenceMetres.y,vFenceMetres.x-vFenceMetres.y)/.09;
        vec2 wire=vec2(wireCoverage(diamond.x),wireCoverage(diamond.y));
        diffuseColor.a*=1.0-(1.0-wire.x)*(1.0-wire.y);`,
      );
  };
  material.customProgramCacheKey = () => 'apex-filtered-catch-fence-v1';
  return material;
}
