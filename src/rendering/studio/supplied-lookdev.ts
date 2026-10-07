import * as T from 'three';
import { markTexture, suppliedDecalArt } from './brand-atlas.ts';
import { chainShaderHook } from './shader-hooks.ts';

/**
 * Supplied player car look-dev (D06 vehicle-paint): runtime, name-keyed
 * material overrides for the hash-locked RB19 GLB. The bytes, meshes, material
 * count and UVs stay exactly as authored; only parameters, shader hooks and the
 * sponsor sheets' maps change, after decode.
 *
 * - Navy body (`Paint | midnight blue satin*`, and the navy nose panel and
 *   airbox roundel that share its colour) becomes a deep satin navy with a thin
 *   coat and a cloth-like sheen, so sky and horizon read along its curves
 *   instead of a near-black matte (ART_BIBLE_A §6.1; TECH_ACTORS_MAP §10.1).
 * - Vermilion, warm yellow and non-tyre decals sit under one thin glossy coat.
 * - Lacquered composite (2x2 twill, cured skins) gets the same coat, and the
 *   twill and tyre-scrub height maps get a visible relief through a gain on the
 *   bump derivative; `restoreSuppliedHeightMap`'s bumpScale is untouched.
 * - P13: every real-sponsor `Decal | ...` sheet is replaced by an original mark
 *   from `brand-atlas.ts` drawn at the sheet's own pixel size, with the same
 *   sampling, blending and single-pass flags.
 *
 * Deterministic: constants and canvas paths only; no time, no randomness.
 */
export const SUPPLIED_LOOKDEV = Object.freeze({
  satin: Object.freeze({
    /** Linear base colour: sRGB #18204A. */
    color: Object.freeze([0.0091, 0.0145, 0.068] as const),
    roughness: 0.36,
    clearcoat: 0.55,
    clearcoatRoughness: 0.1,
    sheen: 0.25,
    sheenColor: 0x23305e,
    sheenRoughness: 0.45,
  }),
  accentCoat: Object.freeze({ clearcoat: 0.6, clearcoatRoughness: 0.08 }),
  compositeCoat: Object.freeze({ clearcoat: 0.6, clearcoatRoughness: 0.08 }),
  /** Width of one twill tow bundle on every composite, metres (a 2x2 twill
   * square is four bundles): coarse enough to resolve at chase distance. */
  twillBundle: 0.0095,
  /** Gain on the screen-space height derivative, by height map name. */
  relief: Object.freeze({ carbon_twill_height: 4000, tyre_scrub_height_16bit: 2000 } as Readonly<
    Record<string, number>
  >),
});

/** Navy body paints: the satin and the two panels authored in the same navy. */
export function isSuppliedNavyPaint(name: string) {
  return (
    name.startsWith('Paint | midnight blue satin') ||
    name.startsWith('Paint | nose yellow panel') ||
    name.startsWith('Paint | airbox roundel')
  );
}
function isAccentPaint(name: string) {
  return name.startsWith('Paint | vermilion') || name.startsWith('Paint | warm yellow');
}
function isCoatedComposite(name: string) {
  return (
    name.startsWith('Composite | 2x2 twill') ||
    name.startsWith('Composite | cured aerodynamic skins')
  );
}

/** Tow bundles across one UV unit of `carbon_twill_height` (64 px of 1024). */
const TWILL_BUNDLES_PER_UV = 16;
/**
 * Median metres per UV unit of each composite on the supplied car, measured on
 * its triangles (the asset is hash-locked, so these are fixed). The authored UVs
 * are not at one scale: the floor laminate carried 10 cm bundles and the cured
 * skins 3-5 cm, which read as a quilt rather than a weave.
 */
export const SUPPLIED_COMPOSITE_UV_METRES: Readonly<Record<string, number>> = Object.freeze({
  'Composite | 2x2 twill / physical scale': 0.18,
  'Composite | 2x2 twill / physical scale | curve-local': 0.3,
  'Composite | satin floor laminate': 1.63,
  'Composite | satin floor laminate | curve-local': 0.131,
  'Composite | cured aerodynamic skins': 0.6,
  'Composite | cured aerodynamic skins | curve-local': 0.125,
  'Composite | dry internal ducts': 0.96,
  'Composite | rear-wing cured satin laminate': 0.42,
});
/** UV repeat that brings `material`'s twill to `SUPPLIED_LOOKDEV.twillBundle`. */
export function suppliedWeaveRepeat(name: string) {
  const metres = SUPPLIED_COMPOSITE_UV_METRES[name];
  return metres === undefined ? 1 : metres / (TWILL_BUNDLES_PER_UV * SUPPLIED_LOOKDEV.twillBundle);
}
/** Per-material clones of the shared twill maps (same image and GPU texture;
 * only the UV transform differs), so bump and roughness stay registered. */
function scaleWeave(material: T.MeshStandardMaterial) {
  const repeat = suppliedWeaveRepeat(material.name);
  if (repeat === 1 || !material.bumpMap) return false;
  const clones = new Map<T.Texture, T.Texture>();
  const scaled = (texture: T.Texture) => {
    let clone = clones.get(texture);
    if (!clone) {
      clone = texture.clone();
      clone.wrapS = clone.wrapT = T.RepeatWrapping;
      clone.repeat.multiplyScalar(repeat);
      clones.set(texture, clone);
    }
    return clone;
  };
  material.bumpMap = scaled(material.bumpMap);
  if (material.roughnessMap) material.roughnessMap = scaled(material.roughnessMap);
  if (material.metalnessMap) material.metalnessMap = scaled(material.metalnessMap);
  return true;
}

export interface SuppliedLookdevReport {
  /** Decal materials whose real-sponsor sheet was replaced, with the mark drawn. */
  swapped: { material: string; mark: string }[];
  /** Materials given a paint, coat or relief override. */
  overridden: string[];
  /** Height maps whose relief gain was installed. */
  relief: string[];
}
interface PlayerPaints {
  navy: { material: T.MeshPhysicalMaterial; color: T.Color }[];
  accents: { material: T.MeshPhysicalMaterial; color: T.Color }[];
}
const reports = new WeakMap<T.Object3D, SuppliedLookdevReport>();
const paints = new WeakMap<T.Object3D, PlayerPaints>();
const replaced = new WeakMap<T.Texture, T.CanvasTexture>();
const done = new WeakSet<T.Material>();

/** The look-dev changes applied to the supplied car under `root` (diagnostics). */
export function suppliedLookdevReport(root: T.Object3D): SuppliedLookdevReport {
  let report = reports.get(root);
  if (!report) reports.set(root, (report = { swapped: [], overridden: [], relief: [] }));
  return report;
}
function playerPaints(root: T.Object3D) {
  let entry = paints.get(root);
  if (!entry) paints.set(root, (entry = { navy: [], accents: [] }));
  return entry;
}

const BUMP_RETURN = 'return vec2( dBx, dBy );';
/**
 * Multiply the bump-map height derivative by `gain` (a compile-time constant).
 * three r180 normalises the surface derivatives in `perturbNormalArb`, so the
 * relief slope is bumpScale x gain x the per-pixel height step; the authored
 * bumpScale stays as restored. Mip-filtered heights flatten the weave with
 * distance, so the relief fades instead of sparkling.
 */
export function amplifySuppliedRelief(material: T.MeshStandardMaterial, gain: number) {
  if (!Number.isFinite(gain) || gain <= 0 || !Number.isInteger(gain))
    throw new Error('Invalid supplied relief gain');
  const literal = gain.toFixed(1);
  return chainShaderHook(material, `supplied-relief-${gain}-v1`, (shader) => {
    const include = '#include <bumpmap_pars_fragment>';
    if (shader.fragmentShader.includes(include))
      shader.fragmentShader = shader.fragmentShader.replace(
        include,
        T.ShaderChunk.bumpmap_pars_fragment.replace(
          BUMP_RETURN,
          `return vec2( dBx, dBy ) * ${literal};`,
        ),
      );
    else if (shader.fragmentShader.includes(BUMP_RETURN))
      shader.fragmentShader = shader.fragmentShader.replace(
        BUMP_RETURN,
        `return vec2( dBx, dBy ) * ${literal};`,
      );
  });
}

function swapDecal(material: T.MeshStandardMaterial, report: SuppliedLookdevReport) {
  const art = suppliedDecalArt(material.name);
  if (!art || !material.map) return false;
  const source = material.map;
  let texture = replaced.get(source);
  if (!texture) {
    texture = markTexture(source, art);
    // Immutable like the sheet it replaces: the same imported-texture budget.
    if (source.userData.suppliedPlayerTexture === true)
      texture.userData.suppliedPlayerTexture = true;
    replaced.set(source, texture);
  }
  material.map = texture;
  material.needsUpdate = true;
  if (source !== texture) source.dispose();
  report.swapped.push({ material: material.name, mark: String(texture.userData.fictionalMark) });
  return true;
}

/**
 * Apply the supplied-car look-dev to one material of the player car under
 * `root`. Idempotent per material; materials without a recognised name are left
 * untouched. Call it once per material in the SuppliedPlayer traversal, after
 * `configureSuppliedMaterial` (the decal flags it sets are kept).
 */
export function applySuppliedLookdev(material: T.Material, root: T.Object3D) {
  if (!(material instanceof T.MeshStandardMaterial) || done.has(material)) return false;
  done.add(material);
  const report = suppliedLookdevReport(root);
  const name = material.name;
  let changed = false;
  if (material instanceof T.MeshPhysicalMaterial) {
    if (isSuppliedNavyPaint(name)) {
      const satin = SUPPLIED_LOOKDEV.satin;
      material.color.setRGB(...satin.color);
      material.roughness = satin.roughness;
      material.clearcoat = satin.clearcoat;
      material.clearcoatRoughness = satin.clearcoatRoughness;
      material.sheen = satin.sheen;
      material.sheenColor.set(satin.sheenColor);
      material.sheenRoughness = satin.sheenRoughness;
      playerPaints(root).navy.push({ material, color: material.color.clone() });
      changed = true;
    } else if (isAccentPaint(name) || (name.startsWith('Decal |') && !name.includes('tyre'))) {
      material.clearcoat = SUPPLIED_LOOKDEV.accentCoat.clearcoat;
      material.clearcoatRoughness = SUPPLIED_LOOKDEV.accentCoat.clearcoatRoughness;
      if (isAccentPaint(name))
        playerPaints(root).accents.push({ material, color: material.color.clone() });
      changed = true;
    } else if (isCoatedComposite(name)) {
      material.clearcoat = SUPPLIED_LOOKDEV.compositeCoat.clearcoat;
      material.clearcoatRoughness = SUPPLIED_LOOKDEV.compositeCoat.clearcoatRoughness;
      changed = true;
    }
  }
  if (scaleWeave(material)) changed = true;
  const height = material.bumpMap?.name;
  const gain = height ? SUPPLIED_LOOKDEV.relief[height] : undefined;
  if (gain !== undefined && amplifySuppliedRelief(material, gain)) {
    if (!report.relief.includes(height!)) report.relief.push(height!);
    changed = true;
  }
  if (swapDecal(material, report)) changed = true;
  if (changed) {
    material.needsUpdate = true;
    if (!report.overridden.includes(name)) report.overridden.push(name);
  }
  return changed;
}

/**
 * Car 0's livery on the supplied car: a customised livery tints the navy body
 * from `primary` and the vermilion/yellow accents from `accent`; the default
 * (or null) restores the authored navy look. Finishes are unchanged.
 */
export function setSuppliedLivery(
  root: T.Object3D,
  livery: { primary: string; accent: string } | null,
) {
  const entry = paints.get(root);
  if (!entry) return false;
  for (const { material, color } of entry.navy)
    if (livery) material.color.set(livery.primary);
    else material.color.copy(color);
  for (const { material, color } of entry.accents)
    if (livery) material.color.set(livery.accent);
    else material.color.copy(color);
  return true;
}
