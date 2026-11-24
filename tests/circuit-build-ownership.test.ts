import { readFileSync } from 'node:fs';
import ts from 'typescript';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { WorkerReadiness } from '../src/session/worker-readiness.ts';

/** Execute the complete production methods without main.ts's automatic boot or
 * importing authored scenes. Only renderer creation, UI and RAF are boundaries;
 * generation checks and publication decisions are never copied into this test. */
function selectedClass(path: string, name: string, members: string[]) {
  const source = ts.createSourceFile(
    path,
    readFileSync(new URL(path, import.meta.url), 'utf8'),
    ts.ScriptTarget.Latest,
    true,
  );
  const owner = source.statements.find(
    (node): node is ts.ClassDeclaration => ts.isClassDeclaration(node) && node.name?.text === name,
  );
  if (!owner) throw new Error('Missing source owner ' + name);
  const body = members.map((name) => {
    const member = owner.members.find((node) =>
      name === 'constructor'
        ? ts.isConstructorDeclaration(node)
        : node.name?.getText(source) === name,
    );
    if (!member) throw new Error('Missing source member ' + name);
    return member.getText(source);
  });
  return ts.transpileModule('class Owner { ' + body.join('\n') + ' }', {
    compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.None },
  }).outputText;
}

const appCode = selectedClass('../src/main.ts', 'GameApp', ['buildRenderer', 'switchCircuit']);
const transferCode = selectedClass('../src/rendering/renderer.ts', 'CarTemplateTransfer', [
  'constructor',
  'take',
  'dispose',
]);

interface Resource {
  dispose(): void;
}
interface Assets {
  shells: Resource;
  rivals: Resource[];
  driver: Resource;
}
interface Transfer {
  take(): Assets | null;
  dispose(): void;
}
const Transfer = new Function(transferCode + '; return Owner;')() as new (
  assets: Assets,
) => Transfer;

interface Circuit {
  id: string;
  name: string;
  offroad?: { kind: string };
}
interface TestTrack {
  circuit: Circuit;
}
interface Renderer {
  name: string;
  showroomWindow?: object;
  colorblind?: boolean;
  lighting?: string;
  canPrepareGrid(gpGrid: boolean): boolean;
  setLivery(livery: object): void;
  releaseCarTemplates(): Transfer;
  dispose(): void;
}
interface App {
  disposed: boolean;
  errorStopped: boolean;
  generation: number;
  rendererBuild: number;
  renderer: Renderer | null;
  track: TestTrack;
  canvas: HTMLCanvasElement | null;
  resetMenuPresentation(): void;
  applyMotion(renderer: Renderer, settings: object): void;
  showroomWindow: object;
  settings: {
    quality: string;
    graphics: object;
    colorblind: boolean;
    drivingAudio: object;
  };
  team: { livery: object };
  liveSky: { active: boolean; start(observer: object): void; update(): string | null };
  audio: { configureDriving(track: TestTrack, settings: object): void };
  ui: { loading(message: string): void; setTrack(track: TestTrack): void };
  buildRenderer(
    canvas: HTMLCanvasElement,
    showroomOnly?: boolean,
    gpGrid?: boolean,
    templates?: Transfer,
  ): Promise<boolean>;
  switchCircuit(id: string, gpGrid?: boolean): Promise<boolean>;
}
interface Creation {
  canvas: HTMLCanvasElement;
  track: TestTrack;
  progress(value: { fraction: number; label: string }): void;
  cancelled(): boolean;
  initial: {
    quality: string;
    graphics: object;
    gpGrid: boolean;
    carTemplates?: Transfer;
  };
  showroomOnly: boolean;
  resolve(renderer: Renderer | null): void;
  reject(error: unknown): void;
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<T>((yes, no) => {
    resolve = yes;
    reject = no;
  });
  return { promise, resolve, reject };
}

function renderer(name: string, assets?: Assets) {
  let owned = assets;
  return {
    name,
    canPrepareGrid: vi.fn(() => true),
    setLivery: vi.fn(),
    releaseCarTemplates: vi.fn(() => {
      const transfer = new Transfer(owned!);
      owned = undefined;
      return transfer;
    }),
    dispose: vi.fn(() => {
      const releasing = owned;
      owned = undefined;
      releasing?.shells.dispose();
      releasing?.rivals.forEach((rival) => rival.dispose());
      releasing?.driver.dispose();
    }),
  };
}

function assets(): Assets {
  return {
    shells: { dispose: vi.fn() },
    rivals: [{ dispose: vi.fn() }, { dispose: vi.fn() }],
    driver: { dispose: vi.fn() },
  };
}

function fixture() {
  const frames: FrameRequestCallback[] = [];
  vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => {
    frames.push(callback);
    return frames.length;
  });
  const circuits: Circuit[] = [
    { id: 'aurel', name: 'Aurel' },
    { id: 'vellamar', name: 'Vellamar' },
    { id: 'valley-ridge-mx', name: 'Valley Ridge', offroad: { kind: 'motocross' } },
  ];
  const builtTracks: TestTrack[] = [];
  class Track implements TestTrack {
    constructor(
      _weather: string,
      _evolution: boolean,
      _seed: unknown,
      readonly circuit: Circuit,
    ) {
      builtTracks.push(this);
    }
  }
  const creations: Creation[] = [];
  const create = vi.fn(
    (
      canvas: HTMLCanvasElement,
      track: TestTrack,
      progress: Creation['progress'],
      cancelled: Creation['cancelled'],
      initial: Creation['initial'],
      showroomOnly: boolean,
    ) => {
      const work = deferred<Renderer | null>();
      creations.push({ canvas, track, progress, cancelled, initial, showroomOnly, ...work });
      return work.promise;
    },
  );
  const dependencies = {
    RacingRenderer: { create },
    Track,
    circuitDefinition: (id: string) => {
      const circuit = circuits.find((entry) => entry.id === id);
      if (!circuit) throw new Error('Unknown fixture circuit ' + id);
      return circuit;
    },
    liveSkyPreferred: () => false,
    storedObserver: () => ({}),
  };
  const prototype = new Function(
    ...Object.keys(dependencies),
    appCode + '; return Owner.prototype;',
  )(...Object.values(dependencies)) as object;
  const original = renderer('original');
  const app: App = Object.assign(Object.create(prototype), {
    disposed: false,
    errorStopped: false,
    generation: 1,
    rendererBuild: 0,
    renderer: original,
    track: { circuit: circuits[0] },
    canvas: {} as HTMLCanvasElement,
    resetMenuPresentation: vi.fn(),
    applyMotion: vi.fn(),
    showroomWindow: {},
    settings: { quality: 'medium', graphics: {}, colorblind: true, drivingAudio: {} },
    team: { livery: {} },
    liveSky: { active: false, start: vi.fn(), update: vi.fn(() => null) },
    audio: { configureDriving: vi.fn() },
    ui: { loading: vi.fn(), setTrack: vi.fn() },
  });
  const frame = async (index = 0) => {
    frames[index](0);
    await Promise.resolve();
  };
  return { app, original, frames, frame, create, creations, builtTracks, circuits };
}

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe('circuit renderer publication ownership', () => {
  it('publishes a current boot renderer with the original arguments and configuration', async () => {
    const f = fixture();
    const work = f.app.buildRenderer(f.app.canvas!, true, false);
    const call = f.creations[0];
    expect(call.track).toBe(f.app.track);
    expect(call.initial).toEqual({
      quality: f.app.settings.quality,
      graphics: f.app.settings.graphics,
      gpGrid: false,
      carTemplates: undefined,
    });
    expect(call.showroomOnly).toBe(true);
    expect(call.cancelled()).toBe(false);
    call.progress({ fraction: 0.25, label: 'Current work' });
    expect(f.app.ui.loading).toHaveBeenLastCalledWith('25% · Current work…');
    const next = renderer('current');
    call.resolve(next);
    expect(await work).toBe(true);
    expect(f.app.renderer).toBe(next);
    expect(f.app.applyMotion).toHaveBeenCalledExactlyOnceWith(next, f.app.settings);
    expect(next.setLivery).toHaveBeenCalledExactlyOnceWith(f.app.team.livery);
    expect(f.app.audio.configureDriving).toHaveBeenCalledExactlyOnceWith(
      f.app.track,
      f.app.settings.drivingAudio,
    );
    expect(f.app.ui.setTrack).toHaveBeenCalledExactlyOnceWith(f.app.track);
    expect(next.dispose).not.toHaveBeenCalled();
  });

  it.each(['generation', 'disposed', 'errorStopped'] as const)(
    'retires a late candidate and progress after %s revokes its owner',
    async (reason) => {
      const f = fixture();
      const work = f.app.buildRenderer(f.app.canvas!);
      const call = f.creations[0];
      const active = renderer('replacement');
      if (reason === 'generation') f.app.generation++;
      else f.app[reason] = true;
      f.app.renderer = active;
      const loading = vi.mocked(f.app.ui.loading).mock.calls.length;
      call.progress({ fraction: 0.9, label: 'Obsolete work' });
      const late = renderer('late');
      call.resolve(late);
      expect(await work).toBe(false);
      expect(call.cancelled()).toBe(true);
      expect(f.app.ui.loading).toHaveBeenCalledTimes(loading);
      expect(f.app.renderer).toBe(active);
      expect(late.dispose).toHaveBeenCalledTimes(1);
      expect(active.dispose).not.toHaveBeenCalled();
      expect(f.app.applyMotion).not.toHaveBeenCalled();
      expect(f.app.audio.configureDriving).not.toHaveBeenCalled();
      expect(f.app.ui.setTrack).not.toHaveBeenCalled();
    },
  );

  it.each([true, false])(
    'a same-generation replacement survives an older completion (candidate=%s)',
    async (hasCandidate) => {
      const f = fixture();
      const first = f.app.buildRenderer(f.app.canvas!);
      const firstCall = f.creations[0];
      const nextTrack = { circuit: f.circuits[1] };
      f.app.track = nextTrack;
      const second = f.app.buildRenderer(f.app.canvas!);
      const secondCall = f.creations[1];
      const active = renderer('active');
      secondCall.resolve(active);
      expect(await second).toBe(true);
      const late = renderer('late');
      firstCall.resolve(hasCandidate ? late : null);
      expect(await first).toBe(false);
      expect(firstCall.cancelled()).toBe(true);
      expect(f.app.renderer).toBe(active);
      expect(late.dispose).toHaveBeenCalledTimes(hasCandidate ? 1 : 0);
      expect(f.app.audio.configureDriving).toHaveBeenCalledExactlyOnceWith(
        nextTrack,
        f.app.settings.drivingAudio,
      );
      expect(f.app.ui.setTrack).toHaveBeenCalledExactlyOnceWith(nextTrack);
      expect(active.dispose).not.toHaveBeenCalled();
    },
  );

  it('consumes a stale factory rejection without failing the replacement', async () => {
    const f = fixture();
    const first = f.app.buildRenderer(f.app.canvas!);
    f.app.generation++;
    const active = renderer('active');
    f.app.renderer = active;
    f.creations[0].reject(new Error('Old loader failed'));
    await expect(first).resolves.toBe(false);
    expect(f.app.renderer).toBe(active);
    expect(active.dispose).not.toHaveBeenCalled();
  });

  it.each([new Error('Current loader failed'), undefined, 0])(
    'preserves the original current factory failure %s',
    async (failure) => {
      const f = fixture();
      const work = f.app.buildRenderer(f.app.canvas!);
      f.creations[0].reject(failure);
      await expect(work).rejects.toBe(failure);
      expect(f.app.renderer).toBe(f.original);
      expect(f.app.audio.configureDriving).not.toHaveBeenCalled();
    },
  );

  it('reports a late-candidate cleanup failure without reviving its abandoned call', async () => {
    const warning = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const f = fixture();
    const work = f.app.buildRenderer(f.app.canvas!);
    const late = renderer('late');
    const cleanup = new Error('Late renderer cleanup failed');
    late.dispose.mockImplementation(() => {
      throw cleanup;
    });
    f.app.generation++;
    f.creations[0].resolve(late);
    await expect(work).resolves.toBe(false);
    expect(late.dispose).toHaveBeenCalledTimes(1);
    expect(f.app.renderer).toBe(f.original);
    expect(warning.mock.calls.flat()).toContain(cleanup);
  });

  it.each(['disposed', 'errorStopped'] as const)(
    'does not start another build after %s',
    async (reason) => {
      const f = fixture();
      f.app[reason] = true;
      const work = f.app.buildRenderer(f.app.canvas!);
      f.creations[0]?.resolve(null);
      expect(await work).toBe(false);
      expect(f.create).not.toHaveBeenCalled();
      expect(f.app.resetMenuPresentation).not.toHaveBeenCalled();
    },
  );
});

describe('circuit switch waits and transferred resource ownership', () => {
  it.each(['generation', 'disposed', 'errorStopped'] as const)(
    'does not retire the current renderer after an obsolete RAF resumes (%s)',
    async (reason) => {
      const f = fixture();
      const work = f.app.switchCircuit('vellamar');
      const current = renderer('current');
      const currentTrack = { circuit: f.circuits[2] };
      if (reason === 'generation') f.app.generation++;
      else f.app[reason] = true;
      f.app.renderer = current;
      f.app.track = currentTrack;
      await f.frame();
      f.creations[0]?.resolve(null);
      expect(await work).toBe(false);
      expect(f.app.renderer).toBe(current);
      expect(f.app.track).toBe(currentTrack);
      expect(current.dispose).not.toHaveBeenCalled();
      expect(current.releaseCarTemplates).not.toHaveBeenCalled();
      expect(f.builtTracks).toEqual([]);
      expect(f.create).not.toHaveBeenCalled();
    },
  );

  it('lets a newer same-generation switch win even when RAF callbacks arrive out of order', async () => {
    const f = fixture();
    const first = f.app.switchCircuit('vellamar');
    const second = f.app.switchCircuit('valley-ridge-mx');
    await f.frame(1);
    const active = renderer('active');
    f.creations[0].resolve(active);
    expect(await second).toBe(true);
    const activeTrack = f.app.track;
    await f.frame(0);
    f.creations[1]?.resolve(null);
    expect(await first).toBe(false);
    expect(f.app.renderer).toBe(active);
    expect(f.app.track).toBe(activeTrack);
    expect(activeTrack.circuit.id).toBe('valley-ridge-mx');
    expect(f.create).toHaveBeenCalledTimes(1);
    expect(f.original.dispose).toHaveBeenCalledTimes(1);
    expect(active.dispose).not.toHaveBeenCalled();
  });

  it('invalidates an older switch when the latest request reuses the existing renderer', async () => {
    const f = fixture();
    const pending = f.app.switchCircuit('vellamar');
    expect(await f.app.switchCircuit('aurel')).toBe(true);
    await f.frame();
    f.creations[0]?.resolve(null);
    expect(await pending).toBe(false);
    expect(f.app.renderer).toBe(f.original);
    expect(f.original.dispose).not.toHaveBeenCalled();
    expect(f.create).not.toHaveBeenCalled();
    expect(f.app.track.circuit.id).toBe('aurel');
  });

  it('rechecks ownership after old-renderer disposal callbacks replace the session', async () => {
    const f = fixture();
    const replacement = renderer('callback replacement');
    const replacementTrack = { circuit: f.circuits[2] };
    f.original.dispose.mockImplementation(() => {
      f.app.generation++;
      f.app.renderer = replacement;
      f.app.track = replacementTrack;
    });
    const work = f.app.switchCircuit('vellamar');
    await f.frame();
    f.creations[0]?.resolve(null);
    expect(await work).toBe(false);
    expect(f.app.renderer).toBe(replacement);
    expect(f.app.track).toBe(replacementTrack);
    expect(f.builtTracks).toEqual([]);
    expect(f.create).not.toHaveBeenCalled();
  });

  it('settles the real startup lifetime while the old RAF remains unable to mutate its successor', async () => {
    const f = fixture();
    const gate = new WorkerReadiness(f.app.generation);
    const underlying = f.app.switchCircuit('vellamar');
    const waiting = gate.lifetime.wait(underlying);
    const stopped = new Error('Replaced circuit startup');
    const rejected = expect(waiting).rejects.toBe(stopped);
    f.app.generation++;
    gate.close(stopped);
    await rejected;
    const replacement = renderer('replacement');
    f.app.renderer = replacement;
    await f.frame();
    f.creations[0]?.resolve(null);
    expect(await underlying).toBe(false);
    expect(f.app.renderer).toBe(replacement);
    expect(replacement.dispose).not.toHaveBeenCalled();
    expect(f.create).not.toHaveBeenCalled();
  });

  it.each([false, true])(
    'releases only its own templates after a cancelled build (adopted=%s)',
    async (adopted) => {
      const f = fixture();
      const retained = assets();
      f.app.renderer = renderer('old with templates', retained);
      const work = f.app.switchCircuit('valley-ridge-mx');
      await f.frame();
      const call = f.creations[0];
      const transfer = call.initial.carTemplates!;
      const late = renderer('late', adopted ? transfer.take()! : undefined);
      const replacementAssets = assets();
      const replacement = renderer('replacement', replacementAssets);
      f.app.generation++;
      f.app.renderer = replacement;
      call.resolve(adopted ? late : null);
      expect(await work).toBe(false);
      expect(f.app.renderer).toBe(replacement);
      for (const resource of [retained.shells, ...retained.rivals, retained.driver])
        expect(resource.dispose).toHaveBeenCalledTimes(1);
      for (const resource of [
        replacementAssets.shells,
        ...replacementAssets.rivals,
        replacementAssets.driver,
      ])
        expect(resource.dispose).not.toHaveBeenCalled();
      expect(transfer.take()).toBeNull();
      expect(late.dispose).toHaveBeenCalledTimes(adopted ? 1 : 0);
    },
  );

  it('retains transferred templates in the accepted candidate and releases them on its disposal', async () => {
    const f = fixture();
    const retained = assets();
    const previous = renderer('old with templates', retained);
    f.app.renderer = previous;
    const work = f.app.switchCircuit('valley-ridge-mx', true);
    await f.frame();
    const call = f.creations[0];
    const transfer = call.initial.carTemplates!;
    const accepted = renderer('accepted', transfer.take()!);
    call.resolve(accepted);
    expect(await work).toBe(true);
    expect(f.app.renderer).toBe(accepted);
    expect(call.initial.gpGrid).toBe(true);
    expect(call.showroomOnly).toBe(false);
    expect(previous.releaseCarTemplates).toHaveBeenCalledTimes(1);
    expect(previous.dispose).toHaveBeenCalledTimes(1);
    for (const resource of [retained.shells, ...retained.rivals, retained.driver])
      expect(resource.dispose).not.toHaveBeenCalled();
    accepted.dispose();
    for (const resource of [retained.shells, ...retained.rivals, retained.driver])
      expect(resource.dispose).toHaveBeenCalledTimes(1);
  });
});
