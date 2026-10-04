import * as T from 'three';
import { describe, expect, it, vi } from 'vitest';
import { RecordedSignalDisplays } from '../src/rendering/recorded-signal-displays.ts';
import { postSignal } from '../src/rendering/marshal-staff.ts';
import { safetyPanelAppearance } from '../src/rendering/track-infrastructure.ts';
import { batchScene } from '../src/rendering/geometry.ts';
import { F, H, HEADER, CAR_STRIDE, carBase } from '../src/simulation/protocol.ts';
import { FLAG } from '../src/simulation/marshal.ts';
function fixture() {
  const display = new RecordedSignalDisplays(),
    original = new T.MeshStandardMaterial();
  const geometry = new T.BoxGeometry(0.09, 0.72, 1.15);
  const panels = [new T.Mesh(geometry, original), new T.Mesh(geometry, original)];
  display.bind(panels[0], 400);
  display.bind(panels[1], 900);
  const frame = new Float32Array(HEADER + CAR_STRIDE * 2);
  frame[H.CARS] = 2;
  frame[H.LENGTH] = 3000;
  frame[carBase(0) + F.S] = 401;
  frame[carBase(1) + F.S] = 901;
  const dispose = () => {
    display.dispose();
    original.dispose();
    geometry.dispose();
  };
  return { display, original, panels, frame, geometry, dispose };
}
describe('A08 recorded local display presentation', () => {
  for (const flag of Object.values(FLAG))
    it(`uses actual supported witness ${flag} and shared palette`, () => {
      const f = fixture();
      try {
        f.frame[carBase(0) + F.LOCAL_FLAG] = flag;
        const before = f.frame.slice();
        f.display.update(f.frame);
        const expected = postSignal(f.frame, 400),
          appearance = safetyPanelAppearance(expected);
        expect(f.panels[0].material).toBe(f.display.materials[expected]);
        expect(f.panels[0].material.emissive.getHex()).toBe(appearance.color);
        expect(f.panels[0].material.emissiveIntensity).toBe(appearance.intensity);
        expect(f.panels[1].material).toBe(f.display.materials[FLAG.GREEN]);
        expect(f.frame).toEqual(before);
      } finally {
        f.dispose();
      }
    });
  it('holds, rewinds and resets without allocating materials or altering snapshots', () => {
    const f = fixture();
    try {
      const materials = [...f.display.materials];
      const history = [FLAG.GREEN, FLAG.YELLOW, FLAG.DOUBLE_YELLOW, FLAG.BLUE].map((flag) => {
        const frame = f.frame.slice();
        frame[carBase(0) + F.LOCAL_FLAG] = flag;
        return frame;
      });
      for (const i of [0, 1, 2, 3, 2, 2, 0]) {
        const before = history[i].slice();
        f.display.update(history[i]);
        expect(f.panels[0].material).toBe(materials[postSignal(history[i], 400)]);
        expect(history[i]).toEqual(before);
      }
      expect(f.display.materials).toEqual(materials);
    } finally {
      f.dispose();
    }
  });
  it('does not project the player yellow onto distant, pitting or retired witnesses', () => {
    const f = fixture();
    try {
      f.frame[H.FLAG] = FLAG.YELLOW;
      f.frame[carBase(0) + F.LOCAL_FLAG] = FLAG.YELLOW;
      for (const slot of [F.IN_PIT, F.RETIRED]) {
        f.frame[carBase(0) + slot] = 1;
        f.display.update(f.frame);
        expect(f.panels[0].material).toBe(f.display.materials[FLAG.GREEN]);
        f.frame[carBase(0) + slot] = 0;
      }
      f.frame[carBase(0) + F.S] = 460;
      f.display.update(f.frame);
      expect(f.panels.every((p) => p.material === f.display.materials[FLAG.GREEN])).toBe(true);
    } finally {
      f.dispose();
    }
  });
  it('preserves the bound LED objects through batching and restores borrowed ownership once', () => {
    const f = fixture(),
      root = new T.Group();
    root.add(...f.panels);
    try {
      batchScene(root, new Set(f.display.meshes));
      expect(root.children).toEqual(f.panels);
      const spies = f.display.materials.map((m) => vi.spyOn(m, 'dispose'));
      const borrowed = vi.spyOn(f.original, 'dispose'),
        geometry = vi.spyOn(f.geometry, 'dispose');
      f.display.update(f.frame);
      f.display.dispose();
      f.display.dispose();
      expect(f.panels.every((p) => p.material === f.original)).toBe(true);
      expect(spies.every((s) => s.mock.calls.length === 1)).toBe(true);
      expect(borrowed).not.toHaveBeenCalled();
      expect(geometry).not.toHaveBeenCalled();
      expect(() => f.display.bind(f.panels[0], 10)).toThrow('disposed');
    } finally {
      f.dispose();
    }
  });
  it('rejects malformed snapshots atomically and rejects duplicate bindings', () => {
    const f = fixture();
    try {
      expect(() => f.display.bind(f.panels[0], 400)).toThrow('duplicate');
      f.display.update(f.frame);
      const before = f.panels.map((p) => p.material);
      f.frame[carBase(1) + F.LOCAL_FLAG] = NaN;
      expect(() => f.display.update(f.frame)).toThrow('Non-finite');
      expect(f.panels.map((p) => p.material)).toEqual(before);
      expect(() => f.display.update(new Float32Array(2))).toThrow('Invalid');
    } finally {
      f.dispose();
    }
  });
});
