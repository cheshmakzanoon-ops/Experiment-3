import { DEFAULT_BINDINGS, validateBindings, type Bindings } from '../input/bindings.ts';
import {
  emptyCalibration,
  validateCalibration,
  validateDevice,
  type CalibrationSet,
  type DeviceSelection,
} from '../input/calibration.ts';
import { clamp } from '../core/math.ts';
import { DEFAULT_SETUP, validateSetup, type Setup } from '../simulation/config.ts';
import {
  graphicsPreset,
  validateGraphics,
  type GraphicsOptions,
  type Quality,
} from '../rendering/options.ts';
import {
  DEFAULT_BUTTON_ACTIONS,
  validateButtonActions,
  type ButtonActions,
} from '../input/button-actions.ts';
export interface InputMapping {
  buttonActions: ButtonActions;
  device: DeviceSelection | null;
  wheelSteering: boolean;
  saturation: number;
  calibration: CalibrationSet;
  clutchAxis: number;
  clutchButton: number;
  manualClutch: boolean;
  shiftUpButton: number;
  shiftDownButton: number;
  steerAxis: number;
  throttleAxis: number;
  brakeAxis: number;
  throttleButton: number;
  brakeButton: number;
  axisPedals: boolean;
  invertSteer: boolean;
  invertPedals: boolean;
  deadzone: number;
  exponent: number;
}
export interface Settings {
  version: 5;
  graphics: GraphicsOptions;
  colorblind: boolean;
  highContrast: boolean;
  quality: Quality;
  volume: number;
  shake: number;
  uiScale: number;
  mapping: InputMapping;
  setup: Setup;
  bindings: Bindings;
}
export const DEFAULT_SETTINGS: Settings = {
  version: 5,
  graphics: graphicsPreset('medium'),
  colorblind: false,
  highContrast: false,
  quality: 'medium',
  volume: 0.45,
  shake: 0.35,
  uiScale: 1,
  mapping: {
    buttonActions: { ...DEFAULT_BUTTON_ACTIONS },
    device: null,
    wheelSteering: false,
    saturation: 1,
    calibration: emptyCalibration(),
    clutchAxis: -1,
    clutchButton: -1,
    manualClutch: false,
    shiftUpButton: 5,
    shiftDownButton: 4,
    steerAxis: 0,
    throttleAxis: 2,
    brakeAxis: 5,
    throttleButton: 7,
    brakeButton: 6,
    axisPedals: false,
    invertSteer: false,
    invertPedals: false,
    deadzone: 0.08,
    exponent: 1.5,
  },
  setup: { ...DEFAULT_SETUP },
  bindings: { ...DEFAULT_BINDINGS },
};
export function validateSettings(v: unknown): Settings {
  if (!v || typeof v !== 'object') throw new Error('Settings data must be an object');
  const p = v as Partial<Settings>;
  if (![1, 2, 3, 4, 5].includes((v as { version: number }).version))
    throw new Error('Unsupported settings version');
  const finite = (x: unknown, f: number, a: number, b: number) =>
    typeof x === 'number' && Number.isFinite(x) ? clamp(x, a, b) : f;
  const m = p.mapping ?? DEFAULT_SETTINGS.mapping;
  const bindings = validateBindings(p.bindings);
  const quality = p.quality === 'low' || p.quality === 'high' ? p.quality : 'medium';
  const result: Settings = {
    version: 5,
    graphics: validateGraphics((p.version as number) >= 4 ? p.graphics : undefined, quality),
    colorblind: p.colorblind === true,
    highContrast: p.highContrast === true,
    quality,
    volume: finite(p.volume, 0.45, 0, 1),
    shake: finite(p.shake, 0.35, 0, 1),
    uiScale: finite(p.uiScale, 1, 0.8, 1.35),
    setup: validateSetup(p.setup ?? DEFAULT_SETUP),
    bindings,
    mapping: {
      buttonActions: { ...DEFAULT_BUTTON_ACTIONS },
      device: validateDevice(m.device),
      wheelSteering: !!m.wheelSteering,
      saturation: finite(m.saturation, 1, 0.5, 1),
      calibration: validateCalibration(m.calibration),
      clutchAxis: Math.round(finite(m.clutchAxis, -1, -1, 31)),
      clutchButton: Math.round(finite(m.clutchButton, -1, -1, 127)),
      manualClutch: !!m.manualClutch,
      shiftUpButton: Math.round(finite(m.shiftUpButton, 5, -1, 127)),
      shiftDownButton: Math.round(finite(m.shiftDownButton, 4, -1, 127)),
      steerAxis: Math.round(finite(m.steerAxis, 0, 0, 31)),
      throttleAxis: Math.round(finite(m.throttleAxis, 2, 0, 31)),
      brakeAxis: Math.round(finite(m.brakeAxis, 5, 0, 31)),
      throttleButton: Math.round(finite(m.throttleButton, 7, -1, 127)),
      brakeButton: Math.round(finite(m.brakeButton, 6, -1, 127)),
      axisPedals: !!m.axisPedals,
      invertSteer: !!m.invertSteer,
      invertPedals: !!m.invertPedals,
      deadzone: finite(m.deadzone, 0.08, 0, 0.35),
      exponent: finite(m.exponent, 1.5, 0.5, 3),
    },
  };
  result.mapping.buttonActions = validateButtonActions(
    m.buttonActions,
    result.mapping,
    (p.version as number) < 5,
  );
  return result;
}
export class SaveStore {
  private db: Promise<IDBDatabase> | null = null;
  private open() {
    return (this.db ??= new Promise<IDBDatabase>((resolve, reject) => {
      if (!globalThis.indexedDB) {
        reject(new Error('IndexedDB unavailable; settings will last for this session only.'));
        return;
      }
      const request = indexedDB.open('apex-formula', 1);
      request.onupgradeneeded = () => request.result.createObjectStore('saved');
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => {
        this.db = null;
        reject(request.error ?? new Error('Storage unavailable'));
      };
      request.onblocked = () => reject(new Error('Close older APEX tabs to update local storage.'));
    }));
  }
  async read(key: string): Promise<unknown> {
    const db = await this.open();
    return new Promise((resolve, reject) => {
      const tx = db.transaction('saved', 'readonly'),
        r = tx.objectStore('saved').get(key);
      r.onsuccess = () => resolve(r.result);
      r.onerror = () => reject(r.error);
    });
  }
  async write(key: string, value: unknown) {
    const db = await this.open();
    return new Promise<void>((resolve, reject) => {
      const tx = db.transaction('saved', 'readwrite');
      tx.objectStore('saved').put(value, key);
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
      tx.onabort = () => reject(tx.error ?? new Error('Save aborted'));
    });
  }
}
export function downloadBlob(data: Blob, name: string) {
  const url = URL.createObjectURL(data),
    a = document.createElement('a');
  a.href = url;
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
