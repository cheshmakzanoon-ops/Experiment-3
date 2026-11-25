import { readFileSync } from 'node:fs';
import ts from 'typescript';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { SessionStartOwner } from '../src/session/session-start-owner.ts';
import { type SessionOptions, DEFAULT_OPTIONS } from '../src/simulation/config.ts';
import { TelemetryExport } from '../src/storage/telemetry-export.ts';
import { TelemetryRecorder } from '../src/storage/recorders.ts';

interface ExportRequest {
  id: number;
  values: Float32Array;
  count: number;
}
class CsvWorker {
  static workers: CsvWorker[] = [];
  onmessage: ((event: MessageEvent<unknown>) => void) | null = null;
  onerror: ((event: ErrorEvent) => void) | null = null;
  onmessageerror: (() => void) | null = null;
  request!: ExportRequest;
  terminate = vi.fn();
  constructor() {
    CsvWorker.workers.push(this);
  }
  postMessage(request: ExportRequest, transfer: Transferable[]) {
    this.request = structuredClone(request, { transfer });
  }
  complete() {
    this.onmessage?.({
      data: { id: this.request.id, blob: new Blob(['csv'], { type: 'text/csv' }) },
    } as MessageEvent<unknown>);
  }
}

// Run the complete production host methods, with only the lazy Festival module
// import replaced by a controllable loader. Real export and session owners keep
// the cancellation/settlement order; the application does not boot a renderer.
const source = ts.createSourceFile(
  'main.ts',
  readFileSync(new URL('../src/main.ts', import.meta.url), 'utf8'),
  ts.ScriptTarget.Latest,
  true,
);
const owner = source.statements.find(
  (node): node is ts.ClassDeclaration =>
    ts.isClassDeclaration(node) && node.name?.text === 'GameApp',
)!;
const members = ['exportTelemetry', 'fail', 'startFestival', 'festival', 'festivalStarting'].map(
  (name) => {
    const member = owner.members.find((node) => node.name?.getText(source) === name);
    if (!member) throw new Error(`Missing GameApp.${name}`);
    return member.getText(source);
  },
);
const hostCode = ts.transpileModule(`class Host { ${members.join('\n')} }`, {
  compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.None },
  transformers: {
    before: [
      (context) => (node) => {
        const visit: ts.Visitor = (child) => {
          if (
            ts.isCallExpression(child) &&
            child.expression.kind === ts.SyntaxKind.ImportKeyword &&
            ts.isStringLiteral(child.arguments[0]) &&
            child.arguments[0].text === './session/free-roam.ts'
          )
            return ts.factory.createCallExpression(
              ts.factory.createIdentifier('loadFestivalModule'),
              undefined,
              [],
            );
          return ts.visitEachChild(child, visit, context);
        };
        return ts.visitNode(node, visit) as ts.SourceFile;
      },
    ],
  },
}).outputText;

interface Host {
  exportTelemetry(): Promise<void>;
  fail(error: unknown): void;
  startFestival(options: SessionOptions): Promise<void>;
  generation: number;
  disposed: boolean;
  errorStopped: boolean;
  exporting: boolean;
  telemetry: TelemetryRecorder | null;
  exporter: TelemetryExport;
  festivalOwner: SessionStartOwner<{ dispose(): void }>;
  readonly festivalStarting: boolean;
}
const cleanups: (() => void)[] = [];
function fixture(locked: string | null = null) {
  const button = { disabled: false, textContent: 'EXPORT CSV' };
  const download = vi.fn(),
    toast = vi.fn(),
    error = vi.fn(),
    physicsTerminate = vi.fn();
  let resolveModule!: (value: unknown) => void;
  const module = new Promise((resolve) => (resolveModule = resolve));
  const load = vi.fn(() => module);
  const dependencies = {
    document: { querySelector: () => button },
    downloadBlob: download,
    loadFestivalModule: load,
    demoSessionLock: () => locked,
    crypto: { randomUUID: () => 'session-id' },
    resolveLighting: () => 'day',
    t: (text: string) => text,
    console: { error: vi.fn() },
  };
  const Prototype = new Function(...Object.keys(dependencies), `${hostCode}; return Host;`)(
    ...Object.values(dependencies),
  ) as new () => Host;
  const host = Object.assign(new Prototype(), {
    generation: 7,
    disposed: false,
    errorStopped: false,
    state: 'menu',
    exporting: false,
    telemetry: new TelemetryRecorder(1),
    exporter: new TelemetryExport(),
    festivalOwner: new SessionStartOwner<{ dispose(): void }>(),
    renderer: {},
    canvas: {},
    applyLight: vi.fn(),
    career: { beginFestival: vi.fn() },
    circuitStartup: null,
    worker: { terminate: physicsTerminate },
    initTimeout: 0,
    referenceSession: { interrupt: vi.fn() },
    sessionReview: { stop: vi.fn() },
    tabEvidence: { observe: vi.fn() },
    performanceCapture: { interrupt: vi.fn() },
    interruptReview: vi.fn(),
    endDemoClock: vi.fn(),
    input: { setEnabled: vi.fn() },
    rumble: { stop: vi.fn() },
    audio: { stop: vi.fn() },
    ui: { toast, error, showMode: vi.fn(), loading: vi.fn(), loadingScene: vi.fn() },
  });
  cleanups.push(() => {
    host.exporter.cancel();
    host.festivalOwner.cancel();
    resolveModule(undefined);
  });
  return { host, button, download, toast, error, physicsTerminate, load, resolveModule };
}

beforeEach(() => {
  vi.useFakeTimers();
  vi.stubGlobal('Worker', CsvWorker);
});
afterEach(() => {
  for (const cleanup of cleanups.splice(0)) cleanup();
  CsvWorker.workers.length = 0;
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

describe('host telemetry export ownership', () => {
  it('downloads one current export and restores its button after worker settlement', async () => {
    const f = fixture();
    const pending = f.host.exportTelemetry();
    expect(f.button).toEqual({ disabled: true, textContent: 'EXPORTING…' });
    CsvWorker.workers[0].complete();
    await pending;
    expect(f.download).toHaveBeenCalledExactlyOnceWith(expect.any(Blob), 'motobound-telemetry.csv');
    expect(CsvWorker.workers[0].terminate).toHaveBeenCalledOnce();
    expect(f.button).toEqual({ disabled: false, textContent: 'EXPORT CSV' });
    expect(f.host.exporting).toBe(false);
    expect(vi.getTimerCount()).toBe(0);
  });

  it.each(['pending', 'resolved'] as const)(
    'suppresses a %s export after the real terminal-failure handler runs',
    async (state) => {
      const f = fixture();
      const pending = f.host.exportTelemetry(),
        worker = CsvWorker.workers[0];
      if (state === 'resolved') worker.complete();
      f.host.fail(new Error('Physics failed'));
      expect(worker.terminate).toHaveBeenCalledOnce();
      worker.complete();
      await pending;
      expect(f.host.generation).toBe(7);
      expect(f.download).not.toHaveBeenCalled();
      expect(f.toast).not.toHaveBeenCalled();
      expect(f.error).toHaveBeenCalledExactlyOnceWith('Physics failed');
      expect(f.physicsTerminate).toHaveBeenCalledOnce();
      expect(vi.getTimerCount()).toBe(0);
    },
  );

  it.each(['pending', 'resolved'] as const)(
    'revokes a %s circuit export at actual Festival startup ownership',
    async (state) => {
      const f = fixture();
      const pending = f.host.exportTelemetry(),
        worker = CsvWorker.workers[0];
      if (state === 'resolved') worker.complete();
      const starting = f.host.startFestival({ ...DEFAULT_OPTIONS });
      expect(f.host.festivalStarting).toBe(true);
      expect(f.load).toHaveBeenCalledOnce();
      expect(worker.terminate).toHaveBeenCalledOnce();
      worker.complete();
      await pending;
      expect(f.host.generation).toBe(7);
      expect(f.download).not.toHaveBeenCalled();
      expect(f.toast).not.toHaveBeenCalled();
      f.host.festivalOwner.cancel();
      f.resolveModule(undefined);
      await starting;
      expect(vi.getTimerCount()).toBe(0);
    },
  );

  it('retains the current export when a locked Festival request never takes ownership', async () => {
    const f = fixture('Locked');
    const pending = f.host.exportTelemetry();
    await f.host.startFestival({ ...DEFAULT_OPTIONS });
    expect(f.host.festivalStarting).toBe(false);
    expect(f.load).not.toHaveBeenCalled();
    expect(CsvWorker.workers[0].terminate).not.toHaveBeenCalled();
    CsvWorker.workers[0].complete();
    await pending;
    expect(f.download).toHaveBeenCalledOnce();
  });

  it.each(['disposed', 'errorStopped'] as const)(
    'does not start another export after the host becomes %s',
    async (state) => {
      const f = fixture();
      f.host[state] = true;
      await f.host.exportTelemetry();
      expect(CsvWorker.workers).toHaveLength(0);
      expect(f.download).not.toHaveBeenCalled();
      expect(f.host.exporting).toBe(false);
    },
  );

  it('preserves the originating fatal error even if export cancellation fails', async () => {
    const f = fixture();
    const pending = f.host.exportTelemetry();
    const cancel = vi.spyOn(f.host.exporter, 'cancel').mockImplementation(() => {
      throw new Error('Export cleanup failed');
    });
    expect(() => f.host.fail(new Error('Original physics failure'))).not.toThrow();
    expect(f.error).toHaveBeenCalledExactlyOnceWith('Original physics failure');
    expect(f.physicsTerminate).toHaveBeenCalledOnce();
    CsvWorker.workers[0].complete();
    await pending;
    expect(f.download).not.toHaveBeenCalled();
    expect(f.toast).not.toHaveBeenCalled();
    cancel.mockRestore();
  });
});
