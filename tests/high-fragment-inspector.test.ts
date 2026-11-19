import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import { expect, it } from 'vitest';
import ts from 'typescript';

// Compile the actual browser init function, without importing/registering the
// Playwright test or launching a browser. The driver below owns its independent
// linked-output results and records the order of native operations.
const path = new URL('../e2e/graphics-high-journey.spec.ts', import.meta.url);
const source = ts.createSourceFile(
  path.pathname,
  readFileSync(path, 'utf8'),
  ts.ScriptTarget.Latest,
  true,
);
const declaration = source.statements.find(
  (node): node is ts.FunctionDeclaration =>
    ts.isFunctionDeclaration(node) && node.name?.text === 'installInstancedFragmentOutputs',
)!;
const script = ts.transpileModule(declaration.getText(source), {
  compilerOptions: { target: ts.ScriptTarget.ES2022 },
}).outputText;

type Program = { linked: boolean; outputs: Map<string, number> };
type Shader = { type: number; source: string };
function fixture() {
  const calls: { name: string; args: unknown[]; receiver: unknown; phase: string }[] = [],
    warnings: string[] = [],
    spans: { kind: string; method: string }[] = [];
  let phase = 'metadata',
    nativeFailure: { method: string; error: Error } | null = null;
  class Driver {
    TEXTURE0 = 33984;
    FRAGMENT_SHADER = 35632;
    LINK_STATUS = 35714;
    MAX_DRAW_BUFFERS = 34852;
    DRAW_BUFFER0 = 34853;
    NONE = 0;
    drawBuffers = [36064];
    record(name: string, args: unknown[]) {
      calls.push({ name, args, receiver: this, phase });
      if (nativeFailure?.method === name) throw nativeFailure.error;
    }
    activeTexture(...args: unknown[]) {
      this.record('activeTexture', args);
    }
    bindTexture(...args: unknown[]) {
      this.record('bindTexture', args);
    }
    texStorage2D(...args: unknown[]) {
      this.record('texStorage2D', args);
    }
    createShader(type: number): Shader {
      this.record('createShader', [type]);
      return { type, source: '' };
    }
    shaderSource(shader: Shader, value: string) {
      this.record('shaderSource', [shader, value]);
      shader.source = value;
    }
    attachShader(...args: unknown[]) {
      this.record('attachShader', args);
    }
    linkProgram(...args: unknown[]) {
      this.record('linkProgram', args);
    }
    getProgramParameter(program: Program, parameter: number) {
      this.record('getProgramParameter', [program, parameter]);
      return parameter === this.LINK_STATUS ? program.linked : 7;
    }
    getFragDataLocation(program: Program, name: string) {
      this.record('getFragDataLocation', [program, name]);
      return program.outputs.get(name) ?? -1;
    }
    useProgram(...args: unknown[]) {
      this.record('useProgram', args);
    }
    getParameter(parameter: number) {
      this.record('getParameter', [parameter]);
      return parameter === this.MAX_DRAW_BUFFERS
        ? this.drawBuffers.length
        : this.drawBuffers[parameter - this.DRAW_BUFFER0];
    }
    drawElementsInstanced(...args: unknown[]) {
      this.record('drawElementsInstanced', args);
    }
    drawArraysInstanced(...args: unknown[]) {
      this.record('drawArraysInstanced', args);
    }
  }
  // The real startup tracer is installed before the inspector. These spans
  // independently verify that the native status call returns before the added
  // diagnostic read, so a location wait cannot be charged to native LINK_STATUS.
  const traced = Driver.prototype as unknown as Record<string, (...args: unknown[]) => unknown>;
  for (const method of ['getProgramParameter', 'getFragDataLocation']) {
    const native = traced[method];
    traced[method] = function (this: Driver, ...args: unknown[]) {
      spans.push({ kind: 'start', method });
      try {
        return Reflect.apply(native, this, args);
      } finally {
        spans.push({ kind: 'end', method });
      }
    };
  }
  vm.runInNewContext(script + '\ninstallInstancedFragmentOutputs();', {
    WebGL2RenderingContext: Driver,
    console: { warn: (text: string) => warnings.push(text) },
    performance: { now: () => 123 },
  });
  const gl = new Driver();
  const link = (fragment = 'layout(location = 0) out highp vec4 pc_fragColor;', active = true) => {
    const program: Program = {
      linked: true,
      outputs: new Map([['pc_fragColor', active ? 0 : -1]]),
    };
    const shader = gl.createShader(gl.FRAGMENT_SHADER);
    gl.shaderSource(shader, fragment);
    gl.attachShader(program, shader);
    gl.linkProgram(program);
    gl.useProgram(program);
    return { program, shader };
  };
  return {
    gl,
    calls,
    warnings,
    spans,
    link,
    phase: (value: string) => {
      phase = value;
    },
    fail: (method: string, error: Error) => {
      nativeFailure = { method, error };
    },
    locations: () => calls.filter((call) => call.name === 'getFragDataLocation'),
  };
}

it('caches outputs after a completed native link-status read, before queued draws', () => {
  const f = fixture(),
    { program } = f.link();
  expect(f.locations()).toEqual([]); // linkProgram stays asynchronous
  expect(f.gl.getProgramParameter(program, f.gl.LINK_STATUS)).toBe(true);
  expect(f.locations()).toHaveLength(1);
  expect(f.spans).toEqual([
    { kind: 'start', method: 'getProgramParameter' },
    { kind: 'end', method: 'getProgramParameter' },
    { kind: 'start', method: 'getFragDataLocation' },
    { kind: 'end', method: 'getFragDataLocation' },
  ]);
  f.phase('after-queued-cube-faces');
  f.gl.drawElementsInstanced(4, 6, 5123, 0, 12);
  f.gl.drawArraysInstanced(4, 0, 3, 12);
  expect(f.locations()).toHaveLength(1);
  expect(f.locations()[0].phase).toBe('metadata');
  expect(f.calls.some((call) => call.name === 'getParameter')).toBe(false);
  expect(f.calls.at(-2)).toMatchObject({
    name: 'drawElementsInstanced',
    args: [4, 6, 5123, 0, 12],
    receiver: f.gl,
  });
  expect(f.warnings).toEqual([]);
});

it('leaves failed links, parallel-completion polling and other metadata results untouched', () => {
  const f = fixture(),
    { program } = f.link();
  program.linked = false;
  expect(f.gl.getProgramParameter(program, f.gl.LINK_STATUS)).toBe(false);
  expect(f.gl.getProgramParameter(program, 37297)).toBe(7); // COMPLETION_STATUS_KHR
  expect(f.gl.getProgramParameter(program, 35718)).toBe(7); // ACTIVE_UNIFORMS
  expect(f.locations()).toEqual([]);
  expect(f.calls.filter((call) => call.name === 'getProgramParameter')).toHaveLength(3);
  program.linked = true;
  f.gl.getProgramParameter(program, f.gl.LINK_STATUS);
  f.gl.getProgramParameter(program, f.gl.LINK_STATUS);
  expect(f.locations()).toHaveLength(1);
});

it('invalidates cached outputs and first-draw inspection on relink, but keeps the linked source stable', () => {
  const f = fixture(),
    { program, shader } = f.link();
  f.gl.getProgramParameter(program, f.gl.LINK_STATUS);
  f.gl.drawArraysInstanced(4, 0, 3, 2);
  f.gl.shaderSource(shader, 'out vec4 replacement[2];');
  f.gl.getProgramParameter(program, f.gl.LINK_STATUS);
  expect(f.locations()).toHaveLength(1);
  f.gl.linkProgram(program);
  program.outputs = new Map([['replacement[0]', -1]]);
  expect(f.locations()).toHaveLength(1);
  f.gl.getProgramParameter(program, f.gl.LINK_STATUS);
  expect(f.locations().map((call) => call.args[1])).toEqual(['pc_fragColor', 'replacement[0]']);
  expect(f.warnings).toEqual([]); // draw-buffer state is checked at the actual draw
  f.gl.drawArraysInstanced(4, 0, 3, 2);
  expect(f.warnings).toHaveLength(1);
  const warning = JSON.parse(f.warnings[0].slice('APEX_HIGH_MISSING_FRAGMENT_OUTPUT '.length));
  expect(warning).toMatchObject({
    outputs: [{ name: 'replacement[0]', location: -1 }],
    drawBuffers: [36064],
    source: 'out vec4 replacement[2];',
  });
});

it('retains first-instanced-draw fallback when production never requested link metadata', () => {
  const f = fixture();
  f.link(undefined, false);
  f.phase('first-draw-fallback');
  f.gl.drawElementsInstanced(4, 12, 5123, 0, 3);
  f.gl.drawElementsInstanced(4, 12, 5123, 0, 3);
  expect(f.locations()).toHaveLength(1);
  expect(f.locations()[0].phase).toBe('first-draw-fallback');
  expect(f.warnings).toHaveLength(1);
  expect(f.calls.filter((call) => call.name === 'drawElementsInstanced')).toHaveLength(2);
});

it('uses actual draw-buffer state for missing outputs without warning on a color-disabled pass', () => {
  const f = fixture(),
    { program } = f.link(undefined, false);
  f.gl.getProgramParameter(program, f.gl.LINK_STATUS);
  expect(f.calls.some((call) => call.name === 'getParameter')).toBe(false);
  f.gl.drawBuffers = [f.gl.NONE];
  f.gl.drawArraysInstanced(4, 0, 3, 2);
  expect(f.warnings).toEqual([]);
  f.gl.linkProgram(program);
  f.gl.getProgramParameter(program, f.gl.LINK_STATUS);
  f.gl.drawBuffers = [36064];
  f.gl.drawArraysInstanced(4, 0, 3, 2);
  expect(f.warnings).toHaveLength(1);
});

it('preserves the native status exception and performs no speculative output query after it', () => {
  const f = fixture(),
    { program } = f.link(),
    failure = new Error('native status failure');
  f.fail('getProgramParameter', failure);
  expect(() => f.gl.getProgramParameter(program, f.gl.LINK_STATUS)).toThrow(failure);
  expect(f.locations()).toEqual([]);
  expect(f.calls.at(-1)?.receiver).toBe(f.gl);
});
