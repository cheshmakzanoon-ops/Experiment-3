import fs from 'node:fs';
import vm from 'node:vm';
import assert from 'node:assert/strict';
import ts from 'typescript';
import { fileURLToPath } from 'node:url';

const file = fileURLToPath(
  new URL('../../../../../../e2e/graphics-high-journey.spec.ts', import.meta.url),
);
const input = ts.createSourceFile(
  file,
  fs.readFileSync(file, 'utf8'),
  ts.ScriptTarget.Latest,
  true,
);
const declaration = input.statements.find(
  (node) => ts.isFunctionDeclaration(node) && node.name?.text === 'installFirstChaseStartup',
);
const script = ts.transpileModule(declaration.getText(input), {
  compilerOptions: { target: ts.ScriptTarget.ES2022 },
}).outputText;
let now = 0,
  observe,
  worker,
  nativeBehavior = null;
class TestNode {
  value = 'Preparing circuit';
  get textContent() {
    return this.value;
  }
  set textContent(value) {
    this.value = value;
  }
}
const calls = [],
  records = [],
  blobs = new Map(),
  loading = new TestNode();
const report = (text) => records.push(JSON.parse(text.slice('APEX_HIGH_STARTUP '.length)));
const constants = {
  READ_FRAMEBUFFER: 36008,
  DRAW_FRAMEBUFFER: 36009,
  FRAMEBUFFER: 36160,
  COLOR_ATTACHMENT0: 36064,
  FRAGMENT_SHADER: 35632,
};
function GL() {}
GL.prototype = new Proxy(
  {},
  {
    get(target, name) {
      if (name in target) return target[name];
      if (name in constants) return constants[name];
      return (target[name] = function (...args) {
        calls.push({ name, args, receiver: this });
        if (name === 'createShader') return {};
        if (nativeBehavior) return nativeBehavior(name, args);
      });
    },
  },
);
class TestWorker {
  constructor(url) {
    worker = this;
    this.context = vm.createContext({
      self: { location: { href: url } },
      Float64Array,
      performance: { now: () => now },
      console: { info: report },
      setInterval: (callback, ms) => {
        assert.equal(ms, 500);
        this.tick = callback;
      },
    });
    vm.runInContext(blobs.get(url), this.context);
  }
  postMessage(message) {
    if (this.failPost) throw new Error('diagnostic channel closed');
    this.context.self.onmessage({ data: structuredClone(message) });
  }
  terminate() {
    this.terminated = true;
  }
}
const context = vm.createContext({
  console: { info: report },
  performance: { now: () => now },
  Float64Array,
  ArrayBuffer,
  WebGL2RenderingContext: GL,
  Worker: TestWorker,
  Node: TestNode,
  Blob: class {
    constructor(parts) {
      this.source = parts.join('');
    }
  },
  URL: {
    createObjectURL(blob) {
      blobs.set('blob:startup-proof', blob.source);
      return 'blob:startup-proof';
    },
    revokeObjectURL() {},
  },
  document: { getElementById: () => loading },
  MutationObserver: class {
    constructor(callback) {
      observe = callback;
    }
    disconnect() {}
    observe() {}
  },
});
vm.runInContext(script + '\ninstallFirstChaseStartup();', context);
const gl = new GL();
gl.drawArrays(4, 0, 3);
assert.equal(
  records.some((record) => record.kind === 'first-use'),
  false,
);
const shader = gl.createShader(35632),
  program = {},
  framebuffer = {};
gl.shaderSource(
  shader,
  '#define SHADER_NAME GroundProof\n#define USE_NORMALMAP\nout vec4 color; void main(){color=vec4(1.0);}',
);
gl.attachShader(program, shader);
gl.bindFramebuffer(36160, framebuffer);
gl.framebufferTexture2D(36160, 36064, 34069, {}, 0);
gl.viewport(0, 0, 256, 256);
gl.useProgram(program);
loading.textContent = 'Preparing reflections…';
assert.equal(records.at(-1).stage, 'Preparing reflections…');
nativeBehavior = (name) => {
  if (name !== 'getProgramInfoLog') return;
  now += 420;
  worker.tick();
  assert.equal(records.at(-1).inFlight, true);
  assert.equal(records.at(-1).lastStarted.method, 'getProgramInfoLog');
  return 'native shader diagnostic';
};
assert.equal(gl.getProgramInfoLog(program), 'native shader diagnostic');
assert.equal(calls.at(-1).args[0], program);
assert.equal(calls.at(-1).receiver, gl);
nativeBehavior = null;
loading.textContent = 'Loading photographed ground…';
const pausedRecordCount = records.length;
gl.drawArrays(4, 0, 3);
assert.equal(records.length, pausedRecordCount);
loading.textContent = 'Warming shadows and scene reflections…';
observe();
const nativeResult = {};
nativeBehavior = (name) => {
  if (name !== 'drawElements') return;
  now += 350;
  worker.tick();
  const snapshot = records.at(-1);
  assert.equal(snapshot.inFlight, true);
  assert.equal(snapshot.lastStarted.method, 'drawElements');
  assert.equal(snapshot.lastStarted.cubeFace, 34069);
  assert.deepEqual(snapshot.lastStarted.viewport, [0, 0, 256, 256]);
  assert.equal(snapshot.lastStarted.count, 6);
  return nativeResult;
};
assert.equal(gl.drawElements(4, 6, 5123, 0), nativeResult);
const nativeCall = calls.at(-1);
assert.deepEqual(nativeCall.args, [4, 6, 5123, 0]);
assert.equal(nativeCall.receiver, gl);
nativeBehavior = null;
gl.drawArrays(4, 0, 3);
worker.tick();
assert.equal(records.at(-1).inFlight, false);
assert.equal(
  records.at(-1).slowCalls.find((call) => call.method === 'drawElements').cpuCallMs,
  350,
);
assert.equal(
  records.at(-1).slowCalls.find((call) => call.method === 'getProgramInfoLog').cpuCallMs,
  420,
);
const failure = new Error('native draw failed');
nativeBehavior = (name) => {
  if (name === 'drawElementsInstanced') throw failure;
};
assert.throws(
  () => gl.drawElementsInstanced(4, 6, 5123, 0, 2),
  (error) => error === failure,
);
worker.tick();
assert.equal(records.at(-1).lastCompleted.returned, false);
assert.equal(records.at(-1).inFlight, false);
worker.failPost = true;
nativeBehavior = (name) => (name === 'drawArrays' ? nativeResult : undefined);
assert.equal(gl.drawArrays(4, 0, 3), nativeResult);
assert.equal(worker.terminated, true);
assert(records.some((record) => record.kind === 'unavailable'));
assert(!calls.some((call) => ['getError', 'finish', 'flush', 'getParameter'].includes(call.name)));
console.log(
  JSON.stringify(
    {
      scope:
        'CPU VM proof of diagnostic wrapping and worker state only; no browser or WebGL execution',
      synchronousPreparationStageObserved: true,
      earlyInfoLogInFlightObserved: true,
      tracingPausedDuringInterveningAssets: true,
      nativeArgumentsReceiverAndReturnPreserved: true,
      nativeThrowPreserved: true,
      inFlightCommandObservedBeforeReturn: true,
      slowCompletionRetainedAfterLaterFastCall: true,
      failedDiagnosticChannelDoesNotSkipNativeCall: true,
      noAdditionalGLQueriesOrFlushes: true,
      exitCode: 0,
    },
    null,
    2,
  ),
);
