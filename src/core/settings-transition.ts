import type { Settings } from '../storage/data.ts';

export type SettingsPhase = 'idle' | 'preparing' | 'applying' | 'saving';
export type SettingsOutcome = { saved: true } | { saved: false; error: string };

type GraphicsSettings = Pick<Settings, 'quality' | 'graphics'>;

/** Validated graphics are scalar values. Ignore identity and property order, not
 * custom options: a preset label alone does not describe the active workload. */
export function graphicsSettingsChanged(before: GraphicsSettings, after: GraphicsSettings): boolean {
  if (before.quality !== after.quality) return true;
  const keys = new Set([
    ...Object.keys(before.graphics),
    ...Object.keys(after.graphics),
  ] as (keyof Settings['graphics'])[]);
  for (const key of keys) {
    if (before.graphics[key] !== after.graphics[key]) return true;
  }
  return false;
}

/** Yield a real task, not another microtask or a hidden-tab-dependent RAF. This
 * lets the browser finish input dispatch before graphics resources are changed. */
export function yieldBrowserTask(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 0));
}

export interface SettingsChange {
  cancelled: () => boolean;
  phase: (phase: SettingsPhase) => void;
  prepare: () => boolean | Promise<boolean>;
  apply: () => void;
  /** Must resolve on transaction completion, not on a successful put request. */
  save: () => Promise<void>;
  yieldControl?: () => Promise<void>;
}

/** The caller owns duplicate exclusion and renderer lifetime. Graphics failure
 * propagates; persistence failure leaves explicitly session-only preferences.
 * Cancellation suppresses stale completion without pretending to undo a write. */
export async function runSettingsChange(change: SettingsChange): Promise<SettingsOutcome | null> {
  const yieldControl = change.yieldControl ?? yieldBrowserTask;
  try {
    if (change.cancelled()) return null;
    change.phase('preparing');
    await yieldControl();
    if (change.cancelled()) return null;
    if (!(await change.prepare()) || change.cancelled()) return null;
    change.phase('applying');
    change.apply();
    if (change.cancelled()) return null;
    change.phase('saving');
    try {
      await change.save();
      return change.cancelled() ? null : { saved: true };
    } catch (error) {
      if (change.cancelled()) return null;
      return { saved: false, error: error instanceof Error ? error.message : String(error) };
    }
  } finally {
    change.phase('idle');
  }
}
