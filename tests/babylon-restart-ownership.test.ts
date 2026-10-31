import { readFileSync } from 'node:fs';
import { expect, it, vi } from 'vitest';
import { RestartOwnership } from '../src/engine/babylon/restart-ownership.ts';
import { SimulationComponent } from '../src/engine/simulation-component.ts';
import { controls, DEFAULT_OPTIONS } from '../src/simulation/config.ts';
import { F, carBase } from '../src/simulation/protocol.ts';
function fixture() {
  let component!: SimulationComponent;
  let paused = false;
  const input = { w: false, enabled: true };
  const setPaused = (value: boolean) => {
    paused = value;
    input.enabled = !value;
    input.w = false; // InputController.setEnabled resets keys.
    component.setPaused(value);
  };
  const oldAssets = new AbortController();
  const abortAssets = vi.fn(() => oldAssets.abort());
  const resetAuthority = vi.fn(() => {
    component = new SimulationComponent({ ...DEFAULT_OPTIONS, mode: 'practice', opponents: 0 });
    setPaused(false);
    return component;
  });
  const restart = new RestartOwnership(abortAssets, resetAuthority);
  const rebuild = vi.fn((_owner: SimulationComponent) => {});
  const pump = () => {
    component.setInput({ ...controls(), throttle: input.w && input.enabled ? 1 : 0 });
    component.advance(1 / 60);
  };
  return {
    restart,
    input,
    resetAuthority,
    rebuild,
    oldAssets,
    setPaused,
    pump,
    component: () => component,
    paused: () => paused,
  };
}
it('preserves W pressed after Restart while scene replacement waits for a delayed GPU', () => {
  const f = fixture();
  f.restart.request();
  expect(f.oldAssets.signal.aborted).toBe(true);
  const owner = f.component();
  f.input.w = true;
  for (let i = 0; i < 60; i++) {
    f.pump();
    expect(f.restart.drain(false, f.rebuild)).toBe(false);
  }
  expect(f.rebuild).not.toHaveBeenCalled();
  expect(f.component().frame[carBase(0) + F.THROTTLE]).toBeGreaterThan(0.2);
  expect(f.restart.drain(true, f.rebuild)).toBe(true);
  f.pump();
  expect(f.input.w).toBe(true);
  expect(f.component()).toBe(owner);
  expect(f.resetAuthority).toHaveBeenCalledTimes(1);
  expect(f.component().frame[carBase(0) + F.THROTTLE]).toBeGreaterThan(0.2);
});
it('keeps only the latest repeated restart owner without building the obsolete scene', () => {
  const f = fixture();
  f.restart.request();
  const obsolete = f.component();
  f.restart.request();
  const latest = f.component();
  f.input.w = true;
  expect(latest).not.toBe(obsolete);
  expect(f.restart.drain(false, f.rebuild)).toBe(false);
  f.restart.drain(true, f.rebuild);
  expect(f.rebuild).toHaveBeenCalledExactlyOnceWith(latest);
  expect(f.input.w).toBe(true);
  expect(f.restart.pending).toBe(false);
});
it('does not unpause or clear new input when rebuilding after a pending pause/resume action', () => {
  const f = fixture();
  f.restart.request();
  f.setPaused(true);
  f.restart.drain(true, f.rebuild);
  expect(f.paused()).toBe(true);
  expect(f.input.enabled).toBe(false);
  f.restart.request();
  f.setPaused(true);
  f.setPaused(false);
  f.input.w = true;
  f.restart.drain(true, f.rebuild);
  expect(f.paused()).toBe(false);
  expect(f.input.w).toBe(true);
});
it('keeps input/simulation resets out of deferred Babylon scene replacement', () => {
  const source = readFileSync(new URL('../src/engine/babylon/main.ts', import.meta.url), 'utf8');
  const rebuild = source.slice(
    source.indexOf('function rebuildScene('),
    source.indexOf("window.addEventListener('pagehide'"),
  );
  expect(rebuild).not.toContain('setPaused(');
  expect(rebuild).not.toContain('setEnabled(');
  expect(rebuild).not.toContain('new SimulationComponent');
  expect(source).toContain('restartOwnership.drain(true, rebuildScene)');
});
