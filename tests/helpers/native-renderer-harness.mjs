import * as T from 'three';

// Only the GL endpoint is recorded. The renderer, its object/geometry/attribute
// caches, binding states, compile paths, draw dispatch and disposal are native.
// This does not execute a driver or establish browser pixels or GPU timings.
export function nativeRendererHarness() {
  const constants = new Map(
    Object.entries({
      ARRAY_BUFFER: 0x8892,
      ELEMENT_ARRAY_BUFFER: 0x8893,
      FLOAT: 0x1406,
      UNSIGNED_SHORT: 0x1403,
      UNSIGNED_INT: 0x1405,
      FLOAT_VEC3: 0x8b51,
      FLOAT_MAT4: 0x8b5c,
      STATIC_DRAW: 0x88e4,
      DYNAMIC_DRAW: 0x88e8,
      TRIANGLES: 4,
      VERSION: 0x1f02,
      VIEWPORT: 0x0ba2,
      SCISSOR_BOX: 0x0c10,
      FRAMEBUFFER_COMPLETE: 0x8cd5,
      TEXTURE_CUBE_MAP_POSITIVE_X: 0x8515,
    }),
  );
  const events = [],
    buffers = new Map(),
    bindings = new Map(),
    vaos = new Map(),
    framebuffers = new Map();
  let viewport = [0, 0, 256, 256],
    scissor = [0, 0, 256, 256],
    scissorTest = false;
  let nextConstant = 0x100000,
    nextId = 0,
    currentVao = null,
    stage = 'initialization',
    nativeRenderer = null;
  const record = (method, data = {}) =>
    events.push({
      stage,
      method,
      cubeFace: nativeRenderer?.getRenderTarget()?.isWebGLCubeRenderTarget
        ? nativeRenderer.getActiveCubeFace()
        : null,
      ...data,
    });
  const handle = (kind) => ({ kind, id: ++nextId });
  const calls = {
    drawingBufferWidth: 256,
    drawingBufferHeight: 256,
    getContextAttributes: () => ({ alpha: false, antialias: false }),
    getShaderPrecisionFormat: () => ({ precision: 23, rangeMin: 127, rangeMax: 127 }),
    getExtension: () => null,
    getSupportedExtensions: () => [],
    getParameter: (key) => {
      if (key === gl.VERSION) return 'WebGL 2.0 recorded endpoint';
      if (key === gl.VIEWPORT) return [...viewport];
      if (key === gl.SCISSOR_BOX) return [...scissor];
      if (key === gl.SCISSOR_TEST) return scissorTest;
      if (key === gl.MAX_TEXTURE_SIZE || key === gl.MAX_CUBE_MAP_TEXTURE_SIZE) return 4096;
      if (key === gl.MAX_VERTEX_UNIFORM_VECTORS || key === gl.MAX_FRAGMENT_UNIFORM_VECTORS)
        return 1024;
      if (key === gl.MAX_SAMPLES) return 4;
      return 16;
    },
    getInternalformatParameter: () => [4, 2, 1],
    getError: () => 0,
    isContextLost: () => false,
    viewport: (...value) => {
      viewport = value;
      record('viewport', { value });
    },
    scissor: (...value) => {
      scissor = value;
      record('scissor', { value });
    },
    enable: (cap) => {
      if (cap === gl.SCISSOR_TEST) scissorTest = true;
    },
    disable: (cap) => {
      if (cap === gl.SCISSOR_TEST) scissorTest = false;
    },
    bindFramebuffer: (target, framebuffer) => {
      framebuffers.set(target, framebuffer);
      if (target === gl.FRAMEBUFFER) {
        framebuffers.set(gl.DRAW_FRAMEBUFFER, framebuffer);
        framebuffers.set(gl.READ_FRAMEBUFFER, framebuffer);
      }
      record('bindFramebuffer', { target, framebuffer });
    },
    createBuffer: () => {
      const buffer = handle('buffer');
      buffers.set(buffer, { initialTarget: null, deleted: false });
      record('createBuffer', { buffer });
      return buffer;
    },
    bindBuffer: (target, buffer) => {
      if (buffer) {
        const state = buffers.get(buffer);
        if (state.deleted) throw new Error('Binding a deleted buffer');
        if (state.initialTarget === null) state.initialTarget = target;
        if (
          (state.initialTarget === gl.ELEMENT_ARRAY_BUFFER) !==
          (target === gl.ELEMENT_ARRAY_BUFFER)
        )
          throw new Error('Crossing the WebGL element/array buffer target restriction');
      }
      bindings.set(target, buffer);
      if (target === gl.ELEMENT_ARRAY_BUFFER && currentVao) vaos.get(currentVao).index = buffer;
      record('bindBuffer', { target, buffer });
    },
    bufferData: (target, data, usage) => {
      const buffer = bindings.get(target);
      const state = buffers.get(buffer);
      state.data = data;
      state.bytes = typeof data === 'number' ? data : data.byteLength;
      record('bufferData', { target, buffer, data, bytes: state.bytes, usage });
    },
    bufferSubData: (target, offset, data) =>
      record('bufferSubData', { target, offset, data, buffer: bindings.get(target) }),
    deleteBuffer: (buffer) => {
      const state = buffers.get(buffer);
      if (!state || state.deleted) throw new Error('Repeated or foreign buffer deletion');
      state.deleted = true;
      record('deleteBuffer', { buffer });
    },
    createVertexArray: () => {
      const vao = handle('vao');
      vaos.set(vao, { index: null });
      return vao;
    },
    bindVertexArray: (vao) => {
      currentVao = vao;
      bindings.set(gl.ELEMENT_ARRAY_BUFFER, vao ? vaos.get(vao).index : null);
    },
    deleteVertexArray: (vao) => record('deleteVertexArray', { vao }),
    createShader: (type) => ({ ...handle('shader'), type, source: '' }),
    shaderSource: (shader, source) => {
      shader.source = source;
    },
    compileShader: (shader) => record('compileShader', { shader }),
    getShaderParameter: () => true,
    getShaderInfoLog: () => '',
    createProgram: () => ({ ...handle('program'), shaders: [] }),
    attachShader: (program, shader) => program.shaders.push(shader),
    linkProgram: (program) => record('linkProgram', { program }),
    getProgramParameter: (program, key) => {
      if (key === gl.ACTIVE_ATTRIBUTES) return 1;
      if (key === gl.ACTIVE_UNIFORMS) return 0;
      return true;
    },
    getProgramInfoLog: () => '',
    getActiveAttrib: () => ({ name: 'position', size: 1, type: gl.FLOAT_VEC3 }),
    getAttribLocation: () => 0,
    getUniformLocation: () => null,
    getFragDataLocation: () => 0,
    useProgram: (program) => record('useProgram', { program }),
    checkFramebufferStatus: () => gl.FRAMEBUFFER_COMPLETE,
    clear: (...args) => record('clear', { args }),
    blitFramebuffer: (...args) => record('blitFramebuffer', { args }),
    generateMipmap: (...args) => record('generateMipmap', { args }),
    drawElements: (mode, count, type, offset) =>
      record('drawElements', {
        mode,
        count,
        type,
        offset,
        vao: currentVao,
        index: bindings.get(gl.ELEMENT_ARRAY_BUFFER),
      }),
    drawArrays: (mode, start, count) =>
      record('drawArrays', { mode, start, count, vao: currentVao }),
    drawElementsInstanced: (mode, count, type, offset, instances) =>
      record('drawElementsInstanced', {
        mode,
        count,
        type,
        offset,
        instances,
        vao: currentVao,
        index: bindings.get(gl.ELEMENT_ARRAY_BUFFER),
      }),
    drawArraysInstanced: (mode, start, count, instances) =>
      record('drawArraysInstanced', { mode, start, count, instances, vao: currentVao }),
  };
  const gl = new Proxy(calls, {
    get(target, name) {
      if (name in target) return target[name];
      if (typeof name === 'string' && /^[A-Z][A-Z0-9_]*$/.test(name)) {
        if (!constants.has(name)) constants.set(name, nextConstant++);
        return constants.get(name);
      }
      if (typeof name === 'string' && name.startsWith('create')) return () => handle(name.slice(6));
      return () => {};
    },
  });
  const canvas = {
    width: 256,
    height: 256,
    style: {},
    addEventListener() {},
    removeEventListener() {},
    setAttribute() {},
    getContext: () => gl,
  };
  gl.canvas = canvas;
  const previousSelf = globalThis.self;
  globalThis.self = { requestAnimationFrame: () => 1, cancelAnimationFrame() {} };
  const renderer = new T.WebGLRenderer({ canvas, context: gl });
  nativeRenderer = renderer;
  globalThis.self = previousSelf;
  renderer.info.autoReset = false;
  return {
    T,
    gl,
    renderer,
    events,
    buffers,
    nativeSurfaceState() {
      return {
        viewport: [...viewport],
        scissor: [...scissor],
        scissorTest,
        drawFramebuffer: framebuffers.get(gl.DRAW_FRAMEBUFFER) ?? null,
        readFramebuffer: framebuffers.get(gl.READ_FRAMEBUFFER) ?? null,
      };
    },
    stage(value) {
      stage = value;
    },
    clearEvents() {
      events.length = 0;
    },
    summary() {
      return {
        uploads: events.filter((e) => e.method === 'bufferData').length,
        updates: events.filter((e) => e.method === 'bufferSubData').length,
        draws: events.filter((e) => e.method.startsWith('draw')).length,
        rasterDraws: events.filter(
          (e) => e.method.startsWith('draw') && e.count > 0 && e.instances !== 0,
        ).length,
        deleted: events.filter((e) => e.method === 'deleteBuffer').length,
      };
    },
    dispose() {
      renderer.dispose();
    },
  };
}
