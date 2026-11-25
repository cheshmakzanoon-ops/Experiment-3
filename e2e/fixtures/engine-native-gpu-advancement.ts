import * as T from 'three';
import { WebGLAttributes } from 'three/src/renderers/webgl/WebGLAttributes.js';
import { markItems } from '../../src/rendering/attribute-ranges.ts';
import {
  acquireGpuFrameGate,
  type GpuFrameLease,
} from '../../src/rendering/shared-gpu-frame-gate.ts';

function backend() {
  const canvas = document.createElement('canvas');
  document.body.append(canvas);
  const renderer = new T.WebGLRenderer({ canvas, antialias: false, alpha: false });
  renderer.setSize(16, 16);
  renderer.outputColorSpace = T.LinearSRGBColorSpace;
  renderer.toneMapping = T.NoToneMapping;
  const gl = renderer.getContext();
  if (!(gl instanceof WebGL2RenderingContext)) throw new Error('Native WebGL2 is required');
  const extension = gl.getExtension('WEBGL_debug_renderer_info');
  const identity = {
    renderer: String(gl.getParameter(extension ? extension.UNMASKED_RENDERER_WEBGL : gl.RENDERER)),
    vendor: String(gl.getParameter(extension ? extension.UNMASKED_VENDOR_WEBGL : gl.VENDOR)),
    version: String(gl.getParameter(gl.VERSION)),
    webgl2: true,
    physicalHardwareValidated: false,
  };
  return { renderer, canvas, gl, identity };
}

async function digest(view: ArrayBufferView) {
  const bytes = new Uint8Array(view.byteLength);
  bytes.set(new Uint8Array(view.buffer, view.byteOffset, view.byteLength));
  const hash = await crypto.subtle.digest('SHA-256', bytes);
  return [...new Uint8Array(hash)].map((byte) => byte.toString(16).padStart(2, '0')).join('');
}

function differences(a: ArrayBufferView, b: ArrayBufferView) {
  const left = new Uint8Array(a.buffer, a.byteOffset, a.byteLength);
  const right = new Uint8Array(b.buffer, b.byteOffset, b.byteLength);
  if (left.length !== right.length) throw new Error('Readback lengths differ');
  let count = 0;
  for (let i = 0; i < left.length; i++) if (left[i] !== right[i]) count++;
  return count;
}

/** Native storage, actual Three upload decisions, and the production dirty-range
 * helper. Deferral here is an explicit producer interval, not a simulated GPU. */
export async function attributeUploads() {
  const r = backend();
  const { gl } = r;
  const uploader = new WebGLAttributes(gl);
  const backing = new Float32Array(4096 * 3 + 8).fill(-1337);
  const values = backing.subarray(5, 5 + 4096 * 3);
  for (let i = 0; i < values.length; i++) values[i] = (i % 31) * 0.125;
  const initial = values.slice();
  const attribute = new T.BufferAttribute(values, 3).setUsage(T.DynamicDrawUsage);
  let phase = 'initial';
  let buffer: WebGLBuffer | undefined;
  const uploads: {
    phase: string;
    target: number;
    destinationOffset: number;
    sourceOffset: number;
    sourceLength: number;
    bytes: number;
    sourceByteOffset: number;
    expectedBuffer: boolean;
  }[] = [];
  const originalSubData = gl.bufferSubData;
  // The wrapper observes arguments and forwards the exact original overload to
  // Chromium. It neither merges ranges nor copies bytes into substitute storage.
  gl.bufferSubData = ((...args: unknown[]) => {
    const [target, destinationOffset, source, sourceOffset = 0, length] = args;
    if (!(source instanceof Float32Array)) throw new Error('Unexpected native upload source');
    const sourceLength =
      length === undefined ? source.length - Number(sourceOffset) : Number(length);
    uploads.push({
      phase,
      target: Number(target),
      destinationOffset: Number(destinationOffset),
      sourceOffset: Number(sourceOffset),
      sourceLength,
      bytes: sourceLength * source.BYTES_PER_ELEMENT,
      sourceByteOffset: source.byteOffset,
      expectedBuffer: gl.getParameter(gl.ARRAY_BUFFER_BINDING) === buffer,
    });
    return Reflect.apply(originalSubData, gl, args);
  }) as typeof gl.bufferSubData;
  const readback = () => {
    if (!buffer) throw new Error('Three did not allocate the native buffer');
    const result = new Float32Array(values.length);
    gl.bindBuffer(gl.COPY_READ_BUFFER, buffer);
    gl.getBufferSubData(gl.COPY_READ_BUFFER, 0, result);
    gl.bindBuffer(gl.COPY_READ_BUFFER, null);
    return result;
  };
  try {
    uploader.update(attribute, gl.ARRAY_BUFFER);
    buffer = uploader.get(attribute)?.buffer;
    const primed = readback();
    const versions = { initial: attribute.version, duplicate: 0, disjoint: 0, narrow: 0 };

    phase = 'duplicate';
    for (let mark = 0; mark < 25; mark++) {
      for (let component = 0; component < 12; component++)
        values[300 + component] = 10000 + mark * 16 + component;
      markItems(attribute, 100, 103);
    }
    const duplicatePending = attribute.updateRanges.map((range) => ({ ...range }));
    const beforePublication = readback();
    const uploadsBeforePublication = uploads.length;
    versions.duplicate = attribute.version;
    uploader.update(attribute, gl.ARRAY_BUFFER);
    const duplicateReadback = readback();
    const duplicateCleared = attribute.updateRanges.length === 0;

    phase = 'disjoint';
    let sixteenPending = 0;
    for (let mark = 0; mark < 17; mark++) {
      const item = 300 + mark * 11;
      values.set([20000 + mark, 21000 + mark, 22000 + mark], item * 3);
      markItems(attribute, item, item);
      if (mark === 15) sixteenPending = attribute.updateRanges.length;
    }
    const disjointPending = attribute.updateRanges.map((range) => ({ ...range }));
    versions.disjoint = attribute.version;
    uploader.update(attribute, gl.ARRAY_BUFFER);
    const disjointReadback = readback();
    const disjointExpected = values.slice();

    phase = 'narrow-after-full';
    values.set([31000, 31001, 31002, 31003, 31004, 31005], 70 * 3);
    markItems(attribute, 70, 70);
    markItems(attribute, 71, 71);
    const narrowPending = attribute.updateRanges.map((range) => ({ ...range }));
    versions.narrow = attribute.version;
    uploader.update(attribute, gl.ARRAY_BUFFER);
    const narrowReadback = readback();
    const beforeUnchanged = uploads.length;
    phase = 'unchanged';
    uploader.update(attribute, gl.ARRAY_BUFFER);
    uploader.update(attribute, gl.ARRAY_BUFFER);
    const unchangedUploads = uploads.length - beforeUnchanged;

    const duplicateExpected = initial.slice();
    for (let component = 0; component < 12; component++)
      duplicateExpected[300 + component] = 10384 + component;
    const checks = {
      initialDifferences: differences(primed, initial),
      deferredDifferences: differences(beforePublication, initial),
      duplicateDifferences: differences(duplicateReadback, duplicateExpected),
      disjointDifferences: differences(disjointReadback, disjointExpected),
      narrowDifferences: differences(narrowReadback, values),
    };
    const hashes = {
      initial: await digest(initial),
      deferred: await digest(beforePublication),
      duplicate: await digest(duplicateReadback),
      duplicateExpected: await digest(duplicateExpected),
      disjoint: await digest(disjointReadback),
      disjointExpected: await digest(disjointExpected),
      narrow: await digest(narrowReadback),
      narrowExpected: await digest(values),
    };
    uploader.remove(attribute);
    const removed = !gl.isBuffer(buffer ?? null) && uploader.get(attribute) === undefined;
    const guardValues = [...backing.subarray(0, 5), ...backing.subarray(5 + values.length)];
    return {
      backend: r.identity,
      totalBytes: values.byteLength,
      sourceByteOffset: values.byteOffset,
      versions,
      duplicatePending,
      duplicateCleared,
      sixteenPending,
      disjointPending,
      narrowPending,
      finalPending: attribute.updateRanges.length,
      latestItems: Array.from(duplicateReadback.subarray(300, 312)),
      uploadsBeforePublication,
      unchangedUploads,
      uploads,
      checks,
      hashes,
      guardValues,
      removed,
      glError: gl.getError(),
      contextLost: gl.isContextLost(),
    };
  } finally {
    uploader.remove(attribute);
    gl.bufferSubData = originalSubData;
    r.renderer.dispose();
    r.canvas.remove();
  }
}

function fenceTrace(gl: WebGL2RenderingContext) {
  const originals = {
    fenceSync: gl.fenceSync,
    clientWaitSync: gl.clientWaitSync,
    deleteSync: gl.deleteSync,
    flush: gl.flush,
    finish: gl.finish,
  };
  const identifiers = new WeakMap<WebGLSync, number>();
  const live = new Set<WebGLSync>();
  const submitted: { id: number; condition: number; flags: number }[] = [];
  const waits: { id: number; flags: number; timeout: number; result: number }[] = [];
  const deleted: number[] = [];
  let flushes = 0;
  let finishes = 0;
  gl.fenceSync = (condition, flags) => {
    const fence = originals.fenceSync.call(gl, condition, flags);
    if (fence) {
      const id = submitted.length + 1;
      identifiers.set(fence, id);
      live.add(fence);
      submitted.push({ id, condition, flags });
    }
    return fence;
  };
  gl.clientWaitSync = (fence, flags, timeout) => {
    const result = originals.clientWaitSync.call(gl, fence, flags, timeout);
    waits.push({ id: identifiers.get(fence) ?? -1, flags, timeout, result });
    return result;
  };
  gl.deleteSync = (fence) => {
    if (fence) {
      deleted.push(identifiers.get(fence) ?? -1);
      live.delete(fence);
    }
    return originals.deleteSync.call(gl, fence);
  };
  gl.flush = () => {
    flushes++;
    return originals.flush.call(gl);
  };
  gl.finish = () => {
    finishes++;
    throw new Error('A blocking finish cannot establish native gate admission');
  };
  return {
    submitted,
    waits,
    deleted,
    live,
    counts: () => ({ flushes, finishes }),
    restore: () => Object.assign(gl, originals),
  };
}

async function completed(owners: readonly GpuFrameLease[], stage: string) {
  const started = performance.now();
  let polls = 0;
  while (true) {
    const owner = owners[polls % owners.length];
    polls++;
    if (owner.ready()) return { polls, deferred: polls - 1 };
    if (performance.now() - started > 15000)
      throw new Error(`Native fence deadline at ${stage}: ${JSON.stringify(owner.diagnostics())}`);
    // Actual browser tasks permit the real driver to make progress. No status
    // is replaced, and immediate native completion is a valid result.
    await new Promise<void>((resolve) => setTimeout(resolve, 0));
  }
}

function queue(lease: GpuFrameLease) {
  const { pending, submitted, completed, failure } = lease.diagnostics();
  return { pending, submitted, completed, failure };
}

async function pixelEvidence(actual: Uint8Array, expected: Uint8Array) {
  const channels = [0, 0, 0, 0];
  const rows = Array(8).fill(0) as number[];
  const firstMismatches: {
    index: number;
    x: number;
    y: number;
    channel: number;
    expected: number;
    actual: number;
  }[] = [];
  const colours = new Map<string, number>();
  for (let i = 0; i < actual.length; i++) {
    if (i % 4 === 0) {
      const rgba = Array.from(actual.subarray(i, i + 4)).join(',');
      colours.set(rgba, (colours.get(rgba) ?? 0) + 1);
    }
    if (actual[i] === expected[i]) continue;
    channels[i % 4]++;
    const pixel = Math.floor(i / 4);
    rows[Math.floor(pixel / 8)]++;
    if (firstMismatches.length < 16)
      firstMismatches.push({
        index: i,
        x: pixel % 8,
        y: Math.floor(pixel / 8),
        channel: i % 4,
        expected: expected[i],
        actual: actual[i],
      });
  }
  return {
    rgba: Array.from(actual.subarray(0, 4)),
    bytes: actual.length,
    differences: differences(actual, expected),
    channels,
    rows,
    firstMismatches,
    colours: [...colours].map(([rgba, pixels]) => ({ rgba, pixels })),
    values: Array.from(actual),
    expectedValues: Array.from(expected),
    sha256: await digest(actual),
    expectedSha256: await digest(expected),
  };
}

// Isolated test materials, also retained in the raster-path diagnosis below.
// The vec4 path is the shared gate's full-image witness; the vec3 and MeshBasic
// controls continue to report their observed backend failures independently.
function rawColourMaterial(kind: 'constant' | 'vec3' | 'vec4') {
  const declarations = kind === 'constant' ? '' : `uniform ${kind} probeColour;`;
  const colour =
    kind === 'constant'
      ? 'vec4(1.0, 0.0, 0.0, 1.0)'
      : kind === 'vec3'
        ? 'vec4(probeColour, 1.0)'
        : 'probeColour';
  const value = kind === 'vec3' ? new T.Vector3(1, 0, 0) : new T.Vector4(1, 0, 0, 1);
  return new T.RawShaderMaterial({
    glslVersion: T.GLSL3,
    toneMapped: false,
    uniforms: kind === 'constant' ? {} : { probeColour: { value } },
    vertexShader:
      'precision highp float; in vec3 position; void main() { gl_Position = vec4(position.xy, 0.0, 1.0); }',
    fragmentShader: `precision highp float; ${declarations} out vec4 probeOutput; void main() { probeOutput = ${colour}; }`,
  });
}

/** Actual rendered commands, real WebGLSync objects and unchanged native wait
 * results. Pixel readback happens only after the gate observes completion. */
export async function sharedFenceOwnership() {
  const r = backend();
  const { renderer, gl } = r;
  const trace = fenceTrace(gl);
  const geometry = new T.PlaneGeometry(2, 2);
  const material = rawColourMaterial('vec4');
  const colourUniform = material.uniforms.probeColour.value as T.Vector4;
  const scene = new T.Scene().add(new T.Mesh(geometry, material));
  const camera = new T.OrthographicCamera(-1, 1, 1, -1, 0.1, 10);
  camera.position.z = 1;
  const target = new T.WebGLRenderTarget(8, 8, { depthBuffer: false, stencilBuffer: false });
  const owners: GpuFrameLease[] = [];
  const acquire = () => {
    const lease = acquireGpuFrameGate(gl);
    owners.push(lease);
    return lease;
  };
  let backendDisposals = 0;
  const disposeBackend = renderer.dispose.bind(renderer);
  renderer.dispose = () => {
    backendDisposals++;
    disposeBackend();
  };
  const draw = (red: number, green: number, blue: number, lease: GpuFrameLease) => {
    colourUniform.set(red, green, blue, 1);
    renderer.setRenderTarget(target);
    renderer.render(scene, camera);
    lease.submittedFrame();
  };
  const pixels = () => {
    const bytes = new Uint8Array(8 * 8 * 4);
    renderer.readRenderTargetPixels(target, 0, 0, 8, 8, bytes);
    return bytes;
  };
  const pixelState = () => ({
    viewport: Array.from(gl.getParameter(gl.VIEWPORT) as Int32Array),
    scissor: Array.from(gl.getParameter(gl.SCISSOR_BOX) as Int32Array),
    scissorEnabled: gl.isEnabled(gl.SCISSOR_TEST),
    nativeDitherEnabled: gl.isEnabled(gl.DITHER),
    packAlignment: Number(gl.getParameter(gl.PACK_ALIGNMENT)),
    packRowLength: Number(gl.getParameter(gl.PACK_ROW_LENGTH)),
    packSkipRows: Number(gl.getParameter(gl.PACK_SKIP_ROWS)),
    packSkipPixels: Number(gl.getParameter(gl.PACK_SKIP_PIXELS)),
    framebufferStatus: gl.checkFramebufferStatus(gl.FRAMEBUFFER),
    target: { width: target.width, height: target.height, colourSpace: target.texture.colorSpace },
    material: {
      type: material.type,
      colourUniform: 'vec4',
      colour: colourUniform.toArray(),
      dithering: material.dithering,
      toneMapped: material.toneMapped,
    },
    outputColourSpace: renderer.outputColorSpace,
    toneMapping: renderer.toneMapping,
  });
  try {
    const circuit = acquire();
    const festival = acquire();
    const initial = { circuit: circuit.ready(), festival: festival.ready(), queue: queue(circuit) };
    draw(1, 0, 0, circuit);
    const firstFence = [...trace.live][0];
    const submitted = { circuit: queue(circuit), festival: queue(festival) };
    festival.dispose();
    festival.dispose();
    const replacement = acquire();
    const firstHandoff = {
      queue: queue(replacement),
      live: trace.live.size,
      deleted: trace.deleted.length,
      nativeFence: gl.isSync(firstFence),
      backendDisposals,
    };
    const firstCompletion = await completed([replacement, circuit], 'circuit to Festival');
    const red = pixels();
    const redState = pixelState();

    draw(0, 1, 0, replacement);
    replacement.dispose();
    const releasedReady = replacement.ready();
    let releasedSubmitRejected = false;
    try {
      replacement.submittedFrame();
    } catch (error) {
      releasedSubmitRejected = error instanceof Error && error.message.includes('disposed');
    }
    const nextBorrower = acquire();
    const secondHandoff = {
      circuit: queue(circuit),
      replacement: queue(nextBorrower),
      live: trace.live.size,
      deleted: [...trace.deleted],
      backendDisposals,
      releasedReady,
      releasedSubmitRejected,
    };
    const secondCompletion = await completed([circuit, nextBorrower], 'Festival to circuit');
    const green = pixels();
    const greenState = pixelState();
    const completedQueues = { circuit: queue(circuit), borrower: queue(nextBorrower) };

    // A terminal release disposes the native sync, not the borrowed backend.
    // This third submission is abandoned, never described as completed or read.
    draw(0, 0, 1, nextBorrower);
    const finalFence = [...trace.live][0];
    circuit.dispose();
    const beforeFinalRelease = {
      queue: queue(nextBorrower),
      live: trace.live.size,
      deleted: [...trace.deleted],
      nativeFence: gl.isSync(finalFence),
    };
    nextBorrower.dispose();
    const afterFinalRelease = {
      live: trace.live.size,
      deleted: [...trace.deleted],
      nativeFence: gl.isSync(finalFence),
      backendDisposals,
      contextLost: gl.isContextLost(),
    };
    renderer.setRenderTarget(null);
    geometry.dispose();
    material.dispose();
    target.dispose();
    const releasedMemory = {
      geometries: renderer.info.memory.geometries,
      textures: renderer.info.memory.textures,
      programs: renderer.info.programs?.length ?? 0,
    };
    renderer.dispose();
    const expectedRed = new Uint8Array(red.length);
    const expectedGreen = new Uint8Array(green.length);
    for (let i = 0; i < red.length; i += 4) {
      expectedRed.set([255, 0, 0, 255], i);
      expectedGreen.set([0, 255, 0, 255], i);
    }
    return {
      backend: r.identity,
      witness: {
        kind: 'test-only-explicit-vec4',
        material: material.type,
        colourUniform: 'vec4',
        imageBytes: 256,
        scope:
          'shared gate render ordering and ownership; no MeshBasic or vec3 material acceptance',
      },
      initial,
      submitted,
      firstHandoff,
      firstCompletion,
      secondHandoff,
      secondCompletion,
      completedQueues,
      beforeFinalRelease,
      afterFinalRelease,
      red: { ...(await pixelEvidence(red, expectedRed)), state: redState },
      green: { ...(await pixelEvidence(green, expectedGreen)), state: greenState },
      submittedFences: trace.submitted,
      waits: trace.waits,
      deletedFences: trace.deleted,
      counts: trace.counts(),
      constants: {
        complete: gl.SYNC_GPU_COMMANDS_COMPLETE,
        already: gl.ALREADY_SIGNALED,
        satisfied: gl.CONDITION_SATISFIED,
        timeout: gl.TIMEOUT_EXPIRED,
      },
      releasedMemory,
      backendDisposals,
      glError: gl.getError(),
      contextLost: gl.isContextLost(),
    };
  } finally {
    for (const lease of owners) lease.dispose();
    geometry.dispose();
    material.dispose();
    target.dispose();
    if (backendDisposals === 0) renderer.dispose();
    trace.restore();
    r.canvas.remove();
  }
}

/** Always-recorded layer isolation. Diagnostic material mismatches remain
 * explicit failures; they are not the shared gate's vec4 acceptance witness. */
export async function rasterPathDiagnostics() {
  const r = backend();
  const { renderer, gl } = r;
  const trace = fenceTrace(gl);
  const lease = acquireGpuFrameGate(gl);
  const geometry = new T.PlaneGeometry(2, 2);
  const basic = new T.MeshBasicMaterial({ color: 0xff0000, toneMapped: false });
  const materials: T.Material[] = [basic];
  const mesh = new T.Mesh<T.PlaneGeometry, T.Material>(geometry, basic);
  const scene = new T.Scene().add(mesh);
  const camera = new T.OrthographicCamera(-1, 1, 1, -1, 0.1, 10);
  camera.position.z = 1;
  const target = new T.WebGLRenderTarget(8, 8, { depthBuffer: false, stencilBuffer: false });
  const expected = new Uint8Array(8 * 8 * 4);
  for (let i = 0; i < expected.length; i += 4) expected.set([255, 0, 0, 255], i);
  const shaderErrors: { program: string | null; vertex: string | null; fragment: string | null }[] =
    [];
  renderer.debug.onShaderError = (context, program, vertex, fragment) => {
    shaderErrors.push({
      program: context.getProgramInfoLog(program),
      vertex: context.getShaderInfoLog(vertex),
      fragment: context.getShaderInfoLog(fragment),
    });
  };
  const attachment = () => ({
    status: gl.checkFramebufferStatus(gl.FRAMEBUFFER),
    componentType: Number(
      gl.getFramebufferAttachmentParameter(
        gl.FRAMEBUFFER,
        gl.COLOR_ATTACHMENT0,
        gl.FRAMEBUFFER_ATTACHMENT_COMPONENT_TYPE,
      ),
    ),
    componentBits: [
      gl.FRAMEBUFFER_ATTACHMENT_RED_SIZE,
      gl.FRAMEBUFFER_ATTACHMENT_GREEN_SIZE,
      gl.FRAMEBUFFER_ATTACHMENT_BLUE_SIZE,
      gl.FRAMEBUFFER_ATTACHMENT_ALPHA_SIZE,
    ].map((property) =>
      Number(gl.getFramebufferAttachmentParameter(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, property)),
    ),
    implementationReadFormat: Number(gl.getParameter(gl.IMPLEMENTATION_COLOR_READ_FORMAT)),
    implementationReadType: Number(gl.getParameter(gl.IMPLEMENTATION_COLOR_READ_TYPE)),
    texture: {
      format: target.texture.format,
      type: target.texture.type,
      internalFormat: target.texture.internalFormat,
      colourSpace: target.texture.colorSpace,
    },
  });
  const observe = async (name: string) => {
    lease.submittedFrame();
    const completion = await completed([lease], `diagnostic ${name}`);
    const uniforms: Record<string, number | number[]> = {};
    if (name === 'three-mesh-basic' || name.startsWith('raw-shader-')) {
      const program = gl.getParameter(gl.CURRENT_PROGRAM) as WebGLProgram | null;
      if (!program) throw new Error(`Missing native program for ${name}`);
      for (const uniformName of ['diffuse', 'opacity', 'probeColour']) {
        const location = gl.getUniformLocation(program, uniformName);
        if (location) {
          const value = gl.getUniform(program, location) as number | Float32Array;
          uniforms[uniformName] = typeof value === 'number' ? value : Array.from(value);
        }
      }
    }
    const bulk = new Uint8Array(expected.length);
    gl.readPixels(0, 0, 8, 8, gl.RGBA, gl.UNSIGNED_BYTE, bulk);
    const individual = new Uint8Array(expected.length);
    const pixel = new Uint8Array(4);
    for (let y = 0; y < 8; y++) {
      for (let x = 0; x < 8; x++) {
        gl.readPixels(x, y, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, pixel);
        individual.set(pixel, (y * 8 + x) * 4);
      }
    }
    const viaThree = new Uint8Array(expected.length);
    renderer.readRenderTargetPixels(target, 0, 0, 8, 8, viaThree);
    return {
      name,
      completion,
      queue: queue(lease),
      attachment: attachment(),
      uniforms,
      rawBulk: await pixelEvidence(bulk, expected),
      individual: await pixelEvidence(individual, expected),
      viaThree: await pixelEvidence(viaThree, expected),
      bulkVsIndividual: differences(bulk, individual),
      bulkVsThree: differences(bulk, viaThree),
      glError: gl.getError(),
    };
  };
  const results: Awaited<ReturnType<typeof observe>>[] = [];
  try {
    renderer.setRenderTarget(target);
    renderer.render(scene, camera);
    results.push(await observe('three-mesh-basic'));

    gl.clearBufferfv(gl.COLOR, 0, new Float32Array([1, 0, 0, 1]));
    results.push(await observe('native-clear-rgba'));

    const texture = gl.getFramebufferAttachmentParameter(
      gl.FRAMEBUFFER,
      gl.COLOR_ATTACHMENT0,
      gl.FRAMEBUFFER_ATTACHMENT_OBJECT_NAME,
    );
    if (!(texture instanceof WebGLTexture)) throw new Error('Expected the actual target texture');
    gl.bindTexture(gl.TEXTURE_2D, texture);
    gl.texSubImage2D(gl.TEXTURE_2D, 0, 0, 0, 8, 8, gl.RGBA, gl.UNSIGNED_BYTE, expected);
    gl.bindTexture(gl.TEXTURE_2D, null);
    renderer.resetState();
    renderer.setRenderTarget(target);
    results.push(await observe('native-texture-rgba-upload'));

    for (const kind of ['constant', 'vec3', 'vec4'] as const) {
      mesh.material = rawColourMaterial(kind);
      materials.push(mesh.material);
      renderer.render(scene, camera);
      results.push(await observe(`raw-shader-${kind}`));
    }
    return {
      backend: r.identity,
      purpose:
        'diagnostic material failures remain recorded; shared-gate acceptance uses an explicit vec4 witness',
      results,
      rasterPathFailures: results
        .filter((result) =>
          [result.rawBulk, result.individual, result.viaThree].some((read) => read.differences > 0),
        )
        .map((result) => ({
          path: result.name,
          nativeBulkDifferingBytes: result.rawBulk.differences,
          individualDifferingBytes: result.individual.differences,
          threeDifferingBytes: result.viaThree.differences,
          actualSha256: result.rawBulk.sha256,
          expectedSha256: result.rawBulk.expectedSha256,
        })),
      shaderErrors,
      constants: {
        rgba: gl.RGBA,
        unsignedByte: gl.UNSIGNED_BYTE,
        complete: gl.FRAMEBUFFER_COMPLETE,
        unsignedNormalized: gl.UNSIGNED_NORMALIZED,
      },
      counts: trace.counts(),
      queue: queue(lease),
      contextLost: gl.isContextLost(),
    };
  } finally {
    lease.dispose();
    geometry.dispose();
    for (const material of materials) material.dispose();
    target.dispose();
    renderer.dispose();
    trace.restore();
    r.canvas.remove();
  }
}
