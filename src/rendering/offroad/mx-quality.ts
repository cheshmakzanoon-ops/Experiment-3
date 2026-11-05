import type * as T from 'three';
import type { QualityPreset } from '../options.ts';

/** The graphics-preset gate for the heavier MX/SX presentation terms.
 *
 * The renderer reports its preset once per change (`setMxQuality`). Shader
 * work that only pays off on capable hardware is compiled under the
 * `MX_HIGH_DETAIL` define on materials registered here, and geometry-only
 * extras (e.g. the arena haze shafts) follow `mxHighDetail()` through the
 * listeners. Until a renderer reports, the gate is open: component fixtures
 * and tests render the full presentation, exactly as High/Ultra sessions do. */
let high = true;
const materials = new Set<T.Material>();
const listeners = new Set<(high: boolean) => void>();

export function mxHighDetail() {
  return high;
}

function apply(material: T.Material) {
  const host = material as T.Material & { defines?: Record<string, string> };
  const defines = (host.defines ??= {});
  if (high === 'MX_HIGH_DETAIL' in defines) return;
  if (high) defines.MX_HIGH_DETAIL = '';
  else delete defines.MX_HIGH_DETAIL;
  material.needsUpdate = true;
}

/** Compile `material` with `MX_HIGH_DETAIL` while the preset is High/Ultra. */
export function gateMxDetail<M extends T.Material>(material: M): M {
  if (!materials.has(material)) {
    materials.add(material);
    material.addEventListener('dispose', () => materials.delete(material));
  }
  apply(material);
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

/** The renderer's preset: High and Ultra enable the heavier terms. */
export function setMxQuality(preset: QualityPreset) {
  const next = preset === 'high' || preset === 'ultra';
  if (next === high) return;
  high = next;
  for (const material of materials) apply(material);
  for (const listener of listeners) listener(high);
}
