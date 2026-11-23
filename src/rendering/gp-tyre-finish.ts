import * as T from 'three';
import type { BikeSpec } from '../simulation/bike-definitions.ts';
import { roadTyreSection } from '../simulation/bike-tyre-profile.ts';
import type { VehicleClass } from '../simulation/vehicles.ts';
import { chainShaderHook, injectAfter, injectDeclarations } from './studio/shader-hooks.ts';
import { drawWordmark, fitHeight } from './studio/brand-atlas.ts';
import { wheelBlur } from './studio/tyre-letters.ts';

/** Immutable axle-local coordinates survive rigid wheel batching and spin.
 * The fourth coordinate is half-width in metres, distinguishing the 120 mm
 * front from the 200 mm rear. No position, normal, UV or index is changed. */
export function bindGpTyre<G extends T.BufferGeometry>(geometry: G, halfWidth: number): G {
  if (!Number.isFinite(halfWidth) || halfWidth < 0.03 || halfWidth > 0.16)
    throw new RangeError('Invalid GP tyre half-width');
  const position = geometry.getAttribute('position');
  if (!position || position.itemSize !== 3) throw new Error('Missing GP tyre geometry');
  const values = new Float32Array(position.count * 4);
  for (let i = 0; i < position.count; i++) {
    const x = position.getX(i),
      y = position.getY(i),
      z = position.getZ(i);
    if (![x, y, z].every(Number.isFinite)) throw new Error('Non-finite GP tyre geometry');
    values.set([x, y, z, halfWidth], i * 4);
  }
  geometry.setAttribute('gpTyreBind', new T.BufferAttribute(values, 4));
  return geometry;
}

export interface GpTyreAppearance {
  /** Presented chassis lean (rad); the scrubbed shoulder follows it. */
  chassisLean?: number;
  /** Independent snapshot angular velocities in rad/s. Zero is a locked wheel. */
  frontOmega?: number;
  rearOmega?: number;
  compound?: number;
  frontWear?: number;
  rearWear?: number;
  frontDirt?: number;
  rearDirt?: number;
  frontSurfaceTemp?: number;
  rearSurfaceTemp?: number;
  frontWater?: number;
  rearWater?: number;
  speed?: number;
}
const finite = (value: number | undefined, fallback: number, min: number, max: number) =>
  typeof value === 'number' && Number.isFinite(value)
    ? T.MathUtils.clamp(value, min, max)
    : fallback;
/** Compound indices are the existing protocol order, not inferred from paint.
 * Intermediate and wet gain different drainage density. Slicks stay uncut. */
export function gpDrainageStyle(compound: number | undefined) {
  return compound === 3 ? 1 : compound === 4 ? 2 : 0;
}

/** Sidewall geometry of the two GP slicks in axle-local metres: the rim bead,
 * crown radius and half-width that place the contact point at a given lean,
 * and the radial band of the moulded lettering (above the compound arcs,
 * running onto the sideways-facing shoulder). */
export const GP_TYRE_SIDEWALL = Object.freeze({
  front: Object.freeze({ crown: 0.075, halfWidth: 0.06, letters: [0.2515, 0.2755] as const }),
  rear: Object.freeze({ crown: 0.11, halfWidth: 0.1, letters: [0.2445, 0.2705] as const }),
  /** Lettering tiles around the tyre (each: brand, then size code): the
   * brand appears twice, with bare black sidewall between (REF 018/096). */
  repeats: 2,
  /** A tile spans ~0.82 m of circumference over a ~25 mm band (33:1) while
   * the atlas is 16:1, so glyphs are drawn at this width to read true. */
  glyphWidth: 0.49,
  /** Average lettering coverage over a band row, shown once the wheel spins. */
  meanInk: 0.09,
  words: Object.freeze(['MOTOBOUND', '17  MOTORCYCLE'] as const),
});

/** Across-tread position (0 centre .. 1 tread edge) of the contact patch at a
 * chassis lean: the tread arc of radius `crown` touches the road at
 * crown * sin(lean) from the centre plane. */
export function gpTyreContactAcross(lean: number, crown: number, halfWidth: number) {
  if (!Number.isFinite(lean)) return 0;
  return T.MathUtils.clamp((crown * Math.sin(Math.min(Math.abs(lean), 1.2))) / halfWidth, 0, 1);
}
/** Outer edge of the scrubbed shoulder band: a run-in race tyre is scrubbed
 * well out from the centre; leaning further extends the band to the edge. */
export function gpTyreScrubEdge(contactAcross: number) {
  return T.MathUtils.clamp(Math.max(0.62, contactAcross + 0.12), 0.62, 0.97);
}

let lettering: T.CanvasTexture | null = null;
/** Shared sidewall lettering (white strokes, red = coverage), or null where
 * no canvas exists (unit tests). Original wordmarks only. */
export function gpTyreLetteringAtlas(): T.CanvasTexture | null {
  if (lettering) return lettering;
  if (typeof document === 'undefined') return null;
  const width = 2048,
    height = 128,
    canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const c = canvas.getContext('2d');
  if (!c || typeof c.fillRect !== 'function') return null;
  c.fillStyle = '#000';
  c.fillRect(0, 0, width, height);
  c.strokeStyle = '#fff';
  const [brand, code] = GP_TYRE_SIDEWALL.words,
    g = GP_TYRE_SIDEWALL.glyphWidth,
    style = { weight: 0.15, width: 1.02 * g, tracking: 0.12 * g },
    cap = fitHeight(brand, width * 0.3, height * 0.74, style);
  drawWordmark(c, brand, width * 0.22, height / 2, cap, style);
  drawWordmark(c, code, width * 0.64, height / 2, cap * 0.42, { ...style, weight: 0.13 });
  lettering = new T.CanvasTexture(canvas);
  lettering.colorSpace = T.NoColorSpace;
  lettering.wrapS = T.RepeatWrapping;
  lettering.wrapT = T.ClampToEdgeWrapping;
  lettering.anisotropy = 8;
  lettering.name = 'Motorcycle sidewall lettering';
  return lettering;
}

/** Close-range material relief only; the physics carcass/contact is unchanged.
 * Uniforms are written from recorded tyre observations, not time integration.
 * Rib pitch, crown profile and tread scuff vary across the tyre rather than
 * making the whole wheel an evenly shiny plastic torus. */
export function installGpTyreFinish(material: T.MeshStandardMaterial) {
  const front = { value: new T.Vector4(0, 80, 0, 0) };
  const rear = { value: new T.Vector4(0, 80, 0, 0) };
  const style = { value: new T.Vector2(0, 0) };
  const pickup = { value: new T.Vector2() };
  // x/y: front/rear contact across the tread; z/w: front/rear spin blur.
  const motion = { value: new T.Vector4(0, 0, 0, 0) };
  const letters = { value: gpTyreLetteringAtlas() };
  const hasLetters = !!letters.value;
  const f = GP_TYRE_SIDEWALL.front,
    r = GP_TYRE_SIDEWALL.rear;
  let gpPrototype = true,
    section = roadTyreSection('gp-bike'),
    frontCrown: number = f.crown,
    frontRadius = 0.3,
    rearRadius = 0.32;
  // Threshold between the two authored widths and the permanent tread design
  // (race slick, road sport, period rib). Shared by the three LODs of one bike.
  const sectionUniform = { value: new T.Vector2((f.halfWidth + r.halfWidth) / 2, 0) };
  chainShaderHook(material, 'gp-tyre-drainage-v5', (shader) => {
    Object.assign(shader.uniforms, {
      gpTyreFront: front,
      gpTyrePickup: pickup,
      gpTyreRear: rear,
      gpTyreStyle: style,
      gpTyreSection: sectionUniform,
      gpTyreMotion: motion,
      ...(hasLetters ? { gpTyreLetters: letters } : {}),
    });
    injectDeclarations(
      shader,
      'common',
      'attribute vec4 gpTyreBind; varying vec4 vGpTyreBind;',
      'vertex',
    );
    injectAfter(shader, 'begin_vertex', 'vGpTyreBind=gpTyreBind;', 'vertex');
    injectDeclarations(
      shader,
      'common',
      `
      varying vec4 vGpTyreBind;
      uniform vec4 gpTyreFront, gpTyreRear, gpTyreMotion;
      uniform vec2 gpTyreStyle, gpTyreSection, gpTyrePickup;
      ${hasLetters ? 'uniform sampler2D gpTyreLetters;' : ''}
      float gpTyreRelief, gpTyreRoughness, gpTyreCoverage;
    `,
      'fragment',
    );
    injectAfter(
      shader,
      'color_fragment',
      `
    {
      vec4 p=vGpTyreBind;
      gpTyreCoverage=step(.025,p.w)*gpTyreStyle.y;
      float across=abs(p.x)/max(p.w,.03);
      float crown=1.-smoothstep(.62,.97,across);
      float rearTyre=step(gpTyreSection.x,p.w);
      vec4 condition=mix(gpTyreFront,gpTyreRear,rearTyre);
      float heat=smoothstep(45.,95.,condition.y);
      float water=clamp(condition.z * max(condition.w,2.) / 25.,0.,1.);
      // Integer circumferential pitch closes exactly at the angular seam.
      float theta=atan(p.z,p.y)/6.28318530718;
      float road=step(.5,gpTyreSection.y);
      float vintage=step(1.5,gpTyreSection.y);
      float cuts=mix(mix(28.,32.,road),40.,step(1.5,gpTyreStyle.x));
      float phase=theta*cuts + across*mix(.85,.58,vintage) + sin(across*3.14159265)*.16;
      // Stagger the two banks of road channels; the centre rib stays continuous.
      phase+=road*smoothstep(-.12,.12,p.x/max(p.w,.03))*.32;
      // Derivatives of the continuous plane, not of fract(), avoid a dark
      // unfiltered seam at every groove. Fade subpixel grooves to no relief.
      float px=max(fwidth(phase),.00001);
      float resolved=1.-smoothstep(.16,.45,px);
      float width=mix(.033,.048,step(1.5,gpTyreStyle.x));
      float groove=(1.-smoothstep(width-px*.5,width+px*.5,abs(fract(phase)-.5)))
        * smoothstep(.1,.2,across) * (1.-smoothstep(.87,.97,across))
        * max(step(.5,gpTyreStyle.x),road) * resolved;
      float ribDistance=abs(across-(.21+.026*sin(theta*6.28318530718*24.)));
      float ribPixel=max(fwidth(across),.0001);
      float rib=(1.-smoothstep(.018-ribPixel*.5,.018+ribPixel*.5,ribDistance))
        *(1.-smoothstep(.024,.095,ribPixel));
      groove=max(groove,rib*vintage);
      // Scrubbed band (REF 002/015/060/096): a run-in race tyre is matt and
      // slightly lighter from the centre out to where it has been leaned;
      // the band reaches the edge as the presented lean moves the contact
      // patch (crown*sin(lean)) outward. Beyond it the moulded rubber keeps
      // its darker sheen; the patch itself carries a hot, darker stripe.
      // Integer angular harmonics close at atan's seam; grain uses continuous
      // axle-local metres and fades before either scale becomes subpixel.
      float contact=mix(gpTyreMotion.x,gpTyreMotion.y,rearTyre);
      float edge=clamp(max(.62,abs(contact)+.12),.62,.97);
      float pixel=length(fwidth(p.xyz));
      float streak=sin(theta*6.28318530718*54. + across*84.)*.5+.5;
      float resolvedScrub=1.-smoothstep(.006,.025,pixel);
      float scrub=smoothstep(.06,.18,across)*(1.-smoothstep(edge-.05,edge,across))
        *(.55+.45*sqrt(condition.x));
      float fresh=smoothstep(edge-.03,edge+.02,across)*(1.-smoothstep(.93,.99,across));
      float hotPatch=exp(-pow((p.x/max(p.w,.03)-contact)/.07,2.))*smoothstep(.15,.3,abs(contact))*(.4+.6*heat);
      float scuff=resolvedScrub*scrub;
      float grain=sin(p.y*1221.+sin(p.z*891.)*.8)*sin(p.x*1493.+p.z*823.);
      float resolvedGrain=1.-smoothstep(.00065,.0025,pixel);
      diffuseColor.rgb *= mix(1., mix(1.08,.94,heat)*mix(1.,.56,groove)
        *(1.+scrub*(.36+(streak-.5)*.14*resolvedScrub)+grain*.022*resolvedGrain)
        *(1.-.18*fresh)*(1.-.14*hotPatch),gpTyreCoverage*crown);
      gpTyreRelief=(-.0016*groove + .000035*(streak-.5)*scuff
        + grain*.000018*resolvedGrain*crown)*gpTyreCoverage;
      gpTyreRoughness=clamp(mix(.71,.84-.08*heat+.055*condition.x,crown)
        +.07*scrub-.2*fresh-.05*hotPatch-.20*water*crown+.12*groove,.48,.94);
      // Loose material on a hot contact face. Each island stays with the
      // rotating tyre. Fold the angular cell ID so both sides of atan meet.
      float dirt=mix(gpTyrePickup.x,gpTyrePickup.y,rearTyre);
      if(dirt>0. && gpTyreCoverage>.5) {
        vec2 grid=vec2(theta*96.,p.x*158.);
        vec2 cell=floor(grid);
        cell.x=mod(cell.x,96.);
        vec3 h=fract(vec3(cell.xyx)*vec3(.1031,.11369,.13787));
        h+=dot(h,h.yzx+19.19);
        vec3 seed=fract((h.xxy+h.yzz)*h.zyx);
        vec2 piece=fract(grid)-(.32+.36*seed.xy);
        piece.y+=piece.x*(seed.z-.5)*.8;
        float speck=1.-smoothstep(.58,1.,length(piece/vec2(.19+.13*seed.y,.22+.19*seed.x)));
        float selected=smoothstep(seed.z-.04,seed.z+.04,.93*dirt);
        float spin=mix(gpTyreMotion.z,gpTyreMotion.w,rearTyre);
        float detail=(1.-smoothstep(.0015,.009,pixel))*(1.-spin);
        float coverage=mix(.16*dirt,speck*selected,detail)*(1.-smoothstep(.82,1.,across));
        diffuseColor.rgb=mix(diffuseColor.rgb,vec3(.105,.090,.071)*(1.-.42*water),coverage*.80);
        gpTyreRoughness=mix(gpTyreRoughness,.93,coverage);
        gpTyreRelief+=.0007*coverage*detail;
      }
      ${
        hasLetters
          ? `// Moulded sidewall lettering above the compound arcs, smeared along
      // the angle with presented wheel speed (no wall clock).
      {
        float radius=length(p.yz);
        vec2 band=mix(vec2(${f.letters[0].toFixed(4)},${f.letters[1].toFixed(4)}),
          vec2(${r.letters[0].toFixed(4)},${r.letters[1].toFixed(4)}),rearTyre);
        float v=(radius-band.x)/(band.y-band.x);
        float side=smoothstep(.55,.7,across);
        if (v>0. && v<1. && side>0.) {
          float spin=clamp(mix(gpTyreMotion.z,gpTyreMotion.w,rearTyre),0.,1.);
          // Reads left to right over the top of the wheel from either side.
          float u=-theta*${GP_TYRE_SIDEWALL.repeats.toFixed(1)}*sign(p.x);
          // A spinning wheel smears its lettering into a faint ring: fade to
          // the band's mean coverage rather than ghosting discrete taps.
          float ink=spin<.99?texture2D(gpTyreLetters,vec2(u,v)).r:0.;
          ink=mix(ink,${GP_TYRE_SIDEWALL.meanInk.toFixed(3)},spin);
          ink*=side*gpTyreStyle.y*(1.-.3*clamp(water,0.,1.));
          diffuseColor.rgb=mix(diffuseColor.rgb,vec3(.78,.78,.76),ink);
        }
      }`
          : ''
      }
    }
    `,
      'fragment',
    );
    injectAfter(
      shader,
      'roughnessmap_fragment',
      'roughnessFactor=mix(roughnessFactor,gpTyreRoughness,gpTyreCoverage);',
      'fragment',
    );
    injectAfter(
      shader,
      'normal_fragment_maps',
      `
    {
      vec3 dx=dFdx(-vViewPosition),dy=dFdy(-vViewPosition);
      vec3 r1=cross(dy,normal),r2=cross(normal,dx);float det=dot(dx,r1);
      vec3 grad=sign(det)*(dFdx(gpTyreRelief)*r1+dFdy(gpTyreRelief)*r2);
      normal=normalize(max(abs(det),1.e-10)*normal-grad);
    }`,
      'fragment',
    );
  });
  return {
    front,
    rear,
    style,
    motion,
    pickup,
    sectionUniform,
    configure(classId: VehicleClass, spec: BikeSpec) {
      gpPrototype = classId === 'gp-bike';
      section = roadTyreSection(classId);
      frontCrown = spec.crownRadius;
      frontRadius = spec.frontWheelRadius;
      rearRadius = spec.rearWheelRadius;
      sectionUniform.value.set(
        (section.frontHalfWidth + section.rearHalfWidth) / 2,
        classId === 'classic-bike' ? 2 : classId === 'road-bike' ? 1 : 0,
      );
    },
    update(state: GpTyreAppearance, enabled = true, treadContact?: readonly number[]) {
      const speed = finite(state.speed, 0, 0, 150);
      pickup.value.set(
        gpPrototype ? finite(state.frontDirt, 0, 0, 1) : 0,
        gpPrototype ? finite(state.rearDirt, 0, 0, 1) : 0,
      );
      const lean = finite(state.chassisLean, 0, -1.5, 1.5);
      motion.value.set(
        treadContact?.[0] ??
          Math.sign(lean) * gpTyreContactAcross(lean, frontCrown, section.frontHalfWidth),
        treadContact?.[1] ??
          Math.sign(lean) * gpTyreContactAcross(lean, section.rearCrown, section.rearHalfWidth),
        wheelBlur(finite(state.frontOmega, speed / frontRadius, -1600, 1600)),
        wheelBlur(finite(state.rearOmega, speed / rearRadius, -1600, 1600)),
      );
      front.value.set(
        finite(state.frontWear, 0, 0, 1),
        finite(state.frontSurfaceTemp, 80, -40, 200),
        finite(state.frontWater, 0, 0, 5),
        speed,
      );
      rear.value.set(
        finite(state.rearWear, 0, 0, 1),
        finite(state.rearSurfaceTemp, 80, -40, 200),
        finite(state.rearWater, 0, 0, 5),
        speed,
      );
      style.value.set(gpDrainageStyle(state.compound), enabled ? 1 : 0);
    },
  };
}
