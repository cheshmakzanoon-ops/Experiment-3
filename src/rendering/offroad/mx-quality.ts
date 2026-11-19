import type * as T from 'three';
import type { QualityPreset } from '../options.ts';

/** The graphics-preset gate for the heavier MX/SX presentation terms.
 *
 * The renderer reports its preset once per change (`setMxQuality`). Shader
 * work that only pays off on capable hardware is compiled under the
 * `MX_HIGH_DETAIL` define on materials registered here. The dust silhouette,
 * ground fade and arena light shafts use a separate Medium-and-up atmosphere
 * gate, so the default preset retains those established effects without
 * enabling High's denser vegetation or soil parallax. Until a renderer reports,
 * both gates are open: component fixtures
 * and tests render the full presentation, exactly as High/Ultra sessions do. */
let high = true;
let atmosphere = true;
const materials = new Set<T.Material>();
const listeners = new Set<(high: boolean) => void>();
const atmosphereMaterials = new Set<T.Material>();
const atmosphereListeners = new Set<(enabled: boolean) => void>();

export function mxHighDetail() {
  return high;
}

function apply(material: T.Material, define: string, enabled: boolean) {
  const host = material as T.Material & { defines?: Record<string, string> };
  const defines = (host.defines ??= {});
  if (enabled === define in defines) return;
  if (enabled) defines[define] = '';
  else delete defines[define];
  material.needsUpdate = true;
}

/** Compile `material` with `MX_HIGH_DETAIL` while the preset is High/Ultra. */
export function gateMxDetail<M extends T.Material>(material: M): M {
  if (!materials.has(material)) {
    materials.add(material);
    material.addEventListener('dispose', () => materials.delete(material));
  }
  apply(material, 'MX_HIGH_DETAIL', high);
  return material;
}

/** Keep the established dust shading on the default Medium preset and above. */
export function gateMxAtmosphere<M extends T.Material>(material: M): M {
  if (!atmosphereMaterials.has(material)) {
    atmosphereMaterials.add(material);
    material.addEventListener('dispose', () => atmosphereMaterials.delete(material));
  }
  apply(material, 'MX_ATMOSPHERE_DETAIL', atmosphere);
  return material;
}

/** Follow the gate (called now and on every change); returns an unsubscribe. */
export function onMxDetail(listener: (high: boolean) => void) {
  listeners.add(listener);
  listener(high);
  return () => {
    listeners.delete(listener);
  };
}

/** Medium-and-up atmospheric geometry, with the same explicit lifetime. */
export function onMxAtmosphere(listener: (enabled: boolean) => void) {
  atmosphereListeners.add(listener);
  listener(atmosphere);
  return () => {
    atmosphereListeners.delete(listener);
  };
}

/** Low uses the cheaper dust shape; Medium restores atmosphere; High/Ultra
 * additionally enable the more expensive surface and vegetation terms. */
export function setMxQuality(preset: QualityPreset) {
  const next = preset === 'high' || preset === 'ultra';
  if (next !== high) {
    high = next;
    for (const material of materials) apply(material, 'MX_HIGH_DETAIL', high);
    for (const listener of listeners) listener(high);
  }
  const nextAtmosphere = preset !== 'low';
  if (nextAtmosphere !== atmosphere) {
    atmosphere = nextAtmosphere;
    for (const material of atmosphereMaterials) apply(material, 'MX_ATMOSPHERE_DETAIL', atmosphere);
    for (const listener of atmosphereListeners) listener(atmosphere);
  }
}
