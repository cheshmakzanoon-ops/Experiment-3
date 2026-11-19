import { expect, test, type Page, type TestInfo } from '@playwright/test';
import { graphicsPreset } from '../src/rendering/options.ts';
import { H, carBase, hasRoadBikeContact } from '../src/simulation/protocol.ts';
import { MENU_STARTUP_TIMEOUT_MS } from './menu-startup.ts';
import { installProgramSetupDiagnostic } from './fixtures/program-setup-diagnostic.ts';

// Full production UI, worker, assets and High settings. Fixed small scene,
// original five-minute test deadline and all actual GPU completion gates.
// This is appearance/integration evidence, never a hardware FPS certificate.
test.use({ viewport: { width: 960, height: 600 }, deviceScaleFactor: 1 });

async function slide(page: Page, field: string, value: number) {
  await page.locator(`#photo-${field}`).evaluate((node, next) => {
    const input = node as HTMLInputElement;
    input.value = String(next);
    input.dispatchEvent(new Event('input', { bubbles: true }));
  }, value);
}
async function capture(page: Page, info: TestInfo, name: string) {
  const session = await page.context().newCDPSession(page);
  try {
    const result = await session.send('Page.captureScreenshot', {
      format: 'png',
      fromSurface: true,
      captureBeyondViewport: false,
    });
    await info.attach(name, {
      body: Buffer.from(result.data, 'base64'),
      contentType: 'image/png',
    });
  } finally {
    await session.detach();
  }
}

function installFirstChaseStartup(installProgramSetup: typeof installProgramSetupDiagnostic) {
  // A main-thread poll cannot identify a native call that never returns.
  // This test-only worker receives numeric command state, retains one start
  // and completion, and reports directly through its own console. It owns no
  // GL context and never requests a query, flush, finish or render yield.
  const prefix = 'APEX_HIGH_STARTUP ';
  const report = (record: object) => console.info(prefix + JSON.stringify(record));
  function activityWorker() {
    let started: Float64Array | null = null,
      completed: Float64Array | null = null,
      receivedAt = 0,
      stage = '',
      active = false,
      methods: string[] = [];
    const counts: number[] = [],
      cpuMs: number[] = [];
    const slowest = new Map<number, { started: Float64Array | null; completed: Float64Array }>();
    const emit = () => {
      const inFlight = !!started && (!completed || completed[1] < started[1]);
      console.info(
        'APEX_HIGH_STARTUP ' +
          JSON.stringify({
            kind: 'activity',
            stage,
            inFlight,
            observedInFlightMs: inFlight ? performance.now() - receivedAt : 0,
            lastStarted: started && {
              sequence: started[1],
              atMs: started[2],
              method: methods[started[3]],
              program: started[4],
              fragmentHash: started[5].toString(16).padStart(8, '0'),
              framebuffer: started[6],
              cubeFace: started[7],
              mip: started[8],
              viewport: Array.from(started.slice(9, 13)),
              count: started[13],
              instances: started[14],
              numericArguments: Array.from(started.slice(15, 19)),
              sourceBufferBytes: started[19] < 0 ? null : started[19],
              shader: started[20],
              shaderType: started[21],
              shaderHash: started[22].toString(16).padStart(8, '0'),
            },
            lastCompleted: completed && {
              sequence: completed[1],
              atMs: completed[2],
              method: methods[completed[3]],
              cpuCallMs: completed[4],
              returned: completed[5] === 1,
            },
            counts: Object.fromEntries(methods.map((method, i) => [method, counts[i] ?? 0])),
            cpuMs: Object.fromEntries(methods.map((method, i) => [method, cpuMs[i] ?? 0])),
            slowCalls: [...slowest.values()]
              .sort((a, b) => b.completed[4] - a.completed[4])
              .slice(0, 8)
              .map((entry) => ({
                sequence: entry.completed[1],
                method: methods[entry.completed[3]],
                cpuCallMs: entry.completed[4],
                program: entry.started?.[4],
                fragmentHash: entry.started?.[5].toString(16).padStart(8, '0'),
                framebuffer: entry.started?.[6],
                cubeFace: entry.started?.[7],
                viewport: entry.started && Array.from(entry.started.slice(9, 13)),
                shader: entry.started?.[20],
                shaderType: entry.started?.[21],
                shaderHash: entry.started?.[22].toString(16).padStart(8, '0'),
              })),
          }),
      );
    };
    self.onmessage = (event: MessageEvent) => {
      const message = event.data;
      if (message instanceof Float64Array) {
        if (message[0] === 1) {
          started = message;
          receivedAt = performance.now();
          counts[message[3]] = (counts[message[3]] ?? 0) + 1;
        } else {
          completed = message;
          cpuMs[message[3]] = (cpuMs[message[3]] ?? 0) + message[4];
          if (message[4] >= 100 && message[4] > (slowest.get(message[3])?.completed[4] ?? 0))
            slowest.set(message[3], { started, completed: message });
        }
      } else if (message.kind === 'configure') methods = message.methods;
      else if (message.kind === 'stage') {
        stage = message.stage;
        active = message.active;
        if (!active && started) emit();
      }
    };
    // At most two activity snapshots per second; the worker remains able to
    // report the latest start while its owner is inside a native GL call.
    setInterval(() => {
      if (active) emit();
    }, 500);
    console.info(
      'APEX_HIGH_STARTUP ' +
        JSON.stringify({ kind: 'worker-ready', workerUrl: self.location.href }),
    );
  }
  let worker: Worker | null = null;
  try {
    const url = URL.createObjectURL(
      new Blob([`(${activityWorker.toString()})()`], { type: 'text/javascript' }),
    );
    worker = new Worker(url);
    URL.revokeObjectURL(url);
    worker.onerror = (event) => {
      event.preventDefault();
      report({ kind: 'unavailable', message: event.message || 'Startup worker failed' });
      worker?.terminate();
      worker = null;
    };
  } catch (error) {
    report({ kind: 'unavailable', message: String(error) });
  }
  const post = (message: unknown) => {
    try {
      worker?.postMessage(message);
    } catch (error) {
      report({ kind: 'unavailable', message: String(error) });
      worker?.terminate();
      worker = null;
    }
  };
  const methods = [
    'drawElements',
    'drawArrays',
    'drawElementsInstanced',
    'drawArraysInstanced',
    'compileShader',
    'linkProgram',
    'getProgramParameter',
    'getShaderParameter',
    'getProgramInfoLog',
    'getShaderInfoLog',
    'getActiveUniform',
    'getUniformLocation',
    'getActiveAttrib',
    'getAttribLocation',
    'getFragDataLocation',
    'useProgram',
    'checkFramebufferStatus',
    'clear',
    'blitFramebuffer',
    'generateMipmap',
    'texStorage2D',
    'texImage2D',
    'texSubImage2D',
    'compressedTexImage2D',
    'compressedTexSubImage2D',
    'bufferData',
    'bufferSubData',
    'renderbufferStorage',
    'renderbufferStorageMultisample',
    'readPixels',
    'getBufferSubData',
    'fenceSync',
    'clientWaitSync',
    'flush',
  ];
  const programArguments = new Set([
    'linkProgram',
    'getProgramParameter',
    'getProgramInfoLog',
    'getActiveUniform',
    'getUniformLocation',
    'getActiveAttrib',
    'getAttribLocation',
    'getFragDataLocation',
    'useProgram',
  ]);
  post({ kind: 'configure', methods });
  const prototype = WebGL2RenderingContext.prototype;
  const ids = new WeakMap<object, number>();
  let nextId = 0;
  const id = (object: object | null | undefined) => {
    if (!object) return 0;
    let value = ids.get(object);
    if (!value) ids.set(object, (value = ++nextId));
    return value;
  };
  const contexts = new WeakMap<
    WebGL2RenderingContext,
    {
      program: WebGLProgram | null;
      framebuffer: WebGLFramebuffer | null;
      readFramebuffer: WebGLFramebuffer | null;
      viewport: number[];
    }
  >();
  const context = (gl: WebGL2RenderingContext) => {
    let state = contexts.get(gl);
    if (!state)
      contexts.set(
        gl,
        (state = {
          program: null,
          framebuffer: null,
          readFramebuffer: null,
          viewport: [0, 0, 0, 0],
        }),
      );
    return state;
  };
  const attachments = new WeakMap<WebGLFramebuffer, { face: number; mip: number }>();
  const shaderTypes = new WeakMap<WebGLShader, number>(),
    shaderSources = new WeakMap<WebGLShader, string>(),
    vertices = new WeakMap<WebGLProgram, WebGLShader>(),
    fragments = new WeakMap<WebGLProgram, WebGLShader>(),
    hashes = new WeakMap<WebGLProgram, number>(),
    shaderHashes = new WeakMap<WebGLShader, number>();
  const sourceHash = (source: string) => {
    let hash = 2166136261;
    for (let i = 0; i < source.length; i++)
      hash = Math.imul(hash ^ source.charCodeAt(i), 16777619) >>> 0;
    return hash;
  };
  const originalCreateShader = prototype.createShader,
    originalShaderSource = prototype.shaderSource,
    originalAttachShader = prototype.attachShader,
    originalBindFramebuffer = prototype.bindFramebuffer,
    originalFramebufferTexture2D = prototype.framebufferTexture2D,
    originalViewport = prototype.viewport,
    originalUseProgram = prototype.useProgram;
  prototype.createShader = function (type) {
    const shader = originalCreateShader.call(this, type);
    if (shader) shaderTypes.set(shader, type);
    return shader;
  };
  prototype.shaderSource = function (shader, source) {
    shaderSources.set(shader, source);
    shaderHashes.delete(shader);
    originalShaderSource.call(this, shader, source);
  };
  prototype.attachShader = function (program, shader) {
    if (shaderTypes.get(shader) === this.VERTEX_SHADER) vertices.set(program, shader);
    if (shaderTypes.get(shader) === this.FRAGMENT_SHADER) {
      fragments.set(program, shader);
      hashes.delete(program);
    }
    originalAttachShader.call(this, program, shader);
  };
  prototype.bindFramebuffer = function (target, framebuffer) {
    const state = context(this);
    if (target !== this.READ_FRAMEBUFFER) state.framebuffer = framebuffer;
    if (target !== this.DRAW_FRAMEBUFFER) state.readFramebuffer = framebuffer;
    originalBindFramebuffer.call(this, target, framebuffer);
  };
  prototype.framebufferTexture2D = function (target, attachment, face, texture, mip) {
    const state = context(this),
      framebuffer = target === this.READ_FRAMEBUFFER ? state.readFramebuffer : state.framebuffer;
    if (framebuffer && attachment === this.COLOR_ATTACHMENT0)
      attachments.set(framebuffer, { face, mip });
    originalFramebufferTexture2D.call(this, target, attachment, face, texture, mip);
  };
  prototype.viewport = function (x, y, width, height) {
    const viewport = context(this).viewport;
    viewport[0] = x;
    viewport[1] = y;
    viewport[2] = width;
    viewport[3] = height;
    originalViewport.call(this, x, y, width, height);
  };
  prototype.useProgram = function (program) {
    context(this).program = program;
    originalUseProgram.call(this, program);
  };
  let active = false,
    chaseStarted = false,
    finished = false,
    sequence = 0,
    stage = '',
    stageReports = 0;
  const firstUses = new Set<string>(),
    summaries = new WeakSet<WebGLProgram>(),
    latePrograms = new WeakSet<WebGLProgram>(),
    uploadMethods = new Set([
      'bufferData',
      'bufferSubData',
      'texImage2D',
      'texSubImage2D',
      'compressedTexImage2D',
      'compressedTexSubImage2D',
    ]);
  let summaryReports = 0,
    lateProgramReports = 0,
    slowUploadReports = 0;
  const boundedStack = () => new Error().stack?.split('\n').slice(1, 10).join('\n').slice(0, 4096);
  const shaderSummary = (shader: WebGLShader | undefined) => {
    if (!shader) return null;
    const source = shaderSources.get(shader) ?? '';
    return {
      shader: id(shader),
      hash: sourceHash(source).toString(16).padStart(8, '0'),
      shaderName:
        /^[ \t]*#define SHADER_NAME[ \t]+([^\r\n]+)/m.exec(source)?.[1].slice(0, 512) ?? null,
      sourceLength: source.length,
      source: source.slice(0, 32768),
      truncated: source.length > 32768,
    };
  };
  const begin = new Float64Array(23),
    end = new Float64Array(6);
  const callable = prototype as unknown as Record<string, (...args: unknown[]) => unknown>;
  for (const [methodIndex, method] of methods.entries()) {
    const original = callable[method];
    callable[method] = function (this: WebGL2RenderingContext, ...args: unknown[]) {
      if (!active) return Reflect.apply(original, this, args);
      if (method === 'linkProgram') {
        hashes.delete(args[0] as WebGLProgram);
        latePrograms.delete(args[0] as WebGLProgram);
      }
      const state = context(this),
        program = programArguments.has(method) ? (args[0] as WebGLProgram | null) : state.program,
        shader =
          method === 'compileShader' ||
          method === 'getShaderParameter' ||
          method === 'getShaderInfoLog'
            ? (args[0] as WebGLShader)
            : null,
        fragment = program && fragments.get(program),
        source = (fragment && shaderSources.get(fragment)) ?? '',
        framebuffer = state.framebuffer,
        attachment = framebuffer && attachments.get(framebuffer);
      let hash = program && hashes.get(program);
      if (program && hash === undefined) {
        hash = sourceHash(source);
        hashes.set(program, hash);
      }
      let shaderHash = shader && shaderHashes.get(shader);
      if (shader && shaderHash === undefined) {
        shaderHash = sourceHash(shaderSources.get(shader) ?? '');
        shaderHashes.set(shader, shaderHash);
      }
      if (program && !summaries.has(program) && summaryReports < 32) {
        summaries.add(program);
        summaryReports++;
        report({
          kind: 'program',
          stage,
          program: id(program),
          fragmentHash: (hash ?? 0).toString(16).padStart(8, '0'),
          shaderName: /#define SHADER_NAME\s+([^\n]+)/.exec(source)?.[1] ?? null,
          defines: source
            .split('\n')
            .filter((line) => /^\s*#define (?:NUM_|USE_|APEX_|STANDARD|PHYSICAL)/.test(line))
            .slice(0, 32),
          features: [...new Set(source.match(/\bapex[A-Z]\w*/g) ?? [])].slice(0, 32),
        });
      }
      if (firstUses.size < 64) {
        const key = `${method}:${id(program)}:${id(framebuffer)}`;
        if (!firstUses.has(key)) {
          firstUses.add(key);
          report({
            kind: 'first-use',
            stage,
            method,
            program: id(program),
            framebuffer: id(framebuffer),
            cubeFace: attachment?.face ?? 0,
            viewport: state.viewport,
            stack: new Error().stack?.split('\n').slice(1, 10).join('\n'),
          });
        }
      }
      // Initial scene setup can exhaust both early caps before the first chase.
      // Keep a separate small budget for metadata actually requested later,
      // using only shader text already observed at its native source call.
      if (
        chaseStarted &&
        method === 'getProgramInfoLog' &&
        program &&
        !latePrograms.has(program) &&
        lateProgramReports < 8
      ) {
        latePrograms.add(program);
        lateProgramReports++;
        report({
          kind: 'late-program',
          stage,
          sequence: sequence + 1,
          program: id(program),
          framebuffer: id(framebuffer),
          cubeFace: attachment?.face ?? 0,
          viewport: [...state.viewport],
          vertex: shaderSummary(vertices.get(program)),
          fragment: shaderSummary(fragment ?? undefined),
          stack: boundedStack(),
        });
      }
      const serial = ++sequence,
        startedAt = performance.now();
      begin[0] = 1;
      begin[1] = serial;
      begin[2] = startedAt;
      begin[3] = methodIndex;
      begin[4] = id(program);
      begin[5] = hash ?? 0;
      begin[6] = id(framebuffer);
      begin[7] = attachment?.face ?? 0;
      begin[8] = attachment?.mip ?? 0;
      for (let i = 0; i < 4; i++) {
        begin[9 + i] = state.viewport[i];
        begin[15 + i] = typeof args[i] === 'number' ? (args[i] as number) : -1;
      }
      begin[13] = method.startsWith('drawElements')
        ? Number(args[1])
        : method.startsWith('drawArrays')
          ? Number(args[2])
          : 0;
      begin[14] =
        method === 'drawElementsInstanced'
          ? Number(args[4])
          : method === 'drawArraysInstanced'
            ? Number(args[3])
            : 1;
      begin[19] = -1;
      for (let i = args.length - 1; i >= 0; i--) {
        const argument = args[i];
        if (ArrayBuffer.isView(argument) || argument instanceof ArrayBuffer) {
          begin[19] = argument.byteLength;
          break;
        }
      }
      begin[20] = id(shader);
      begin[21] = shader ? (shaderTypes.get(shader) ?? 0) : 0;
      begin[22] = shaderHash ?? 0;
      post(begin);
      let returned = false;
      try {
        const result = Reflect.apply(original, this, args);
        returned = true;
        return result;
      } finally {
        const completedAt = performance.now();
        end[0] = 2;
        end[1] = serial;
        end[2] = completedAt;
        end[3] = methodIndex;
        end[4] = completedAt - startedAt;
        end[5] = returned ? 1 : 0;
        post(end);
        // Capture call sites only after an already-observed slow upload returns.
        // No stack work or extra native query is added to ordinary fast uploads,
        // and the completion timestamp excludes this bounded report.
        if (
          returned &&
          chaseStarted &&
          uploadMethods.has(method) &&
          completedAt - startedAt >= 100 &&
          slowUploadReports < 16
        ) {
          slowUploadReports++;
          report({
            kind: 'slow-upload',
            stage,
            sequence: serial,
            method,
            cpuCallMs: completedAt - startedAt,
            program: id(program),
            fragmentHash: (hash ?? 0).toString(16).padStart(8, '0'),
            framebuffer: id(framebuffer),
            cubeFace: attachment?.face ?? 0,
            viewport: [...state.viewport],
            numericArguments: Array.from(begin.slice(15, 19)),
            sourceBufferBytes: begin[19] < 0 ? null : begin[19],
            stack: boundedStack(),
          });
        }
      }
    };
  }
  const programSetup = installProgramSetup({
    prototype: callable,
    active: () => active && chaseStarted && !finished,
    stage: () => stage,
    identify: id,
    describeContext(gl) {
      const state = context(gl),
        attachment = state.framebuffer && attachments.get(state.framebuffer);
      return {
        program: id(state.program),
        fragmentHash: ((state.program && hashes.get(state.program)) || 0)
          .toString(16)
          .padStart(8, '0'),
        framebuffer: id(state.framebuffer),
        cubeFace: attachment?.face ?? 0,
        viewport: [...state.viewport],
      };
    },
    report,
  });
  // One bounded cumulative summary per second or stage transition. Individual
  // uniform calls never send worker messages; slow returned calls have their
  // own capped records, independent of the generic activity ring.
  const setupTimer = setInterval(() => programSetup.flush('interval'), 1000);
  let loadingText: HTMLElement | null = null;
  const observe = () => {
    if (finished) return;
    if (!loadingText) {
      loadingText = document.getElementById('loadingText');
      if (!loadingText) return;
      observer.disconnect();
      observer.observe(loadingText, { childList: true, characterData: true, subtree: true });
      // This existing loading label is assigned immediately before native
      // preparation. MutationObserver alone runs too late if that query blocks.
      // Preserve its own native accessor and observe only this one element.
      try {
        const descriptor = Object.getOwnPropertyDescriptor(Node.prototype, 'textContent');
        if (!descriptor?.get || !descriptor.set) throw new Error('Missing textContent accessor');
        const { get, set } = descriptor;
        Object.defineProperty(loadingText, 'textContent', {
          configurable: true,
          get() {
            return get.call(this);
          },
          set(value: string | null) {
            set.call(this, value);
            observe();
          },
        });
      } catch (error) {
        report({ kind: 'unavailable', message: `Synchronous loading-stage observer: ${error}` });
      }
    }
    const next = loadingText.textContent ?? '';
    if (next === stage) return;
    programSetup.flush('stage-transition');
    stage = next;
    if (/Warming shadows and scene reflections/.test(stage)) chaseStarted = true;
    active =
      chaseStarted || /Preparing reflections|Preparing circuit and vehicle materials/.test(stage);
    if (chaseStarted && /Warming cockpit|completed cockpit/.test(stage)) {
      active = false;
      finished = true;
    }
    if (
      /Preparing reflections|Preparing circuit and vehicle materials|Building GP|photographed (sky|ground)|Compiling|Warming|Waiting for completed/.test(
        stage,
      ) &&
      stageReports++ < 32
    )
      report({ kind: 'stage', atMs: performance.now(), stage, active });
    post({ kind: 'stage', stage, active });
    if (finished) {
      observer.disconnect();
      clearInterval(setupTimer);
    }
  };
  const observer = new MutationObserver(observe);
  observer.observe(document, { childList: true, subtree: true });
  observe();
}

function installInstancedFragmentOutputs() {
  // Test-only diagnosis of the observed missing-fragment-output GL warning.
  // Cache linked outputs when production already checks completed metadata.
  // Querying them after queued cube faces made the diagnostic itself stall.
  // Actual draws still check missing outputs against their current draw buffers;
  // programs without a metadata check retain the original first-draw fallback.
  const prototype = WebGL2RenderingContext.prototype,
    createShader = prototype.createShader,
    shaderSource = prototype.shaderSource,
    attachShader = prototype.attachShader,
    linkProgram = prototype.linkProgram,
    getProgramParameter = prototype.getProgramParameter,
    useProgram = prototype.useProgram;
  // Record repeated immutable-storage allocation without querying or draining
  // driver errors. The first and repeated call sites identify the actual
  // resource owner; warning text alone cannot distinguish cloned maps from
  // render-target lifetime errors.
  const activeTexture = prototype.activeTexture,
    bindTexture = prototype.bindTexture,
    texStorage2D = prototype.texStorage2D,
    activeUnits = new WeakMap<WebGL2RenderingContext, number>(),
    bindings = new WeakMap<WebGL2RenderingContext, Map<string, WebGLTexture | null>>(),
    allocations = new WeakMap<WebGLTexture, { args: number[]; stack: string }>();
  let textureReports = 0;
  prototype.activeTexture = function (unit) {
    activeUnits.set(this, unit);
    activeTexture.call(this, unit);
  };
  prototype.bindTexture = function (target, texture) {
    let contextBindings = bindings.get(this);
    if (!contextBindings) bindings.set(this, (contextBindings = new Map()));
    contextBindings.set(`${activeUnits.get(this) ?? this.TEXTURE0}:${target}`, texture);
    bindTexture.call(this, target, texture);
  };
  prototype.texStorage2D = function (...args) {
    const texture = bindings.get(this)?.get(`${activeUnits.get(this) ?? this.TEXTURE0}:${args[0]}`);
    if (texture) {
      const previous = allocations.get(texture);
      if (previous && textureReports < 12) {
        textureReports++;
        console.warn(
          'APEX_HIGH_TEXTURE_REALLOCATION ' +
            JSON.stringify({
              atMs: performance.now(),
              previous,
              current: { args, stack: new Error().stack },
            }),
        );
      } else if (!previous) allocations.set(texture, { args, stack: new Error().stack ?? '' });
    }
    texStorage2D.apply(this, args);
  };
  const types = new WeakMap<WebGLShader, number>(),
    sources = new WeakMap<WebGLShader, string>(),
    fragments = new WeakMap<WebGLProgram, WebGLShader>(),
    linkedSources = new WeakMap<WebGLProgram, string>(),
    outputCache = new WeakMap<
      WebGLProgram,
      { source: string; outputs: { name: string; location: number }[] }
    >(),
    current = new WeakMap<WebGL2RenderingContext, WebGLProgram | null>(),
    inspected = new WeakSet<WebGLProgram>();
  let reports = 0;
  prototype.createShader = function (type) {
    const shader = createShader.call(this, type);
    if (shader) types.set(shader, type);
    return shader;
  };
  prototype.shaderSource = function (shader, source) {
    if (types.get(shader) === this.FRAGMENT_SHADER) sources.set(shader, source);
    shaderSource.call(this, shader, source);
  };
  prototype.attachShader = function (program, shader) {
    if (types.get(shader) === this.FRAGMENT_SHADER) fragments.set(program, shader);
    attachShader.call(this, program, shader);
  };
  prototype.linkProgram = function (program) {
    linkProgram.call(this, program);
    inspected.delete(program);
    outputCache.delete(program);
    const fragment = fragments.get(program),
      source = fragment && sources.get(fragment);
    if (source !== undefined) linkedSources.set(program, source);
    else linkedSources.delete(program);
  };
  prototype.useProgram = function (program) {
    current.set(this, program);
    useProgram.call(this, program);
  };
  const cacheOutputs = (gl: WebGL2RenderingContext, program: WebGLProgram) => {
    const cached = outputCache.get(program);
    if (cached) return cached;
    const source = linkedSources.get(program);
    if (!source) return null;
    const declarations = source.matchAll(
      /\bout\s+(?:(?:lowp|mediump|highp)\s+)?(?:float|int|uint|[biu]?vec[234])\s+([A-Za-z_]\w*)(?:\s*\[\s*(\d+)\s*\])?\s*;/g,
    );
    const outputs = [...declarations].map((declaration) => {
      const name = declaration[1] + (declaration[2] ? '[0]' : '');
      return { name, location: gl.getFragDataLocation(program, name) };
    });
    const result = { source, outputs };
    outputCache.set(program, result);
    return result;
  };
  prototype.getProgramParameter = function (program, parameter) {
    const result = getProgramParameter.call(this, program, parameter);
    // Do not introduce a status query or synchronize at linkProgram. In r180
    // this true LINK_STATUS is requested after the ordinary first-use logs;
    // COMPLETION_STATUS_KHR polling and failed links are left untouched.
    if (parameter === this.LINK_STATUS && result === true && reports < 8)
      cacheOutputs(this, program);
    return result;
  };
  const inspect = (gl: WebGL2RenderingContext) => {
    const program = current.get(gl);
    if (!program || inspected.has(program) || reports >= 8) return;
    inspected.add(program);
    const cached = cacheOutputs(gl, program);
    if (!cached) return;
    const { source, outputs } = cached;
    if (outputs.some((output) => output.location >= 0)) return;
    const drawBuffers = Array.from(
      { length: gl.getParameter(gl.MAX_DRAW_BUFFERS) as number },
      (_, i) => gl.getParameter(gl.DRAW_BUFFER0 + i) as number,
    );
    if (drawBuffers.every((buffer) => buffer === gl.NONE)) return;
    reports++;
    console.warn(
      'APEX_HIGH_MISSING_FRAGMENT_OUTPUT ' +
        JSON.stringify({ atMs: performance.now(), outputs, drawBuffers, source }),
    );
  };
  const elements = prototype.drawElementsInstanced,
    arrays = prototype.drawArraysInstanced;
  prototype.drawElementsInstanced = function (...args) {
    inspect(this);
    elements.apply(this, args);
  };
  prototype.drawArraysInstanced = function (...args) {
    inspect(this);
    arrays.apply(this, args);
  };
}

test('High production scene presents an active GP chassis and two completed photo views', async ({
  page,
}, info) => {
  const errors: string[] = [],
    observations = [],
    startupRecords: Record<string, unknown>[] = [],
    startupPrograms: Record<string, unknown>[] = [],
    startupLatePrograms: Record<string, unknown>[] = [],
    startupSlowUploads: Record<string, unknown>[] = [],
    startupSlowProgramSetup: Record<string, unknown>[] = [];
  let startupWorkerUrl: string | null = null,
    startupLastStarted: unknown = null,
    startupLastCompleted: unknown = null,
    startupProgramSetupSummary: Record<string, unknown> | null = null;
  page.on('pageerror', (error) => errors.push(error.message));
  page.on('console', (message) => {
    const text = message.text();
    if (text.startsWith('APEX_HIGH_STARTUP ')) {
      try {
        const record = JSON.parse(text.slice('APEX_HIGH_STARTUP '.length)) as Record<
          string,
          unknown
        >;
        startupRecords.push(record);
        if (startupRecords.length > 256) startupRecords.shift();
        if (record.kind === 'program' && startupPrograms.length < 32) startupPrograms.push(record);
        if (record.kind === 'late-program' && startupLatePrograms.length < 8)
          startupLatePrograms.push(record);
        if (record.kind === 'slow-upload' && startupSlowUploads.length < 16)
          startupSlowUploads.push(record);
        if (record.kind === 'slow-program-setup' && startupSlowProgramSetup.length < 16)
          startupSlowProgramSetup.push(record);
        if (record.kind === 'program-setup-summary') startupProgramSetupSummary = record;
        if (record.kind === 'worker-ready' && typeof record.workerUrl === 'string')
          startupWorkerUrl = record.workerUrl;
        if (record.lastStarted) startupLastStarted = record.lastStarted;
        if (record.lastCompleted) startupLastCompleted = record.lastCompleted;
      } catch {
        errors.push('Malformed High startup diagnostic');
      }
    }
    if (
      message.type() === 'error' ||
      /\bGL_(?:INVALID_\w+|OUT_OF_MEMORY|CONTEXT_LOST)\b|APEX_HIGH_(?:MISSING_FRAGMENT_OUTPUT|TEXTURE_REALLOCATION)/.test(
        message.text(),
      )
    )
      errors.push(message.text());
  });
  let lastDiagnostic: ReturnType<Window['apexDiagnostics']> | null = null,
    lastObservedAt: string | null = null;
  const read = async () => {
    const diagnostic = await page.evaluate(() => window.apexDiagnostics());
    lastDiagnostic = diagnostic;
    lastObservedAt = new Date().toISOString();
    return diagnostic;
  };
  // One init script fixes wrapper order: missing-output inspection remains
  // outside the native-command wrappers, so its own queries are not mistaken
  // for the duration of an instanced draw.
  await page.addInitScript({
    content: `(${installFirstChaseStartup.toString()})(${installProgramSetupDiagnostic.toString()});(${installInstancedFragmentOutputs.toString()})();`,
  });
  try {
    await page.goto('/');
    await expect(page.locator('#menu')).toBeVisible({ timeout: MENU_STARTUP_TIMEOUT_MS });
    expect((await read()).renderer?.gpuFrameQueue.completed).toBeGreaterThan(0);
    await page.selectOption('#vehicle', 'gpr1');
    await page.getByRole('button', { name: 'GARAGE & SETTINGS', exact: true }).click();
    await page.locator('[name=quality]').selectOption('high');
    await page.getByRole('button', { name: 'APPLY & SAVE', exact: true }).click();
    await expect(page.locator('#modal')).toBeHidden();
    await expect.poll(async () => (await read()).settingsTransition.busy).toBe(false);
    await expect
      .poll(async () => (await read()).renderer?.graphics)
      .toEqual(graphicsPreset('high'));
    await page.selectOption('#circuit', 'aurel');
    await page.selectOption('#mode', 'practice');
    await page.selectOption('#opponents', '0');
    await page.selectOption('#weather', 'clear');
    await page.getByRole('button', { name: 'PREPARE GRID START PAUSED', exact: true }).click();
    await expect.poll(async () => (await read()).state, { timeout: 90000 }).toBe('paused');
    const prepared = await read();
    expect(prepared.renderer?.presentationPurpose).toBe('circuit');
    expect(prepared.renderer?.preparation?.status).toBe('complete');
    expect(prepared.renderer?.construction.cancelled).toBe(false);
    expect(prepared.renderer?.gpuFrameQueue.completed).toBeGreaterThan(0);
    expect(prepared.frame?.[H.CARS]).toBe(1);
    await page.getByRole('button', { name: 'RESUME SESSION', exact: true }).click();
    await expect.poll(async () => (await read()).frame?.[H.TICK] ?? 0).toBeGreaterThan(4);
    await page.keyboard.press('Escape');
    await expect
      .poll(async () => (await read()).workerPause)
      .toMatchObject({ paused: true, pending: false });
    const held = await read();
    expect(held.frame?.every(Number.isFinite)).toBe(true);
    expect(hasRoadBikeContact(new Float32Array(held.frame!), carBase(0))).toBe(true);
    await page.getByRole('button', { name: 'PHOTO STUDIO', exact: true }).click();
    await slide(page, 'distance', 5.5);
    await slide(page, 'focalLength', 38);
    await slide(page, 'elevation', 10);
    for (const [view, azimuth] of [
      ['three-quarter', 38],
      ['side', 90],
    ] as const) {
      await slide(page, 'azimuth', azimuth);
      await expect
        .poll(async () => (await read()).renderer?.photo)
        .toMatchObject({ target: 0, azimuth, distance: 5.5 });
      const submitted = (await read()).renderer!.gpuFrameQueue.submitted;
      // At least one later submission must actually complete after this view
      // was requested. Two animation callbacks alone cannot establish that.
      await expect
        .poll(async () => (await read()).renderer?.gpuFrameQueue.completed ?? 0)
        .toBeGreaterThan(submitted);
      await page.getByRole('button', { name: 'CLEAN FRAME', exact: true }).click();
      await capture(page, info, `high-gp-${view}.png`);
      const observed = await read();
      expect(observed.frame).toEqual(held.frame);
      expect(observed.renderer?.graphics).toEqual(graphicsPreset('high'));
      expect(observed.renderer?.gpuFrameQueue.failure).toBeNull();
      expect(observed.renderer?.renderWidth).toBe(960);
      expect(observed.renderer?.renderHeight).toBe(600);
      expect(observed.renderer?.drawCalls).toBeGreaterThan(0);
      expect(observed.renderer?.triangles).toBeGreaterThan(0);
      observations.push({ view, renderer: observed.renderer, presented: observed.presentation });
      await page.getByRole('button', { name: 'SHOW CONTROLS', exact: true }).click();
    }
    const backend = await page.evaluate(() => {
      const canvas = document.querySelector<HTMLCanvasElement>('#world');
      const gl = canvas?.getContext('webgl2');
      if (!gl) throw new Error('Production WebGL2 canvas unavailable');
      const debug = gl.getExtension('WEBGL_debug_renderer_info');
      return {
        vendor: String(gl.getParameter(debug?.UNMASKED_VENDOR_WEBGL ?? gl.VENDOR)),
        renderer: String(gl.getParameter(debug?.UNMASKED_RENDERER_WEBGL ?? gl.RENDERER)),
        contextAlive: !gl.isContextLost(),
      };
    });
    expect(backend.contextAlive).toBe(true);
    expect(held.buildIdentity.fingerprint).toMatch(/^[0-9a-f]{64}$/);
    await info.attach('high-gp-application.json', {
      body: JSON.stringify(
        {
          scope: 'Full application at 960x600 High; paused appearance, not FPS certification',
          physicalHardwareValidated: false,
          buildIdentity: held.buildIdentity,
          backend,
          options: held.options,
          frame: held.frame,
          observations,
        },
        null,
        2,
      ),
      contentType: 'application/json',
    });
    expect(errors).toEqual([]);
  } finally {
    // A blocked render thread cannot answer another evaluate call. Preserve the
    // last successful poll and console errors entirely from the Node process.
    await info.attach('high-gp-last-diagnostic.json', {
      body: JSON.stringify({ lastObservedAt, lastDiagnostic, errors }, null, 2),
      contentType: 'application/json',
    });
    await info.attach('high-gp-startup-commands.json', {
      body: JSON.stringify(
        {
          scope:
            'Test-only first-chase command tracing; CPU call duration includes instrumentation and is not GPU execution time.',
          workerObserved: startupWorkerUrl !== null,
          limitation: startupWorkerUrl
            ? null
            : 'The independent worker was unavailable or its console was not observed; only bounded main-thread records may be present.',
          lastStarted: startupLastStarted,
          lastCompleted: startupLastCompleted,
          programs: startupPrograms,
          latePrograms: startupLatePrograms,
          slowUploads: startupSlowUploads,
          programSetup: {
            slowCalls: startupSlowProgramSetup,
            summary: startupProgramSetupSummary,
            limitation:
              'Passive returned-call timings add wrapper/clock overhead; they identify CPU call boundaries, not isolated GPU execution. No extra GL queries or per-uniform worker messages are issued.',
          },
          records: startupRecords,
        },
        null,
        2,
      ),
      contentType: 'application/json',
    });
    // Address the worker's own execution context, never the blocked page.
    // Fixture teardown also closes it if this best-effort request cannot run.
    const startupWorker = page.workers().find((worker) => worker.url() === startupWorkerUrl);
    if (startupWorker)
      await Promise.race([
        startupWorker.evaluate(() => self.close()).catch(() => {}),
        new Promise<void>((resolve) => setTimeout(resolve, 1000)),
      ]);
  }
});
