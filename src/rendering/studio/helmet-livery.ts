import * as T from 'three';
import { chainShaderHook, injectAfter, injectDeclarations } from './shader-hooks.ts';

/**
 * Driver look (D16 characters-driver): per-team helmets, an iridescent visor,
 * team suits and gloves, all procedural (no image assets, no real marks).
 *
 * Helmet (r 0.25, coat 1 / 0.03) in the helmet shell's local frame
 * (x across, y up, +z forward): team primary crown, a secondary side flash
 * that sweeps back from the visor, an accent centre stripe, a secondary chin
 * bar and an exposed-carbon panel at the nape.
 * Visor: #0b1014 at r 0.04 with thin-film iridescence (IOR 1.8, 280-620 nm),
 * a 1 / 0.015 clear coat and a strong environment response.
 * Suits: MeshPhysical with sheen (roughness 0.58, colour 0.6× the suit).
 */
export interface DriverDesign {
  primary: T.ColorRepresentation;
  secondary: T.ColorRepresentation;
  accent: T.ColorRepresentation;
}

export const HELMET = Object.freeze({ roughness: 0.25, clearcoat: 1, clearcoatRoughness: 0.03 });
export const VISOR = Object.freeze({
  color: 0x0b1014,
  roughness: 0.04,
  iridescence: 1,
  iridescenceIOR: 1.8,
  thickness: Object.freeze([280, 620] as const),
  clearcoat: 1,
  clearcoatRoughness: 0.015,
  envMapIntensity: 2.5,
});
export const SUIT_SHEEN = Object.freeze({ sheen: 1, roughness: 0.58, colour: 0.6 });
export const GLOVE_SHEEN = Object.freeze({ sheen: 0.3, palmRoughness: 0.85 });

const HELMET_GLSL = /* glsl */ `{
	// D16 team helmet: primary crown, side flash, accent stripe, chin bar, carbon nape.
	vec3 h = vHelmetLocal;
	float aa = max( fwidth( h.y ), 1e-4 ) * 1.5;
	vec3 paint = helmetPrimary;
	float flashLine = h.y + 0.32 * h.z;
	float flash = smoothstep( 0.075, 0.095, abs( h.x ) ) * smoothstep( -0.065 - aa, -0.065 + aa, flashLine ) * ( 1.0 - smoothstep( -0.022 - aa, -0.022 + aa, flashLine ) );
	paint = mix( paint, helmetSecondary, flash );
	float stripe = ( 1.0 - smoothstep( 0.02 - aa, 0.02 + aa, abs( h.x ) ) ) * smoothstep( 0.0, 0.02, h.y + 0.25 * max( - h.z, 0.0 ) );
	paint = mix( paint, helmetAccent, stripe );
	float chin = ( 1.0 - smoothstep( -0.07 - aa, -0.07 + aa, h.y ) ) * smoothstep( 0.02, 0.05, h.z );
	paint = mix( paint, helmetSecondary, chin );
	float nape = ( 1.0 - smoothstep( -0.045 - aa, -0.045 + aa, h.y ) ) * ( 1.0 - smoothstep( -0.07, -0.05, h.z ) );
	vec2 twill = floor( ( h.xy + h.z * vec2( 0.3, 0.0 ) ) * 260.0 );
	float weave = mod( twill.x + twill.y, 2.0 );
	paint = mix( paint, vec3( 0.012, 0.013, 0.015 ) * ( 0.8 + 0.4 * weave ), nape );
	diffuseColor.rgb = paint;
}`;

/** Team helmet paint for a procedural helmet shell (`vHelmetLocal` in the shell frame). */
export function teamHelmetMaterial(design: DriverDesign) {
  const material = new T.MeshPhysicalMaterial({
    color: 0xffffff,
    metalness: 0,
    ...HELMET,
  });
  material.name = 'Team helmet paint';
  const uniforms = {
    helmetPrimary: { value: new T.Color(design.primary) },
    helmetSecondary: { value: new T.Color(design.secondary) },
    helmetAccent: { value: new T.Color(design.accent) },
  };
  chainShaderHook(material, 'team-helmet-v1', (shader) => {
    Object.assign(shader.uniforms, uniforms);
    injectDeclarations(shader, 'common', 'varying vec3 vHelmetLocal;', 'vertex');
    injectAfter(shader, 'begin_vertex', 'vHelmetLocal = position;', 'vertex');
    injectDeclarations(
      shader,
      'common',
      'varying vec3 vHelmetLocal;\nuniform vec3 helmetPrimary;\nuniform vec3 helmetSecondary;\nuniform vec3 helmetAccent;',
      'fragment',
    );
    injectAfter(shader, 'color_fragment', HELMET_GLSL, 'fragment');
  });
  return { material, uniforms };
}

/** Apply the visor look to a physical material, keeping its blending flags. */
export function applyVisorLook(material: T.MeshPhysicalMaterial) {
  material.color.setHex(VISOR.color);
  material.roughness = VISOR.roughness;
  material.metalness = 0;
  material.iridescence = VISOR.iridescence;
  material.iridescenceIOR = VISOR.iridescenceIOR;
  material.iridescenceThicknessRange = [...VISOR.thickness];
  material.clearcoat = VISOR.clearcoat;
  material.clearcoatRoughness = VISOR.clearcoatRoughness;
  material.envMapIntensity = VISOR.envMapIntensity;
  material.needsUpdate = true;
  return material;
}
export function visorMaterial() {
  const material = new T.MeshPhysicalMaterial({ name: 'Iridescent team visor' });
  return applyVisorLook(material);
}

/** A team suit or glove fabric: MeshPhysical with sheen, sharing the woven maps. */
export function sheenFabric(
  source: T.MeshStandardMaterial,
  colour: T.ColorRepresentation,
  sheen: number = SUIT_SHEEN.sheen,
) {
  const material = new T.MeshPhysicalMaterial({
    name: source.name,
    color: colour,
    normalMap: source.normalMap,
    normalScale: source.normalScale.clone(),
    roughnessMap: source.roughnessMap,
    roughness: source.roughness,
    metalness: 0,
    sheen,
    sheenRoughness: SUIT_SHEEN.roughness,
    vertexColors: source.vertexColors,
  });
  material.sheenColor.set(colour).multiplyScalar(SUIT_SHEEN.colour);
  Object.assign(material.userData, source.userData);
  return material;
}

/**
 * Recolour the authored suit's vertex colours (a teal body, lighter teal
 * panels, near-black trim and off-white details) to a team kit: teal tones map
 * to the team primary scaled by their brightness, the darkest tones to the
 * team secondary; neutral details keep their colour.
 */
export function installSuitRecolour(material: T.Material, design: DriverDesign) {
  const uniforms = {
    suitPrimary: { value: new T.Color(design.primary) },
    suitSecondary: { value: new T.Color(design.secondary) },
  };
  chainShaderHook(material, 'team-suit-v1', (shader) => {
    Object.assign(shader.uniforms, uniforms);
    injectDeclarations(
      shader,
      'common',
      'uniform vec3 suitPrimary;\nuniform vec3 suitSecondary;',
      'fragment',
    );
    injectAfter(
      shader,
      'color_fragment',
      `#if defined( USE_COLOR ) || defined( USE_COLOR_ALPHA )
{
	// D16: authored teal suit panels become the team kit.
	float l = dot( vColor.rgb, vec3( 0.2126, 0.7152, 0.0722 ) );
	float teal = clamp( ( vColor.g - vColor.r ) * 9.0, 0.0, 1.0 );
	vec3 kit = mix( suitSecondary, suitPrimary * clamp( l / 0.18, 0.75, 1.35 ), smoothstep( 0.06, 0.14, l ) );
	diffuseColor.rgb = mix( diffuseColor.rgb, kit, teal );
}
#endif`,
      'fragment',
    );
  });
  return uniforms;
}

/** Hue (degrees) of a colour, for the glove-match acceptance check. */
export function hueDegrees(colour: T.ColorRepresentation) {
  const hsl = { h: 0, s: 0, l: 0 };
  new T.Color(colour).getHSL(hsl);
  return hsl.h * 360;
}
