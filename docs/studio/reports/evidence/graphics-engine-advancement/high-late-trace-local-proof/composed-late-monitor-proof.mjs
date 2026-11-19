import fs from 'node:fs';
import vm from 'node:vm';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import path from 'node:path';

const file = process.argv[2];
const project = process.argv[3];
if (!file || !project) throw new Error('Pass exact spec path and project root');
const ts = createRequire(path.resolve(project, 'package.json'))('typescript');
const input = ts.createSourceFile(
  file,
  fs.readFileSync(file, 'utf8'),
  ts.ScriptTarget.Latest,
  true,
);
const declarations = ['installFirstChaseStartup', 'installInstancedFragmentOutputs'].map((name) =>
  input.statements.find((node) => ts.isFunctionDeclaration(node) && node.name?.text === name),
);
const script = ts.transpileModule(declarations.map((node) => node.getText(input)).join('\n'), {
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
let reportDelay = 0;
const report = (text) => {
  const record = JSON.parse(text.slice('APEX_HIGH_STARTUP '.length));
  records.push(record);
  if (record.kind === 'slow-upload') now += reportDelay;
};
const constants = {
  READ_FRAMEBUFFER: 36008,
  DRAW_FRAMEBUFFER: 36009,
  FRAMEBUFFER: 36160,
  COLOR_ATTACHMENT0: 36064,
  FRAGMENT_SHADER: 35632,
  VERTEX_SHADER: 35633,
  LINK_STATUS: 35714,
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
        if (name === 'getProgramParameter') return args[1] === 35714;
        if (name === 'getFragDataLocation') return 0;
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
vm.runInContext(script + '\ninstallFirstChaseStartup();installInstancedFragmentOutputs();', context);
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
gl.linkProgram(program);
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
nativeBehavior = (name, args) => {
  if (name === 'getProgramParameter') return args[1] === 35714;
  if (name !== 'getFragDataLocation') return;
  now += 80;
  worker.tick();
  const snapshot = records.at(-1);
  assert.equal(snapshot.inFlight, true);
  assert.equal(snapshot.lastStarted.method, 'getFragDataLocation');
  assert.equal(snapshot.lastCompleted.method, 'getProgramParameter');
  return 0;
};
const metadataCallCount = calls.length;
assert.equal(gl.getProgramParameter(program, 35714), true);
assert.deepEqual(calls.slice(metadataCallCount).map((call) => call.name), [
  'getProgramParameter', 'getFragDataLocation',
]);
nativeBehavior = null;
loading.textContent = 'Loading photographed ground…';
const pausedRecordCount = records.length;
gl.drawArrays(4, 0, 3);
assert.equal(records.length, pausedRecordCount);
loading.textContent = 'Compiling circuit and vehicle materials…';
const compilingRecordCount = records.length;
gl.getProgramParameter(program, 37297);
assert.equal(records.length, compilingRecordCount);
loading.textContent = 'Preparing circuit and vehicle materials…';
assert.equal(records.at(-1).stage, 'Preparing circuit and vehicle materials…');
nativeBehavior = (name) => {
  if (name !== 'getProgramInfoLog') return;
  now += 300;
  worker.tick();
  assert.equal(records.at(-1).inFlight, true);
  assert.equal(records.at(-1).stage, 'Preparing circuit and vehicle materials…');
  return 'native scene metadata';
};
assert.equal(gl.getProgramInfoLog(program), 'native scene metadata');
nativeBehavior = null;
function makeProgram(label, fragmentSource = `#define SHADER_NAME ${label}\nout vec4 color; void main(){color=vec4(1.0);}`) {
  const vertex = gl.createShader(35633), fragment = gl.createShader(35632), program = {};
  gl.shaderSource(vertex, '#define SHADER_NAME NativeVertexOwner\nvoid main(){gl_Position=vec4(0.0);}');
  gl.shaderSource(fragment, fragmentSource);
  gl.attachShader(program, vertex);
  gl.attachShader(program, fragment);
  gl.linkProgram(program);
  return { program, vertex, fragment, fragmentSource };
}
// Exhaust the unchanged early budgets before the stage seen in the failed CI.
for (let i = 0; i < 70; i++) gl.getProgramInfoLog(makeProgram(`Early${i}`).program);
assert.equal(records.filter(r => r.kind === 'program').length, 32);
assert.equal(records.filter(r => r.kind === 'first-use').length, 64);
assert.equal(records.filter(r => r.kind === 'late-program').length, 0);
loading.textContent = 'Compiling shadow casters around the circuit…';
const shadowRecordCount = records.length;
gl.drawArrays(4, 0, 3);
assert.equal(records.length, shadowRecordCount);
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
nativeBehavior = null;
const longSource = '#define SHADER_NAME LateResourceOwner\n//' + 'x'.repeat(40000) + '\nout vec4 color; void main(){color=vec4(1.0);}';
const late = makeProgram('LateResourceOwner', longSource);
let lateSeenBeforeNative = false;
nativeBehavior = name => {
  if (name !== 'getProgramInfoLog') return;
  const row = records.filter(r => r.kind === 'late-program').at(-1);
  assert(row, 'late metadata must survive exhaustion of both early caps');
  assert.equal(row.fragment.shaderName, 'LateResourceOwner');
  assert.equal(row.vertex.shaderName, 'NativeVertexOwner');
  assert.equal(row.fragment.source, longSource.slice(0, 32768));
  assert.equal(row.fragment.sourceLength, longSource.length);
  assert.equal(row.fragment.truncated, true);
  assert.equal(row.vertex.truncated, false);
  assert(row.stack.length > 0 && row.stack.length <= 4096);
  const firstRead = !lateSeenBeforeNative;
  lateSeenBeforeNative = true;
  now += 150;
  worker.tick();
  assert.equal(records.at(-1).inFlight, true);
  assert.equal(records.at(-1).lastStarted.method, 'getProgramInfoLog');
  if (firstRead) assert.equal(records.at(-1).lastStarted.sequence, row.sequence);
  return nativeResult;
};
let mark = calls.length;
assert.equal(gl.getProgramInfoLog(late.program), nativeResult);
assert.deepEqual(calls.slice(mark).map(c => c.name), ['getProgramInfoLog']);
assert.equal(calls.at(-1).receiver, gl);
assert.equal(calls.at(-1).args[0], late.program);
assert(lateSeenBeforeNative);
assert.equal(records.filter(r => r.kind === 'late-program').length, 1);
// Re-reading metadata preserves its single retained owner record.
gl.getProgramInfoLog(late.program);
assert.equal(records.filter(r => r.kind === 'late-program').length, 1);
nativeBehavior = null;
const relinkedSource = '#define SHADER_NAME RelinkedOwner\nout vec4 color; void main(){color=vec4(0.5);}';
gl.shaderSource(late.fragment, relinkedSource);
gl.linkProgram(late.program);
gl.getProgramInfoLog(late.program);
assert.equal(records.filter(r => r.kind === 'late-program').length, 2);
assert.equal(records.filter(r => r.kind === 'late-program').at(-1).fragment.source, relinkedSource);
for (let i = 0; i < 12; i++) {
  const item = makeProgram(`MoreLate${i}`);
  mark = calls.length;
  gl.getProgramInfoLog(item.program);
  assert.deepEqual(calls.slice(mark).map(c => c.name), ['getProgramInfoLog']);
}
assert.equal(records.filter(r => r.kind === 'late-program').length, 8);
assert.equal(records.filter(r => r.kind === 'program').length, 32);
assert.equal(records.filter(r => r.kind === 'first-use').length, 64);

gl.useProgram(late.program);
const upload = new Uint8Array([1, 2, 3, 4, 5, 6, 7, 8]);
let uploadDuration = 99;
let uploadCalls = 0;
nativeBehavior = (name, args) => {
  if (name !== 'bufferData' && name !== 'texSubImage2D') return;
  uploadCalls++;
  if (name === 'bufferData') assert.equal(args[1], upload);
  const reportsBeforeReturn = records.filter(r => r.kind === 'slow-upload').length;
  now += uploadDuration;
  worker.tick();
  assert.equal(records.at(-1).inFlight, true);
  assert.equal(records.at(-1).lastStarted.method, name);
  assert.equal(records.filter(r => r.kind === 'slow-upload').length, reportsBeforeReturn);
  return nativeResult;
};
function callSlowBufferUpload() { return gl.bufferData(34962, upload, 35044); }
mark = calls.length;
assert.equal(callSlowBufferUpload(), nativeResult);
assert.deepEqual(calls.slice(mark).map(c => c.name), ['bufferData']);
assert.equal(records.filter(r => r.kind === 'slow-upload').length, 0);
uploadDuration = 100;
reportDelay = 500;
mark = calls.length;
assert.equal(callSlowBufferUpload(), nativeResult);
assert.deepEqual(calls.slice(mark).map(c => c.name), ['bufferData']);
let slow = records.filter(r => r.kind === 'slow-upload').at(-1);
assert.equal(slow.cpuCallMs, 100);
assert.equal(slow.sourceBufferBytes, upload.byteLength);
assert.deepEqual(slow.numericArguments, [34962, -1, 35044, -1]);
assert(slow.stack.includes('callSlowBufferUpload'));
assert(slow.stack.length <= 4096);
worker.tick();
assert.equal(records.at(-1).lastCompleted.cpuCallMs, 100);
assert.equal(records.at(-1).lastCompleted.sequence, slow.sequence);
assert.equal(records.at(-1).inFlight, false);
reportDelay = 0;
uploadDuration = 125;
const bitmap = { width: 64, height: 64 };
mark = calls.length;
assert.equal(gl.texSubImage2D(3553, 0, 0, 0, 6408, 5121, bitmap), nativeResult);
assert.deepEqual(calls.slice(mark).map(c => c.name), ['texSubImage2D']);
assert.equal(calls.at(-1).args.at(-1), bitmap);
slow = records.filter(r => r.kind === 'slow-upload').at(-1);
assert.equal(slow.cpuCallMs, 125);
assert.equal(slow.sourceBufferBytes, null);
assert.deepEqual(slow.numericArguments, [3553, 0, 0, 0]);
for (let i = 0; i < 22; i++) {
  mark = calls.length;
  assert.equal(callSlowBufferUpload(), nativeResult);
  assert.deepEqual(calls.slice(mark).map(c => c.name), ['bufferData']);
}
assert.equal(uploadCalls, 25);
assert.equal(records.filter(r => r.kind === 'slow-upload').length, 16);
const uploadFailure = new Error('native upload failed');
nativeBehavior = name => { if (name === 'bufferData') { now += 150; throw uploadFailure; } };
assert.throws(callSlowBufferUpload, error => error === uploadFailure);
worker.tick();
assert.equal(records.at(-1).lastCompleted.returned, false);
assert.equal(records.filter(r => r.kind === 'slow-upload').length, 16);

// Exercise the actual Node-side console collector, then overwrite its activity
// ring. Dedicated late arrays must retain these bounded owner records.
let consoleCollector;
function findCollector(node) {
  if (ts.isCallExpression(node) && ts.isPropertyAccessExpression(node.expression) &&
      node.expression.name.text === 'on' && node.arguments[0]?.text === 'console')
    consoleCollector = node.arguments[1];
  ts.forEachChild(node, findCollector);
}
findCollector(input);
assert(consoleCollector);
const collectorContext = vm.createContext({ startupRecords: [], startupPrograms: [],
  startupLatePrograms: [], startupSlowUploads: [], startupWorkerUrl: null,
  startupLastStarted: null, startupLastCompleted: null, errors: [] });
const collectorScript = ts.transpileModule(`(${consoleCollector.getText(input)})`, {
  compilerOptions: { target: ts.ScriptTarget.ES2022 },
}).outputText;
const collect = vm.runInContext(collectorScript, collectorContext);
const feed = row => collect({ text: () => 'APEX_HIGH_STARTUP ' + JSON.stringify(row), type: () => 'info' });
records.forEach(feed);
for (let i = 0; i < 400; i++) feed({ kind: 'activity', lastStarted: { sequence: 99999 + i } });
assert.equal(collectorContext.startupPrograms.length, 32);
assert.equal(collectorContext.startupLatePrograms.length, 8);
assert.equal(collectorContext.startupSlowUploads.length, 16);
assert.equal(collectorContext.startupRecords.length, 256);
assert(collectorContext.startupRecords.every(r => r.kind === 'activity'));
assert.equal(collectorContext.startupLatePrograms[0].fragment.source, longSource.slice(0, 32768));
assert.equal(collectorContext.startupSlowUploads[0].cpuCallMs, 100);
assert.equal(collectorContext.errors.length, 0);

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
      tracingPausedDuringParallelCompilation: true,
      sceneMetadataInFlightObserved: true,
      nativeArgumentsReceiverAndReturnPreserved: true,
      nativeThrowPreserved: true,
      inFlightCommandObservedBeforeReturn: true,
      slowCompletionRetainedAfterLaterFastCall: true,
      failedDiagnosticChannelDoesNotSkipNativeCall: true,
      commandTracerAddsNoDriverQueriesOrFlushes: true,
      inspectorLocationWaitAttributedSeparatelyAfterNativeStatus: true,
      inspectorStatusQueryCountUnchanged: true,
      earlyBudgetsExhaustedBeforeChase: true,
      lateProgramSourceAndStackObservedBeforeNativeEntry: true,
      vertexAndFragmentIdentityRetained: true,
      relinkInvalidatesLateOwnerSummary: true,
      lateSourcesBoundedAndTruncationExplicit: true,
      slowUploadStackCapturedOnlyAfterReturn: true,
      fastUploadsNotReported: true,
      slowUploadReportCostExcludedFromCompletionTime: true,
      uploadArgumentsReceiverReturnAndThrowPreserved: true,
      diagnosticBudgetsPreserveOriginalNativeCallCounts: true,
      lateArraysSurviveActivityRingEviction: true,
      lateProgramLimit: 8,
      slowUploadLimit: 16,
      exitCode: 0,
    },
    null,
    2,
  ),
);
