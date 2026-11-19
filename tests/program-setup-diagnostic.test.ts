import { describe, expect, it } from 'vitest';
import {
  installProgramSetupDiagnostic,
  type ProgramSetupDiagnosticOptions,
} from '../e2e/fixtures/program-setup-diagnostic.ts';

const methods = [
  'uniform1f',
  'uniform2f',
  'uniform3f',
  'uniform4f',
  'uniform1fv',
  'uniform2fv',
  'uniform3fv',
  'uniform4fv',
  'uniform1i',
  'uniform2i',
  'uniform3i',
  'uniform4i',
  'uniform1iv',
  'uniform2iv',
  'uniform3iv',
  'uniform4iv',
  'uniform1ui',
  'uniform2ui',
  'uniform3ui',
  'uniform4ui',
  'uniform1uiv',
  'uniform2uiv',
  'uniform3uiv',
  'uniform4uiv',
  'uniformMatrix2fv',
  'uniformMatrix3fv',
  'uniformMatrix4fv',
  'activeTexture',
  'bindTexture',
];

function fixture(install = installProgramSetupDiagnostic) {
  const calls: { method: string; receiver: unknown; args: unknown[] }[] = [];
  const reports: Record<string, unknown>[] = [];
  const prototype: ProgramSetupDiagnosticOptions['prototype'] = {};
  const receiver = {} as WebGL2RenderingContext;
  const result = {},
    location = {},
    program = {},
    texture = {};
  const nativeError = new Error('native error');
  let active = true,
    stage = 'Warming shadows and scene reflections…';
  let time = 0,
    duration = 0.25,
    clockReads = 0,
    throws = false;
  const identities = new Map<object, number>([
    [program, 42],
    [texture, 73],
  ]);
  for (const method of methods)
    prototype[method] = function (this: unknown, ...args) {
      calls.push({ method, receiver: this, args });
      time += duration;
      if (throws) throw nativeError;
      return result;
    };
  prototype.getUniformLocation = function (this: unknown, ...args) {
    calls.push({ method: 'getUniformLocation', receiver: this, args });
    if (throws) throw nativeError;
    return args[1] === 'missing' ? null : location;
  };
  const options: ProgramSetupDiagnosticOptions = {
    prototype,
    active: () => active,
    stage: () => stage,
    now: () => {
      clockReads++;
      return time;
    },
    identify: (object) => (object ? (identities.get(object) ?? 99) : 0),
    describeContext: () => ({ program: 84, fragmentHash: '12345678', framebuffer: 5 }),
    report: (record) => reports.push(record),
  };
  const observer = install(options);
  return {
    calls,
    reports,
    prototype,
    receiver,
    result,
    location,
    program,
    texture,
    nativeError,
    options,
    observer,
    clockReads: () => clockReads,
    setActive: (value: boolean) => {
      active = value;
    },
    setStage: (value: string) => {
      stage = value;
    },
    setDuration: (value: number) => {
      duration = value;
    },
    setThrows: (value: boolean) => {
      throws = value;
    },
    call(method: string, ...args: unknown[]) {
      return prototype[method].call(receiver, ...args);
    },
  };
}

describe('passive High program-setup diagnostics', () => {
  it('forwards every scalar/vector/matrix and texture call once with identical receiver, arguments and result', () => {
    const f = fixture();
    const array = new Float32Array(32);
    const args = [f.location, false, array, 4, 16];
    for (const method of methods) {
      expect(f.call(method, ...args)).toBe(f.result);
      const native = f.calls.at(-1)!;
      expect(native.method).toBe(method);
      expect(native.receiver).toBe(f.receiver);
      expect(native.args).toHaveLength(args.length);
      native.args.forEach((value, index) => expect(value).toBe(args[index]));
    }
    expect(f.calls).toHaveLength(methods.length);
    expect(f.reports).toHaveLength(0);
    expect(array).toEqual(new Float32Array(32));
  });

  it('caches only actual uniform-location returns, including an inactive query, without another GL query', () => {
    const f = fixture();
    f.setActive(false);
    expect(f.call('getUniformLocation', f.program, 'projectionMatrix')).toBe(f.location);
    expect(f.call('getUniformLocation', f.program, 'missing')).toBeNull();
    expect(f.clockReads()).toBe(0);
    f.setActive(true);
    f.setDuration(125);
    f.call('uniformMatrix4fv', f.location, false, new Float32Array(16));
    const slow = f.reports.find((r) => r.kind === 'slow-program-setup')!;
    expect(slow.uniform).toEqual({ program: 42, name: 'projectionMatrix' });
    expect(slow.program).toBe(84); // Bound program is independently reported.
    expect(slow.sourceBufferBytes).toBe(64);
    expect(slow.cpuCallMs).toBe(125);
    expect(f.calls.map((c) => c.method)).toEqual([
      'getUniformLocation',
      'getUniformLocation',
      'uniformMatrix4fv',
    ]);
  });

  it('observes texture arguments and the last successful unit selection without assigning texture or uniform state', () => {
    const f = fixture();
    f.setActive(false);
    expect(f.call('activeTexture', 0x84c3)).toBe(f.result);
    f.setActive(true);
    f.setDuration(150);
    f.call('bindTexture', 0x0de1, f.texture);
    const slow = f.reports.find((r) => r.kind === 'slow-program-setup')!;
    expect(slow.texture).toEqual({ target: 0x0de1, owner: 73, unit: 0x84c3 });
    expect(slow.uniform).toBeNull();
    expect(f.calls.map((c) => c.method)).toEqual(['activeTexture', 'bindTexture']);
  });

  it('caps slow records while counting all fast, slow and thrown calls cumulatively', () => {
    const f = fixture();
    for (let i = 0; i < 90; i++) f.call('uniform1f', f.location, i);
    f.setDuration(150);
    for (let i = 0; i < 20; i++) f.call('uniform1f', f.location, i);
    f.setThrows(true);
    expect(() => f.call('uniform1f', f.location, 1)).toThrow(f.nativeError);
    f.observer.flush('stage-transition');
    const slow = f.reports.filter((r) => r.kind === 'slow-program-setup');
    const summary = f.reports.filter((r) => r.kind === 'program-setup-summary').at(-1)!;
    expect(slow).toHaveLength(16);
    expect(summary.reportedSlowCalls).toBe(16);
    expect(summary.methods).toHaveProperty('uniform1f', {
      calls: 111,
      cpuCallMs: 3172.5,
      maximumCallMs: 150,
      slowCalls: 21,
      throws: 1,
    });
    expect(f.calls).toHaveLength(111);
    const before = f.reports.length;
    f.observer.flush('interval');
    expect(f.reports).toHaveLength(before);
    f.setThrows(false);
    f.setDuration(0.25);
    f.call('uniform1f', f.location, 1);
    expect(summary.methods).toHaveProperty('uniform1f.calls', 111);
  });

  it('preserves exact native exceptions and results even when diagnostic reporting fails', () => {
    const f = fixture();
    f.setDuration(150);
    f.options.report = () => {
      throw new Error('diagnostic transport unavailable');
    };
    expect(f.call('uniform3fv', f.location, new Float32Array(3))).toBe(f.result);
    f.setThrows(true);
    let thrown: unknown;
    try {
      f.call('uniform3fv', f.location, new Float32Array(3));
    } catch (error) {
      thrown = error;
    }
    expect(thrown).toBe(f.nativeError);
    expect(f.calls).toHaveLength(2);
    f.options.describeContext = () => {
      throw new Error('diagnostic context unavailable');
    };
    try {
      f.call('uniformMatrix4fv', f.location, false, new Float32Array(16));
    } catch (error) {
      thrown = error;
    }
    expect(thrown).toBe(f.nativeError);
    expect(f.calls).toHaveLength(3);
    expect(() => f.call('getUniformLocation', f.program, 'projectionMatrix')).toThrow(
      f.nativeError,
    );
    expect(f.calls).toHaveLength(4);
  });

  it('stays passive outside startup and serializes without module or worker dependencies', () => {
    const serialized = new Function(
      `return (${installProgramSetupDiagnostic.toString()});`,
    )() as typeof installProgramSetupDiagnostic;
    const f = fixture(serialized);
    f.setActive(false);
    for (const method of methods) expect(f.call(method, null, 1)).toBe(f.result);
    f.observer.flush('inactive');
    expect(f.clockReads()).toBe(0);
    expect(f.reports).toHaveLength(0);
    f.setActive(true);
    f.setStage('Warming offscreen pit-service materials…');
    f.call('uniform1i', null, 0);
    f.observer.flush('interval');
    expect(f.reports).toHaveLength(1);
    expect(f.reports[0].stage).toBe('Warming offscreen pit-service materials…');
    expect(f.calls).toHaveLength(methods.length + 1);
  });
});
