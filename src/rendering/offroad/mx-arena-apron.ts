import type * as T from 'three';
import type { Track } from '../../simulation/track.ts';
import { installScannedMaps, libraryAlbedo } from '../ground/scanned-ground.ts';
import { materials } from '../materials/index.ts';
import { chainShaderHook, injectAfter } from '../studio/shader-hooks.ts';
import { installMxArenaLighting, mxArenaLampGrid } from './mx-arena-lighting.ts';
import { MX_SX_SOIL_COLOURS } from './mx-soil-detail.ts';

const GRADE = /* glsl */ `
float mxApronRelief = 0.;
float mxApronPack = 0.;
// The blade sweeps across several metres in a pass. A broken windrow piles
// up to its side; the overlapping return pass leaves a fine comb in the cut.
void mxGradeApron(vec2 world, float amount, inout vec3 albedo) {
  vec2 pixel = fwidth(world);
  if (amount <= 0.) return;
  float sweep = world.x + .17 * world.y + 1.3 * sin(world.y * .043 + .6)
    + .24 * sin(world.y * .161 - .4);
  float lane = floor(sweep / 3.15);
  float across = fract(sweep / 3.15);
  float local = apexNoise(vec2(lane * 2.81, world.y * .13));
  float broken = apexNoise(world * .87);
  float mixed = apexNoise(world * .11 + vec2(13., 7.));
  float edge = abs(across - (.25 + .13 * local));
  float broad = 1. - smoothstep(.026, .15, edge);
  float windrow = broad * smoothstep(.2, .78, local * .68 + broken * .32);
  float bed = smoothstep(.01, .19, across) * (1. - smoothstep(.60, .93, across));
  float grain = (sweep + .023 * sin(world.y * 2.1)) / .128;
  float comb = cos(grain * 6.2831853) * (1. - smoothstep(.024, .088, pixel.x + .26 * pixel.y));
  float pass = smoothstep(.17, .69, local) * bed;
  // Mip-sized footprints retain the broad earth colour after narrow teeth
  // disappear. All adjoining ribbons use the same horizontal metre frame.
  float fine = 1. - smoothstep(.08, .39, length(pixel));
  mxApronRelief = amount * ((.024 + .013 * broken) * windrow + .0029 * comb * pass) * fine;
  mxApronPack = amount * pass * (1. - windrow);
  albedo *= 1. + amount * (.16 * (mixed - .5) + .15 * windrow - .105 * pass + .022 * comb * pass);
}`;

export function installMxArenaApron(material: T.MeshStandardMaterial, onCourse: boolean) {
  return chainShaderHook(material, onCourse ? 'sx-graded-shoulders-v1' : 'sx-graded-apron-v1', shader => {
    injectAfter(shader, 'common', GRADE, 'fragment');
    const amount = onCourse ? 'smoothstep(vMxCourseWidth + .45, vMxCourseWidth + 2.45, abs(vMxCourse.x))' : '1.';
    injectAfter(shader, 'color_fragment', `mxGradeApron(vApexWorld.xz, ${amount}, diffuseColor.rgb);`, 'fragment');
    injectAfter(shader, 'roughnessmap_fragment', 'roughnessFactor *= 1. - .10 * mxApronPack;', 'fragment');
    injectAfter(shader, 'normal_fragment_maps', `{
      vec3 dx = dFdx(-vViewPosition), dy = dFdy(-vViewPosition);
      vec3 xAxis = cross(dy, normal), yAxis = cross(normal, dx);
      float det = dot(dx, xAxis);
      normal = normalize(max(abs(det), 1e-8) * normal - sign(det) *
        (dFdx(mxApronRelief) * xAxis + dFdy(mxApronRelief) * yAxis));
    }`, 'fragment');
  });
}

/** The hard clay continues past the cushion into the stadium service apron.
 * The material shares the racing floor's dirt maps and roof-light positions.
 * Static skirts use uniform prepared soil; tyre deformation stays on the band. */
export function mxArenaApronMaterial(track: Track) {
  const ground = materials.soil({
    tile: .28,
    prepared: { colour: MX_SX_SOIL_COLOURS.hardpack, moisture: .18, compaction: .34 },
  });
  ground.name = 'Arena Nord graded clay apron';
  installScannedMaps(ground, 'dryEarth', libraryAlbedo(ground), 5);
  installMxArenaApron(ground, false);
  installMxArenaLighting(ground, mxArenaLampGrid(track));
  return ground;
}
