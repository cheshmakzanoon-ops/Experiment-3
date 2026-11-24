import {
  DEFAULT_DRIVING_AUDIO,
  validateDrivingAudio,
  type DrivingAudioSettings,
} from '../audio/driving-cues.ts';
import {
  defaultButtonActions,
  validateButtonActions,
  type ButtonActions,
} from '../input/button-actions.ts';
import { DEFAULT_BINDINGS, validateBindings, type Bindings } from '../input/bindings.ts';
import {
  emptyCalibration,
  validateCalibration,
  validateDevice,
  type CalibrationSet,
  type DeviceSelection,
} from '../input/calibration.ts';
import { clamp } from '../core/math.ts';
import { DEFAULT_LEVELS, validateLevels, type AudioLevels } from '../audio/mixer.ts';
import { DEFAULT_RUMBLE, validateRumble, type RumbleSettings } from '../input/rumble.ts';
import { DesktopMirror, idbKv } from './desktop-mirror.ts';
import { validateLanguage, type LanguageSetting } from '../i18n/locales.ts';
import { DEFAULT_HUD_SCALE, validateHudScale, type HudScaleSetting } from '../core/hud-scale.ts';
import { DEFAULT_SETUP, validateSetup, type Setup } from '../simulation/config.ts';
import {
  graphicsPreset,
  isQualityPreset,
  validateGraphics,
  type GraphicsOptions,
  type QualityPreset,
} from '../rendering/options.ts';
export interface InputMapping {
  buttonActions: ButtonActions;
  device: DeviceSelection | null;
  wheelSteering: boolean;
  saturation: number;
  calibration: CalibrationSet;
  clutchAxis: number;
  clutchButton: number;
  rearBrakeButton?: number;
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
  version: 6;
  graphics: GraphicsOptions;
  colorblind: boolean;
  highContrast: boolean;
  /** Race-radio captions (D085) and engineer chatter; race control always shows. */
  captions: boolean;
  engineerRadio: boolean;
  /** Master reduced-motion switch: no camera vibration or motion blur. */
  reducedMotion: boolean;
  /** Skip race-day briefing/preparation on ordinary race entry. */
  quickStart: boolean;
  /** Render preset. 'ultra' is opt-in only: no migration or default selects it. */
  quality: QualityPreset;
  volume: number;
  /** Per-class bus sliders (engine, effects, ambience, menu sounds, music) beside the master `volume`. */
  audioLevels: AudioLevels;
  /** Background music: off by default, and inert until music assets ship (audio/music.ts). */
  musicEnabled: boolean;
  drivingAudio: DrivingAudioSettings;
  /** Gamepad rumble channel strengths (D088). */
  rumble: RumbleSettings;
  shake: number;
  uiScale: number;
  /** HUD SCALE: the race HUD's own size, `auto` (115% under 900 px tall) or 100 / 115 / 130 / 150%. Saves from before
   * it existed, or holding anything else, read as `auto` (core/hud-scale.ts). */
  hudScale: HudScaleSetting;
  /** Interface language: `auto` follows the browser or system (src/i18n). Settings saved
   * before languages existed, or holding an unknown code, read as `auto`. */
  language: LanguageSetting;
  mapping: InputMapping;
  setup: Setup;
  bindings: Bindings;
}
export const DEFAULT_SETTINGS: Settings = {
  version: 6,
  graphics: graphicsPreset('medium'),
  colorblind: false,
  highContrast: false,
  captions: true,
  engineerRadio: true,
  reducedMotion: false,
  quickStart: false,
  quality: 'medium',
  volume: 0.45,
  audioLevels: { ...DEFAULT_LEVELS },
  musicEnabled: false,
  drivingAudio: { ...DEFAULT_DRIVING_AUDIO },
  rumble: { ...DEFAULT_RUMBLE },
  shake: 0.35,
  uiScale: 1,
  hudScale: DEFAULT_HUD_SCALE,
  language: 'auto',
  mapping: {
    buttonActions: defaultButtonActions(true),
    device: null,
    wheelSteering: false,
    saturation: 1,
    calibration: emptyCalibration(),
    clutchAxis: -1,
    clutchButton: -1,
    rearBrakeButton: -1,
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
  const version = (v as { version: number }).version;
  if (![1, 2, 3, 4, 5, 6].includes(version)) throw new Error('Unsupported settings version');
  const finite = (x: unknown, f: number, a: number, b: number) =>
    typeof x === 'number' && Number.isFinite(x) ? clamp(x, a, b) : f;
  const m = p.mapping ?? DEFAULT_SETTINGS.mapping;
  const bindings = validateBindings(p.bindings);
  // Saves from before ULTRA keep their preset; graphics fields added since then
  // validate to that preset's values, which leave every new module off.
  const quality: QualityPreset = isQualityPreset(p.quality) ? p.quality : 'medium';
  const result: Settings = {
    version: 6,
    graphics: validateGraphics(version >= 4 ? p.graphics : undefined, quality),
    colorblind: p.colorblind === true,
    highContrast: p.highContrast === true,
    captions: p.captions !== false,
    engineerRadio: p.engineerRadio !== false,
    reducedMotion: p.reducedMotion === true,
    quickStart: p.quickStart === true,
    quality,
    volume: finite(p.volume, 0.45, 0, 1),
    audioLevels: validateLevels(p.audioLevels),
    musicEnabled: p.musicEnabled === true,
    drivingAudio: validateDrivingAudio(p.drivingAudio),
    rumble: validateRumble(p.rumble),
    shake: finite(p.shake, 0.35, 0, 1),
    uiScale: finite(p.uiScale, 1, 0.8, 1.35),
    hudScale: validateHudScale(p.hudScale),
    language: validateLanguage(p.language),
    setup: validateSetup(p.setup ?? DEFAULT_SETUP),
    bindings,
    mapping: {
      buttonActions: defaultButtonActions(),
      device: validateDevice(m.device),
      wheelSteering: !!m.wheelSteering,
      saturation: finite(m.saturation, 1, 0.5, 1),
      calibration: validateCalibration(m.calibration),
      clutchAxis: Math.round(finite(m.clutchAxis, -1, -1, 31)),
      rearBrakeButton: Math.round(finite(m.rearBrakeButton, -1, -1, 127)),
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
    version === 5 &&
      m.buttonActions &&
      typeof m.buttonActions === 'object' &&
      !Array.isArray(m.buttonActions)
      ? {
          ...m.buttonActions,
          reverse: m.buttonActions.reverse === undefined ? -1 : m.buttonActions.reverse,
        }
      : m.buttonActions,
    result.mapping,
    version < 5,
  );
  return result;
}
export class SaveStore {
  private db: Promise<IDBDatabase> | null = null;
  /** Desktop shell only (window.motobound.desktop): mirrors writes to atomic JSON files. */
  private mirror = DesktopMirror.detect();
  private open() {
    if (this.db) return this.db;
    let resolve!: (db: IDBDatabase) => void;
    let reject!: (error: unknown) => void;
    const pending = new Promise<IDBDatabase>((ready, failed) => {
      resolve = ready;
      reject = failed;
    });
    this.db = pending;
    let connection: IDBDatabase | null = null;
    const fail = (error: unknown) => {
      // A blocked request can finish after a later attempt has already opened.
      if (this.db === pending) this.db = null;
      const closed = connection;
      connection = null;
      closed?.close();
      reject(error);
    };
    try {
      if (!globalThis.indexedDB) {
        throw new Error('IndexedDB unavailable; settings will last for this session only.');
      }
      const request = indexedDB.open('apex-formula', 1);
      request.onupgradeneeded = () => {
        if (this.db !== pending) {
          request.transaction?.abort();
          return;
        }
        request.result.createObjectStore('saved');
      };
      request.onsuccess = () => {
        const db = request.result;
        if (this.db !== pending) {
          db.close();
          return;
        }
        connection = db;
        db.onversionchange = () =>
          fail(new Error('Local storage changed in another tab. Try again.'));
        db.onclose = () => fail(new Error('Local storage connection closed. Try again.'));
        try {
          if (this.mirror) {
            void this.mirror.reconcile(idbKv(db)).then(() => {
              if (this.db === pending) resolve(db);
            }, fail);
          } else resolve(db);
        } catch (error) {
          fail(error);
        }
      };
      request.onerror = () => fail(request.error ?? new Error('Storage unavailable'));
      request.onblocked = () =>
        fail(new Error('Close older MOTOBOUND tabs to update local storage.'));
    } catch (error) {
      fail(error);
    }
    return pending;
  }
  async read(key: string): Promise<unknown> {
    const db = await this.open();
    return new Promise((resolve, reject) => {
      const tx = db.transaction('saved', 'readonly'),
        r = tx.objectStore('saved').get(key);
      tx.oncomplete = () => resolve(r.result);
      r.onerror = () => reject(r.error ?? new Error('Read failed'));
      tx.onerror = () => reject(tx.error ?? new Error('Read failed'));
      tx.onabort = () => reject(tx.error ?? new Error('Read aborted'));
    });
  }
  /** Keep the previous value as `key:backup` and write the new one in the
   * same transaction: an interrupted save leaves either the old pair or the
   * new pair, never a half-written profile without a recovery copy. */
  async writeWithBackup(key: string, value: unknown) {
    const db = await this.open();
    return new Promise<void>((resolve, reject) => {
      const tx = db.transaction('saved', 'readwrite');
      let previousValue: unknown;
      let writtenValue: unknown;
      let revision = 0;
      const abort = (error: unknown) => {
        reject(error);
        try {
          tx.abort();
        } catch {
          /* the transaction has already finished */
        }
      };
      tx.oncomplete = () => {
        this.mirror?.written(
          [
            ...(previousValue !== undefined ? ([[backupKey(key), previousValue]] as const) : []),
            [key, writtenValue],
          ],
          revision,
        );
        resolve();
      };
      tx.onerror = () => reject(tx.error ?? new Error('Save failed'));
      tx.onabort = () => reject(tx.error ?? new Error('Save aborted'));
      try {
        const store = tx.objectStore('saved'),
          previous = store.get(key);
        previous.onerror = () => reject(previous.error ?? new Error('Save failed'));
        previous.onsuccess = () => {
          try {
            previousValue = previous.result;
            if (previousValue !== undefined) store.put(previousValue, backupKey(key));
            // The caller can mutate its object before this transaction commits.
            // Both persisted copies must describe the same enqueue-time value.
            writtenValue = this.mirror ? structuredClone(value) : value;
            store.put(writtenValue, key);
            if (this.mirror) revision = this.mirror.stamp(store);
          } catch (error) {
            abort(error);
          }
        };
      } catch (error) {
        abort(error);
      }
    });
  }
  /** Read `key`, falling back to its backup when the primary is unusable. */
  async readRecovered<T>(key: string, validate: (value: unknown) => T | null) {
    const primary = await this.read(key);
    const needsBackup = (() => {
      try {
        return primary === undefined || validate(primary) === null;
      } catch {
        return true;
      }
    })();
    return recoverSave(
      primary,
      needsBackup ? await this.read(backupKey(key)) : undefined,
      validate,
    );
  }
  /** Every key starting with `prefix` (the records screen lists `leaderboard:` boards). */
  async keys(prefix = ''): Promise<string[]> {
    const db = await this.open();
    return new Promise((resolve, reject) => {
      const tx = db.transaction('saved', 'readonly'),
        r = tx.objectStore('saved').getAllKeys();
      tx.oncomplete = () =>
        resolve(r.result.filter((k): k is string => typeof k === 'string' && k.startsWith(prefix)));
      r.onerror = () => reject(r.error ?? new Error('Read failed'));
      tx.onerror = () => reject(tx.error ?? new Error('Read failed'));
      tx.onabort = () => reject(tx.error ?? new Error('Read aborted'));
    });
  }
  async write(key: string, value: unknown) {
    const db = await this.open();
    return new Promise<void>((resolve, reject) => {
      const tx = db.transaction('saved', 'readwrite');
      let writtenValue: unknown;
      let revision = 0;
      tx.oncomplete = () => {
        this.mirror?.written([[key, writtenValue]], revision);
        resolve();
      };
      tx.onerror = () => reject(tx.error ?? new Error('Save failed'));
      tx.onabort = () => reject(tx.error ?? new Error('Save aborted'));
      try {
        const store = tx.objectStore('saved');
        // Keep the desktop mirror's private snapshot through transaction commit.
        // Browser-only saves retain the ordinary IndexedDB cloning path.
        writtenValue = this.mirror ? structuredClone(value) : value;
        store.put(writtenValue, key);
        if (this.mirror) revision = this.mirror.stamp(store);
      } catch (error) {
        reject(error);
        try {
          tx.abort();
        } catch {
          /* the transaction has already finished */
        }
      }
    });
  }
}
/** Choose a usable save (WP24 / D099): the primary when it validates, else
 * the backup written before the last overwrite. `validate` may throw or
 * return null for unusable data. Never invents progress. */
export function recoverSave<T>(
  primary: unknown,
  backup: unknown,
  validate: (value: unknown) => T | null,
): { value: T | null; recovered: boolean; reason: string | null } {
  const attempt = (value: unknown): [T | null, string | null] => {
    if (value === undefined || value === null) return [null, 'missing'];
    try {
      const result = validate(value);
      return result === null ? [null, 'invalid'] : [result, null];
    } catch (error) {
      return [null, error instanceof Error ? error.message : String(error)];
    }
  };
  const [main, reason] = attempt(primary);
  if (main !== null) return { value: main, recovered: false, reason: null };
  const [old] = attempt(backup);
  return { value: old, recovered: old !== null, reason: primary === undefined ? null : reason };
}
export const backupKey = (key: string) => `${key}:backup`;
export function downloadBlob(data: Blob, name: string) {
  const url = URL.createObjectURL(data),
    a = document.createElement('a');
  a.href = url;
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
