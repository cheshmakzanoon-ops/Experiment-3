import { readFileSync } from 'node:fs';
import ts from 'typescript';
import * as T from 'three';
import { afterEach, describe, expect, it, vi, type Mock } from 'vitest';
import { RacingAudio } from '../src/audio/engine.ts';
import { UiSounds } from '../src/audio/ui-sounds.ts';
import { Rumble } from '../src/input/rumble.ts';
import { SessionLifetime } from '../src/session/session-lifetime.ts';
import { SessionStartOwner } from '../src/session/session-start-owner.ts';
import { uiCue } from '../src/ui/ui-cue.ts';
import { FakeContext, asContext } from './fake-audio.ts';

/** Execute the actual host method without main.ts's automatic UI boot or its
 * full rendering imports. The AST selects one complete method; no branch or
 * cleanup operation is copied, substituted or asserted as a source string. */
function disposalCode(path: string, className: string) {
  const source = ts.createSourceFile(
    path,
    readFileSync(new URL(path, import.meta.url), 'utf8'),
    ts.ScriptTarget.Latest,
    true,
  );
  const owner = source.statements.find(
    (node): node is ts.ClassDeclaration =>
      ts.isClassDeclaration(node) && node.name?.text === className,
  );
  const disposal = owner?.members.find(
    (node): node is ts.MethodDeclaration =>
      ts.isMethodDeclaration(node) && node.name.getText(source) === 'dispose',
  );
  if (!disposal) throw new Error(`${className}.dispose must exist for the integration check`);
  return ts.transpileModule(`class Owner { ${disposal.getText(source)} }`, {
    compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.None },
  }).outputText;
}

function method(code: string, dependencies: Record<string, unknown>) {
  return new Function(...Object.keys(dependencies), `${code}; return Owner.prototype.dispose;`)(
    ...Object.values(dependencies),
  ) as (this: object) => void;
}

const hostCode = disposalCode('../src/main.ts', 'GameApp');
const sessionCode = disposalCode('../src/session/free-roam.ts', 'FestivalSession');
const rendererCode = disposalCode(
  '../src/rendering/open-world/festival-renderer.ts',
  'FestivalRenderer',
);

class AudioContextFixture extends FakeContext {
  resume = vi.fn(async () => {
    this.state = 'running';
  });
  close = vi.fn(async () => {
    this.state = 'closed';
  });
}

type Host = Record<string, unknown> & { disposed: boolean; generation: number; dispose(): void };
const stages = [
  'keyboard',
  'blur',
  'pagehide',
  'pageshow',
  'review',
  'tab',
  'performance',
  'interrupt',
  'video',
  'export',
  'pump',
  'festival',
  'demo',
  'frame',
  'timeout',
  'worker',
  'media',
  'reference',
  'input',
  'menuFrames',
  'menuReceipt',
  'renderer',
  'ui',
  'rumble',
] as const;
type Stage = (typeof stages)[number];

function fixture() {
  const order: string[] = [];
  const release = Object.fromEntries(
    stages.map((name) => [
      name,
      vi.fn(() => {
        order.push(name);
      }),
    ]),
  ) as Record<Stage, Mock<() => void>>;
  const replay = vi.fn(async () => {
    order.push('replay');
  });
  const audio = vi.fn(async () => {
    order.push('audio');
  });
  const warn = vi.fn();
  const removeEventListener = vi.fn((type: string, _listener: unknown) => {
    if (type === 'keydown') release.keyboard();
    else if (type === 'blur') release.blur();
    else if (type === 'pagehide') release.pagehide();
    else if (type === 'pageshow') release.pageshow();
    else throw new Error(`Unexpected host listener: ${type}`);
  });
  const dispose = method(hostCode, {
    window: { removeEventListener },
    cancelAnimationFrame: release.frame,
    clearTimeout: release.timeout,
    console: { warn },
  });
  const host: Host = {
    disposed: false,
    pageWaiters: new Set<() => void>(),
    generation: 17,
    reviewKeyboard: () => undefined,
    suspendOnBlur: () => undefined,
    pageHide: () => undefined,
    pageShow: () => undefined,
    sessionReview: { stop: release.review },
    tabEvidence: { dispose: release.tab },
    performanceCapture: { interrupt: release.performance },
    interruptReview: release.interrupt,
    reviewVideo: { dispose: release.video },
    exporter: { cancel: release.export },
    replay: { dispose: replay },
    inputPump: { dispose: release.pump },
    ui: { dispose: vi.fn() },
    festivalOwner: { cancel: release.festival },
    endDemoClock: release.demo,
    timer: 71,
    initTimeout: 72,
    worker: { terminate: release.worker },
    mediaView: { dispose: release.media },
    referenceSession: { dispose: release.reference },
    input: { dispose: release.input, activePad: () => null },
    menuFrames: { dispose: release.menuFrames },
    menuPreviewReceipt: { dispose: release.menuReceipt },
    renderer: { dispose: release.renderer },
    uiSounds: { dispose: release.ui },
    rumble: { stop: release.rumble },
    audio: { dispose: audio },
    dispose() {
      dispose.call(this);
    },
  };
  return { host, release, replay, audio, order, warn, removeEventListener };
}

type DisposableOwner = Record<string, unknown> & { disposed: boolean; dispose(): void };

function sessionFixture() {
  const release = {
    ready: vi.fn(),
    commands: vi.fn(),
    mouse: vi.fn(),
    listener: vi.fn(),
    controls: vi.fn(),
    audio: vi.fn(),
    worker: vi.fn(),
    tiles: vi.fn(),
    traffic: vi.fn(),
    riders: vi.fn(),
    renderer: vi.fn(),
    hud: vi.fn(),
  };
  const dispose = method(sessionCode, { window: { removeEventListener: release.listener } });
  const lifetime = new SessionLifetime('Festival session closed');
  const worker = {
    onmessage: () => undefined,
    onerror: () => undefined,
    terminate: release.worker,
  };
  const tiles = {
    onerror: () => undefined,
    onmessageerror: () => undefined,
    terminate: release.tiles,
  };
  const session: DisposableOwner = {
    disposed: false,
    lifetime,
    settleReady: release.ready,
    rejectCommands: release.commands,
    releaseMouseLook: release.mouse,
    photoKeys: () => undefined,
    controls: { dispose: release.controls },
    host: { audio: { stop: release.audio } },
    worker,
    tiles,
    traffic: { dispose: release.traffic },
    riders: { dispose: release.riders },
    renderer: { dispose: release.renderer },
    hud: { dispose: release.hud },
    current: new Float32Array(8),
    previous: new Float32Array(8),
    status: { mode: 'free' },
    dispose() {
      dispose.call(this);
    },
  };
  return { session, release, lifetime, worker, tiles };
}

const rendererOwners = [
  'atmosphere',
  'terrain',
  'roads',
  'streetLights',
  'practicalLights',
  'buildings',
  'dressing',
  'crops',
  'details',
  'streetDetails',
  'contacts',
  'vegetation',
  'photoVegetation',
  'water',
  'markers',
  'reflection',
  'cars',
  'trails',
  'guidance',
  'orbit',
  'environment',
  'wet',
  'shadows',
  'bloom',
  'outputPass',
  'grade',
  'fxaa',
  'imagePipeline',
  'ultra',
  'photoSky',
  'composer',
  'gpuFrames',
] as const;

function rendererFixture() {
  const release = Object.fromEntries(rendererOwners.map((name) => [name, vi.fn()])) as Record<
    (typeof rendererOwners)[number],
    Mock
  >;
  const ground = vi.fn(),
    reset = vi.fn();
  const dispose = method(rendererCode, { scannedGround: { detach: ground }, T });
  const scene = new T.Scene(),
    effects = new T.Group();
  const sun = new T.DirectionalLight();
  const sky = new T.Mesh(new T.BufferGeometry(), new T.MeshBasicMaterial());
  const shadow = vi.spyOn(sun.shadow, 'dispose');
  // Empty generic geometry and materials exercise Three's actual disposal-event
  // behavior. No authored model, environment or artwork is loaded or changed.
  const meshes = [
    new T.Mesh(new T.BufferGeometry(), [new T.MeshBasicMaterial(), new T.MeshBasicMaterial()]),
    new T.Mesh(new T.BufferGeometry(), new T.MeshBasicMaterial()),
  ];
  effects.add(...meshes);
  scene.add(effects, sky, sun);
  const geometry = [...meshes, sky].map((mesh) => vi.spyOn(mesh.geometry, 'dispose'));
  const materials = [...meshes, sky].flatMap((mesh) =>
    Array.isArray(mesh.material) ? mesh.material : [mesh.material],
  );
  const material = materials.map((value) => vi.spyOn(value, 'dispose'));
  const clear = vi.spyOn(scene, 'clear');
  const renderer: DisposableOwner = {
    ...Object.fromEntries(rendererOwners.map((name) => [name, { dispose: release[name] }])),
    disposed: false,
    renderer: {},
    vehiclePaint: [{}],
    vehicleRoots: [{}],
    effectPlayback: { reset },
    effects: { group: effects },
    scene,
    sun,
    sky,
    dispose() {
      dispose.call(this);
    },
  };
  return {
    renderer,
    release,
    ground,
    reset,
    meshes,
    geometry,
    materials,
    material,
    scene,
    clear,
    shadow,
  };
}

async function adopt(session: DisposableOwner) {
  const owner = new SessionStartOwner<DisposableOwner>();
  await owner.start({
    load: async () => null,
    create: async () => session,
    ready() {},
    failed() {},
  });
  return owner;
}

function expectSessionReleased(f: ReturnType<typeof sessionFixture>) {
  expect(f.session.disposed).toBe(true);
  for (const name of [
    'controls',
    'traffic',
    'riders',
    'renderer',
    'hud',
    'current',
    'previous',
    'status',
  ])
    expect(f.session[name], name).toBeNull();
  for (const release of Object.values(f.release)) expect(release).toHaveBeenCalledTimes(1);
  expect(f.worker.onmessage).toBeNull();
  expect(f.worker.onerror).toBeNull();
  expect(f.tiles.onerror).toBeNull();
  expect(f.tiles.onmessageerror).toBeNull();
  expect(f.lifetime.signal.aborted).toBe(true);
  expect(f.release.commands).toHaveBeenCalledWith(f.lifetime.signal.reason);
}

function expectRendererReleased(f: ReturnType<typeof rendererFixture>) {
  expect(f.renderer.disposed).toBe(true);
  for (const name of ['details', 'streetDetails', 'photoVegetation'])
    expect(f.renderer[name], name).toBeNull();
  expect(f.renderer.vehiclePaint).toEqual([]);
  expect(f.renderer.vehicleRoots).toEqual([]);
  for (const release of Object.values(f.release)) expect(release).toHaveBeenCalledTimes(1);
  for (const release of [...f.geometry, ...f.material]) expect(release).toHaveBeenCalledTimes(1);
  expect(f.ground).toHaveBeenCalledTimes(1);
  expect(f.reset).toHaveBeenCalledTimes(1);
  expect(f.shadow).toHaveBeenCalledTimes(1);
  expect(f.clear).toHaveBeenCalledTimes(1);
  expect(f.scene.children).toEqual([]);
}

afterEach(() => vi.restoreAllMocks());

describe('terminal host resource ownership', () => {
  it('closes the real menu audio owner and revokes its event listeners', async () => {
    const f = fixture(),
      context = new AudioContextFixture(),
      target = new EventTarget();
    const sounds = new UiSounds({
      target,
      settings: () => ({ volume: 0.5, muted: false }),
      activated: () => true,
      createContext: () => context as unknown as AudioContext,
    });
    f.host.uiSounds = sounds;
    try {
      expect(sounds.cue('select')).toBe(true);
      f.host.dispose();
      expect(context.close).toHaveBeenCalledTimes(1);
      context.currentTime = 2;
      uiCue('confirm', target);
      expect(sounds.cue('tick')).toBe(false);
      expect(sounds.played).toBe(1);
      expect(context.nodes.every((node) => node.outputs.length === 0)).toBe(true);
    } finally {
      sounds.dispose();
    }
  });

  it('still closes the real racing audio graph after renderer teardown reports a failure', async () => {
    const f = fixture(),
      audio = new RacingAudio(),
      context = new AudioContextFixture();
    const failure = new Error('render target cleanup failed');
    await audio.start(asContext(context));
    f.host.audio = audio;
    f.release.renderer.mockImplementation(() => {
      throw failure;
    });
    try {
      expect(() => f.host.dispose()).toThrow(failure);
      expect(context.close).toHaveBeenCalledTimes(1);
      expect(audio.diagnostics().state).toBe('uninitialized');
      expect(context.nodes.every((node) => node.outputs.length === 0)).toBe(true);
    } finally {
      await audio.dispose();
    }
  });

  it.each(['review', 'video', 'festival', 'renderer'] as const)(
    'finishes independent releases when %s cleanup throws, preserving the original failure',
    (stage) => {
      const f = fixture(),
        failure = new Error(`${stage} teardown failed`);
      f.release[stage].mockImplementation(() => {
        f.order.push(stage);
        throw failure;
      });
      expect(() => f.host.dispose()).toThrow(failure);
      expect(f.host.disposed).toBe(true);
      expect(f.host.generation).toBe(18);
      for (const name of stages) expect(f.release[name], name).toHaveBeenCalledTimes(1);
      expect(f.replay).toHaveBeenCalledTimes(1);
      expect(f.audio).toHaveBeenCalledTimes(1);
      expect(() => f.host.dispose()).not.toThrow();
      for (const name of stages) expect(f.release[name], name).toHaveBeenCalledTimes(1);
    },
  );

  it('revokes host ownership before a child can reenter disposal', () => {
    const f = fixture();
    let reentered = false;
    const observed: { disposed: boolean; generation: number }[] = [];
    f.release.review.mockImplementation(() => {
      observed.push({ disposed: f.host.disposed, generation: f.host.generation });
      if (!reentered) {
        reentered = true;
        f.host.dispose();
      }
    });
    f.host.dispose();
    expect(observed).toEqual([{ disposed: true, generation: 18 }]);
    expect(f.removeEventListener.mock.calls).toEqual([
      ['keydown', f.host.reviewKeyboard],
      ['blur', f.host.suspendOnBlur],
      ['pagehide', f.host.pageHide],
      ['pageshow', f.host.pageShow],
    ]);
    for (const name of stages) expect(f.release[name], name).toHaveBeenCalledTimes(1);
    expect(f.audio).toHaveBeenCalledTimes(1);
    expect(f.replay).toHaveBeenCalledTimes(1);
  });

  it('resets the actual haptic owner even after the input pad has disappeared', () => {
    const f = fixture(),
      rumble = new Rumble();
    const reset = vi.fn(async () => 'complete');
    const actuator = {
      playEffect: vi.fn(async () => 'complete'),
      reset,
    } as unknown as GamepadHapticActuator;
    rumble.update({ vibrationActuator: actuator }, { weak: 0.6, strong: 0.2 }, 1000);
    f.host.rumble = rumble;
    try {
      f.host.dispose();
      expect(reset).toHaveBeenCalledTimes(1);
      f.host.dispose();
      expect(reset).toHaveBeenCalledTimes(1);
    } finally {
      rumble.stop(null);
    }
  });

  it('retains an undefined first synchronous failure after later cleanup errors', () => {
    const f = fixture();
    f.release.video.mockImplementation(() => {
      throw undefined;
    });
    f.release.renderer.mockImplementation(() => {
      throw new Error('later renderer failure');
    });
    let caught = false;
    try {
      f.host.dispose();
    } catch (error) {
      caught = true;
      expect(error).toBeUndefined();
    }
    expect(caught).toBe(true);
    for (const name of stages) expect(f.release[name], name).toHaveBeenCalledTimes(1);
    expect(f.audio).toHaveBeenCalledTimes(1);
  });

  it('observes asynchronous replay and audio failures without interrupting other owners', async () => {
    const f = fixture(),
      replayError = new Error('replay cache close failed'),
      audioError = new Error('audio close failed');
    f.replay.mockRejectedValue(replayError);
    f.audio.mockRejectedValue(audioError);
    expect(() => f.host.dispose()).not.toThrow();
    await Promise.resolve();
    expect(f.warn.mock.calls).toEqual([
      ['Replay cleanup:', replayError],
      ['Audio cleanup:', audioError],
    ]);
    for (const name of stages) expect(f.release[name], name).toHaveBeenCalledTimes(1);
    f.host.dispose();
    expect(f.replay).toHaveBeenCalledTimes(1);
    expect(f.audio).toHaveBeenCalledTimes(1);
  });

  it('does not revisit any callback after terminal ownership was already revoked', () => {
    const f = fixture();
    f.host.disposed = true;
    f.host.dispose();
    expect(f.order).toEqual([]);
    expect(f.host.generation).toBe(17);
    expect(f.audio).not.toHaveBeenCalled();
    expect(f.replay).not.toHaveBeenCalled();
  });
});

describe('Festival teardown through the owning session and renderer', () => {
  it('releases the HUD and frame references after cancellation encounters a renderer failure', async () => {
    const f = sessionFixture(),
      failure = new Error('Festival render cleanup failed');
    const owner = await adopt(f.session);
    f.release.renderer.mockImplementation(() => {
      throw failure;
    });
    expect(() => owner.cancel()).toThrow(failure);
    expect(owner.session).toBeNull();
    expectSessionReleased(f);
    expect(() => owner.cancel()).not.toThrow();
    f.session.dispose();
    expectSessionReleased(f);
  });

  it('revokes nullable session owners before a control callback reenters disposal', () => {
    const f = sessionFixture();
    f.release.controls.mockImplementation(() => {
      for (const name of [
        'controls',
        'traffic',
        'riders',
        'renderer',
        'hud',
        'current',
        'previous',
        'status',
      ])
        expect(f.session[name], name).toBeNull();
      f.session.dispose();
    });
    f.session.dispose();
    expectSessionReleased(f);
  });

  it('retains an undefined early session failure while still terminating both workers and releasing the HUD', () => {
    const f = sessionFixture();
    f.release.controls.mockImplementation(() => {
      throw undefined;
    });
    f.release.worker.mockImplementation(() => {
      throw new Error('later worker refusal');
    });
    let caught = false;
    try {
      f.session.dispose();
    } catch (error) {
      caught = true;
      expect(error).toBeUndefined();
    }
    expect(caught).toBe(true);
    expectSessionReleased(f);
  });

  it('attempts cars, postprocessing, effect resources and scene release after a reflection error', () => {
    const f = rendererFixture(),
      failure = new Error('reflection target cleanup failed');
    f.release.reflection.mockImplementation(() => {
      throw failure;
    });
    expect(() => f.renderer.dispose()).toThrow(failure);
    expectRendererReleased(f);
    expect(() => f.renderer.dispose()).not.toThrow();
    expectRendererReleased(f);
  });

  it('contains actual Three geometry/material disposal event failures without skipping later resources', () => {
    const f = rendererFixture();
    f.meshes[0].geometry.addEventListener('dispose', () => {
      throw undefined;
    });
    f.materials[1].addEventListener('dispose', () => {
      throw new Error('later material failure');
    });
    let caught = false;
    try {
      f.renderer.dispose();
    } catch (error) {
      caught = true;
      expect(error).toBeUndefined();
    }
    expect(caught).toBe(true);
    expectRendererReleased(f);
  });

  it('revokes nullable renderer owners before their callbacks and keeps reentrant disposal inert', () => {
    const f = rendererFixture();
    f.release.details.mockImplementation(() => {
      for (const name of ['details', 'streetDetails', 'photoVegetation'])
        expect(f.renderer[name], name).toBeNull();
      f.renderer.dispose();
    });
    f.renderer.dispose();
    expectRendererReleased(f);
  });

  it('finishes the host, session and Festival renderer after the deepest owner reports a failure', async () => {
    const host = fixture(),
      session = sessionFixture(),
      renderer = rendererFixture();
    const failure = new Error('owned reflection cleanup failed');
    renderer.release.reflection.mockImplementation(() => {
      throw failure;
    });
    session.release.renderer.mockImplementation(() => renderer.renderer.dispose());
    const owner = await adopt(session.session);
    host.host.festivalOwner = owner;
    expect(() => host.host.dispose()).toThrow(failure);
    expect(owner.session).toBeNull();
    expectSessionReleased(session);
    expectRendererReleased(renderer);
    expect(host.audio).toHaveBeenCalledTimes(1);
    expect(host.release.ui).toHaveBeenCalledTimes(1);
    expect(host.release.worker).toHaveBeenCalledTimes(1);
    expect(host.release.rumble).toHaveBeenCalledTimes(1);
  });
});
