import { describe, expect, it } from 'vitest';
import { menuPreview } from '../src/rendering/menu-preview.ts';
import { DEFAULT_OPTIONS } from '../src/simulation/config.ts';
import { OpenWorldSimulation } from '../src/simulation/open-world/session.ts';
import { CAR_STRIDE, H, HEADER } from '../src/simulation/protocol.ts';
import { Track } from '../src/simulation/track.ts';
import { WEATHER_IDS } from '../src/simulation/weather-catalogue.ts';
import {
  frameLiquidRain,
  snowShare,
  snowfallMmHr,
  weatherKeyframes,
} from '../src/simulation/weather.ts';
import { Simulation } from '../src/simulation/world.ts';

/** protocol.ts documents the weather contract of the snapshot header: RAIN is
 * one precipitation channel and AMBIENT (C) decides what it falls as, so a
 * header with AMBIENT 0 is a freezing day, not "unset". These tests pin that
 * contract and prove every production producer of a header honours it, which
 * is what keeps rain from silently becoming snow (the weather-2 regression
 * that turned 16 hand-built rain fixtures into snowfall). */
describe('snapshot header weather contract', () => {
  it('reads a zeroed header as freezing, so precipitation in it is snow (never "unset")', () => {
    const f = new Float32Array(HEADER + CAR_STRIDE);
    f[H.RAIN] = 5;
    expect(f[H.AMBIENT]).toBe(0);
    expect(snowShare(f[H.AMBIENT])).toBe(1);
    expect(frameLiquidRain(f)).toBe(0);
    expect(snowfallMmHr(f[H.RAIN], f[H.AMBIENT])).toBe(5);
    // The same rain on a mild day is all liquid.
    f[H.AMBIENT] = 18;
    expect(frameLiquidRain(f)).toBe(5);
  });

  describe.each(WEATHER_IDS)('%s', (id) => {
    const keyframe = weatherKeyframes(id)[0],
      snowy = keyframe.ambientTempC < 0;
    // `running`: the timeline has moved on from keyframe 0 (the storm ramps
    // 18 -> 60 mm/h over 40 s), so only the phase and the sign are asserted.
    const expectHeader = (frame: Float32Array, where: string, running: boolean) => {
      expect(frame[H.AMBIENT], `${where}: ambient is the preset's air temperature`).toBeCloseTo(
        keyframe.ambientTempC,
        running ? 0 : 1,
      );
      if (running)
        expect(frame[H.RAIN] > 0, `${where}: precipitation`).toBe(keyframe.rainRateMmHr > 0);
      else expect(frame[H.RAIN], `${where}: precipitation`).toBeCloseTo(keyframe.rainRateMmHr, 1);
      // Rain presets read as liquid rain, the snow preset as snow, from the header alone.
      expect(snowShare(frame[H.AMBIENT]), `${where}: phase`).toBe(snowy ? 1 : 0);
      expect(frameLiquidRain(frame), `${where}: liquid rain`).toBeCloseTo(
        snowy ? 0 : frame[H.RAIN],
        6,
      );
    };

    it('circuit Simulation writes the preset ambient from the first frame and while it runs', () => {
      const sim = new Simulation({
        ...DEFAULT_OPTIONS,
        mode: 'practice',
        opponents: 0,
        weather: id,
      });
      expectHeader(sim.makeFrame(), 'tick 0', false);
      for (let i = 0; i < 240; i++) sim.step(1 / 120);
      expectHeader(sim.makeFrame(), 'after 2 s', true);
    });

    it('festival OpenWorldSimulation writes the preset ambient from the first frame and while it runs', () => {
      const sim = new OpenWorldSimulation({ vehicle: 'tc1', weather: id });
      expectHeader(sim.makeFrame(), 'tick 0', false);
      for (let i = 0; i < 240; i++) sim.step(1 / 120);
      expectHeader(sim.makeFrame(), 'after 2 s', true);
    });
  });

  it('menu preview carries a mild-day header and no precipitation', () => {
    const frame = menuPreview(new Track());
    expect(frame[H.AMBIENT]).toBe(24);
    expect(frame[H.RAIN]).toBe(0);
    expect(snowShare(frame[H.AMBIENT])).toBe(0);
  });
});
