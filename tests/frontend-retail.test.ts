import { describe, expect, it } from 'vitest';
import { developerMode } from '../src/ui/dev-mode.ts';
import { LOADING_TIPS, loadingStage } from '../src/ui/loading-copy.ts';
import { conditions, circuitTitle, Interface, SESSION_TITLES } from '../src/ui/interface.ts';
import { DEFAULT_OPTIONS } from '../src/simulation/config.ts';

describe('retail front end', () => {
  it('enables developer tools only with an explicit ?dev query', () => {
    expect(developerMode('')).toBe(false);
    expect(developerMode('?quality=low')).toBe(false);
    expect(developerMode('?dev')).toBe(true);
    expect(developerMode('?dev=1')).toBe(true);
    expect(developerMode('?a=1&dev')).toBe(true);
    expect(developerMode('?dev=0')).toBe(false);
    expect(developerMode('?dev=false')).toBe(false);
  });

  it('translates engineering loader messages into player-facing stages', () => {
    const raw = [
      'Building original bodywork, materials and Aurel circuit…',
      '12% · Loading Blender-authored bodywork',
      '40% · Loading A31 authored wheel guns',
      '70% · Loading A07 start gantry',
      'Preparing grid, race timing and recording buffers…',
      'Building original Formula car 4 / 8…',
      'Building GP motorcycles and riders…',
      'Compiling circuit and vehicle materials…',
      'Compiling shadow casters around the circuit…',
      'Warming shadows and scene reflections…',
      'Warming offscreen pit-service materials…',
      'Waiting for completed chase GPU work…',
      'Warming cockpit, mirrors and post-processing…',
      'Waiting for completed cockpit GPU work…',
    ];
    const stages = raw.map((text) => loadingStage(text));
    for (const stage of stages) {
      expect(stage.title).not.toMatch(/A\d\d|GPU|offscreen|compil|buffer|Blender|authored/i);
      expect(stage.fraction).toBeGreaterThanOrEqual(0);
      expect(stage.fraction).toBeLessThanOrEqual(1);
    }
    expect(stages[1].title).toBe('Loading cars');
    expect(stages[2].title).toBe('Building the pit lane');
    expect(stages[3].title).toBe('Building the circuit');
    expect(stages[5]).toEqual({ title: 'Preparing cars', fraction: 0.25 });
    expect(stages.at(-1)!.title).toBe('Warming up tyres');
    // Session preparation only moves forward.
    const session = stages.slice(4).map((s) => s.fraction);
    expect([...session].sort((a, b) => a - b)).toEqual(session);
    expect(loadingStage('Building Vellamar Coast Circuit / VELLAMAR…').title).toBe(
      'Loading Vellamar Coast Circuit',
    );
    expect(loadingStage('Something new', 0.4)).toEqual({ title: 'Loading', fraction: 0.4 });
    expect(loadingStage('100% · Scene ready…', 0.85)).toEqual({
      title: 'Almost ready',
      fraction: 0.9,
    });
    expect(LOADING_TIPS.length).toBeGreaterThan(3);
  });

  it('uses the whole GP field for loading context and retains MX and mixed-field labels', () => {
    const line = { hidden: true, textContent: '' };
    const ui = {
      get: (id: string) => {
        expect(id).toBe('loadingSession');
        return line;
      },
    } as unknown as Interface;
    for (const [circuit, vehicles, entrants] of [
      ['poggio-alto', ['gpr1', 'gpr2', 'gpr1', 'gpr2'], '4 riders'],
      ['poggio-alto', ['gpr1', 'apx01', 'gpr2', 'apx01'], '4 cars'],
      ['valley-ridge-mx', ['mx450', 'mx450', 'mx450', 'mx450'], '4 riders'],
      ['arena-nord-sx', ['mx250', 'mx250', 'mx250', 'mx250'], '4 riders'],
      ['aurel', undefined, '4 cars'],
    ] as const) {
      Interface.prototype.loadingSession.call(ui, {
        ...DEFAULT_OPTIONS,
        mode: 'practice',
        circuit,
        opponents: 3,
        vehicles: vehicles ? [...vehicles] : undefined,
      });
      expect(line.hidden).toBe(false);
      expect(line.textContent).toContain(entrants);
      expect(line.textContent).toContain('Free Practice');
      expect(line.textContent).toContain('Dry');
    }
    Interface.prototype.loadingSession.call(ui, null);
    expect(line.hidden).toBe(true);
  });

  it('names sessions, circuits and conditions in player language', () => {
    expect(SESSION_TITLES.race).toBe('Grand Prix');
    expect(SESSION_TITLES['time-trial']).toBe('Time Trial');
    expect(circuitTitle('aurel')).toBe('Aurel Grand Circuit');
    expect(circuitTitle('vellamar')).toBe('Vellamar Coast Circuit');
    expect(conditions(24.4, 0, 0)).toBe('DRY<small>24°C</small>');
    expect(conditions(18, 3, 0.5)).toBe('RAIN<small>18°C</small>');
    expect(conditions(18, 0, 0.1)).toBe('WET<small>18°C</small>');
    expect(conditions(Number.NaN, 0, 0)).toBe('—');
  });
});
