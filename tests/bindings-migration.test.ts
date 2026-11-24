import { expect, it } from 'vitest';
import { DEFAULT_BINDINGS, type Bindings } from '../src/input/bindings.ts';
import { DEFAULT_SETTINGS, validateSettings } from '../src/storage/data.ts';

it.each([false, true])(
  'preserves a legacy layout with every preferred clutch key occupied (complete: %s)',
  (complete) => {
    const saved: Partial<Bindings> = {
      ...(complete ? DEFAULT_BINDINGS : {}),
      throttle: 'ShiftLeft',
      brake: 'ShiftRight',
      reverse: 'ControlRight',
      shiftDown: 'ControlLeft',
      pit: 'KeyQ',
      ers: 'KeyZ',
    };
    delete saved.clutch;
    delete saved.riderForward;
    delete saved.riderBack;

    const settings = validateSettings({
      ...DEFAULT_SETTINGS,
      version: 1,
      bindings: saved,
    });

    expect(settings.bindings).toMatchObject(saved);
    expect(settings.bindings.left).toBe(DEFAULT_BINDINGS.left);
    expect(settings.bindings.right).toBe(DEFAULT_BINDINGS.right);
    expect(Object.values(saved)).not.toContain(settings.bindings.clutch);
    expect(new Set(Object.values(settings.bindings)).size).toBe(
      Object.keys(DEFAULT_BINDINGS).length,
    );
    expect(validateSettings(settings)).toEqual(settings);
  },
);
