import { EventEmitter } from 'node:events';
import { PassThrough } from 'node:stream';
import { performance } from 'node:perf_hooks';
import { spawn, execFileSync, type ChildProcess } from 'node:child_process';
import { constants } from 'node:fs';
import {
  chmod,
  copyFile,
  lstat,
  mkdtemp,
  open,
  readFile,
  readdir,
  rename,
  rm,
  stat,
  symlink,
  truncate,
  writeFile,
} from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import {
  OfflineGpuStructureError,
  runBoundedStructuralProcessor,
  summarizeOfflineGpuStructure,
} from '../scripts/offline-gpu-structure-runner.mjs';
import {
  OFFLINE_GPU_STRUCTURE_LIMITS as limits,
  OFFLINE_GPU_STRUCTURE_QUERY,
  decodeOfflineGpuStructureRows,
} from '../scripts/offline-gpu-structure-prototype.mjs';
import { structuralTraceFixture, STRUCTURE_PRIVATE } from './fixtures/offline-gpu-structure-trace';

vi.mock('node:child_process', async (original) => {
  const actual = await original<typeof import('node:child_process')>();
  return { ...actual, spawn: vi.fn(actual.spawn) };
});
vi.mock('node:fs/promises', async (original) => {
  const actual = await original<typeof import('node:fs/promises')>();
  return {
    ...actual,
    open: vi.fn(actual.open),
    chmod: vi.fn(actual.chmod),
    rm: vi.fn(actual.rm),
    lstat: vi.fn(actual.lstat),
  };
});
vi.mock('../scripts/offline-gpu-structure-prototype.mjs', async (original) => {
  const actual = await original<typeof import('../scripts/offline-gpu-structure-prototype.mjs')>();
  return { ...actual, decodeOfflineGpuStructureRows: vi.fn(actual.decodeOfflineGpuStructureRows) };
});
const actualProcess =
  await vi.importActual<typeof import('node:child_process')>('node:child_process');
const actualFiles = await vi.importActual<typeof import('node:fs/promises')>('node:fs/promises');
const actualStructure = await vi.importActual<
  typeof import('../scripts/offline-gpu-structure-prototype.mjs')
>('../scripts/offline-gpu-structure-prototype.mjs');
const validCsv = [
  'row_id,process_count,event_count,completed_count,unfinished_count,ancestor_count,joint_open_count',
  '0,1,2,1,1,2,1',
  '1,1,1,1,0,1,0',
  '2,1,1,0,1,1,1',
  '3,0,0,0,0,0,0',
  '4,1,1,0,1,0,0',
  '5,1,1,0,1,1,1',
  '6,165,0,0,0,0,0',
  '7,48,0,0,0,0,0',
].join('\n');

class FakeChild extends EventEmitter {
  stdout = new PassThrough();
  stderr = new PassThrough();
  kill = vi.fn(() => true);
}
const childProcess = (child: FakeChild) => child as unknown as ChildProcess;
const fakeQuery = (child: FakeChild, options: Record<string, unknown> = {}) => {
  const launch = vi.fn(() => childProcess(child));
  const result = runBoundedStructuralProcessor({
    path: '/private/synthetic-input',
    parserPath: '/private/verified-parser',
    deadlineAt: performance.now() + limits.processingMs,
    spawnProcess: launch,
    ...options,
  });
  return { result, launch };
};
afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
  vi.mocked(spawn).mockReset().mockImplementation(actualProcess.spawn);
  vi.mocked(open).mockReset().mockImplementation(actualFiles.open);
  vi.mocked(chmod).mockReset().mockImplementation(actualFiles.chmod);
  vi.mocked(lstat).mockReset().mockImplementation(actualFiles.lstat);
  vi.mocked(rm).mockReset().mockImplementation(actualFiles.rm);
  vi.mocked(decodeOfflineGpuStructureRows)
    .mockReset()
    .mockImplementation(actualStructure.decodeOfflineGpuStructureRows);
});

describe('offline single-pass child lifetime and output bounds', () => {
  it('executes exactly one fixed query without a shell or version/fallback call', async () => {
    const child = new FakeChild();
    const { result, launch } = fakeQuery(child);
    child.stdout.write(Buffer.from('fixed numeric output'));
    child.stderr.write(Buffer.from(STRUCTURE_PRIVATE));
    child.emit('close', 0);
    expect(await result).toBe('fixed numeric output');
    expect(launch).toHaveBeenCalledExactlyOnceWith(
      '/private/verified-parser',
      ['-Q', OFFLINE_GPU_STRUCTURE_QUERY, '/private/synthetic-input'],
      { shell: false, stdio: ['ignore', 'pipe', 'pipe'] },
    );
  });
  it('accepts exact stdout/stderr byte ceilings', async () => {
    const child = new FakeChild();
    const { result } = fakeQuery(child);
    child.stdout.write(Buffer.alloc(limits.maxStdoutBytes, 32));
    child.stderr.write(Buffer.alloc(limits.maxStderrBytes, 33));
    child.emit('close', 0);
    expect(Buffer.byteLength(await result)).toBe(limits.maxStdoutBytes);
    expect(child.kill).not.toHaveBeenCalled();
  });
  it.each(['stdout', 'stderr'] as const)(
    'rejects one excess %s byte and waits for close',
    async (pipe) => {
      const child = new FakeChild();
      const { result } = fakeQuery(child);
      const observed = result.catch((error: unknown) => error);
      let settled = false;
      void observed.then(() => (settled = true));
      const bound = pipe === 'stdout' ? limits.maxStdoutBytes : limits.maxStderrBytes;
      child[pipe].write(Buffer.alloc(bound + 1, 88));
      await Promise.resolve();
      expect(child.kill).toHaveBeenCalledWith('SIGKILL');
      expect(settled).toBe(false);
      child.emit('exit', 0);
      await Promise.resolve();
      expect(settled).toBe(false);
      child.emit('close', 0);
      expect(await observed).toMatchObject({ reason: 'parser-output-limit' });
    },
  );
  it('counts UTF-8 bytes, not characters', async () => {
    const child = new FakeChild();
    const { result } = fakeQuery(child);
    const observed = result.catch((error: unknown) => error);
    child.stdout.write(Buffer.from('é'.repeat(limits.maxStdoutBytes / 2) + 'x'));
    child.emit('close', 0);
    expect(await observed).toMatchObject({ reason: 'parser-output-limit' });
  });
  it.each(['stdout', 'stderr'] as const)(
    'handles %s pipe errors without exporting diagnostics',
    async (pipe) => {
      const child = new FakeChild();
      const { result } = fakeQuery(child);
      const observed = result.catch((error: unknown) => error);
      child[pipe].emit('error', new Error(STRUCTURE_PRIVATE));
      expect(child.kill).toHaveBeenCalledWith('SIGKILL');
      child.emit('close', 1);
      const error = await observed;
      expect(error).toMatchObject({ reason: 'parser-pipe-failed' });
      expect(String(error)).not.toContain(STRUCTURE_PRIVATE);
    },
  );
  it('does not settle on child error or exit before close', async () => {
    const child = new FakeChild();
    const { result } = fakeQuery(child);
    const observed = result.catch((error: unknown) => error);
    let settled = false;
    void observed.then(() => (settled = true));
    child.emit('error', new Error(STRUCTURE_PRIVATE));
    child.emit('exit', 1);
    await Promise.resolve();
    expect(settled).toBe(false);
    child.emit('close', 1);
    expect(await observed).toMatchObject({ reason: 'parser-launch-failed' });
  });
  it('kills at the shared deadline but cannot settle until close', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    const child = new FakeChild();
    const { result } = fakeQuery(child);
    const observed = result.catch((error: unknown) => error);
    let settled = false;
    void observed.then(() => (settled = true));
    await vi.advanceTimersByTimeAsync(limits.processingMs);
    expect(child.kill).toHaveBeenCalledWith('SIGKILL');
    expect(settled).toBe(false);
    child.emit('close', 0);
    expect(await observed).toMatchObject({ reason: 'processing-timeout' });
  });
  it('rejects late successful close even when the timer has not fired', async () => {
    let now = 100;
    vi.spyOn(performance, 'now').mockImplementation(() => now);
    const child = new FakeChild();
    const { result } = fakeQuery(child, { deadlineAt: now + 50 });
    const observed = result.catch((error: unknown) => error);
    now = 151;
    child.emit('close', 0);
    expect(await observed).toMatchObject({ reason: 'processing-timeout' });
  });
  it('never launches after budget expiration', async () => {
    const child = new FakeChild();
    const { result, launch } = fakeQuery(child, { deadlineAt: performance.now() - 1 });
    await expect(result).rejects.toMatchObject({ reason: 'processing-timeout' });
    expect(launch).not.toHaveBeenCalled();
  });
  it('parent abort waits for close even when kill itself throws', async () => {
    const controller = new AbortController();
    const child = new FakeChild();
    child.kill.mockImplementation(() => {
      throw new Error(STRUCTURE_PRIVATE);
    });
    const { result } = fakeQuery(child, { signal: controller.signal });
    const observed = result.catch((error: unknown) => error);
    let settled = false;
    void observed.then(() => (settled = true));
    controller.abort();
    await Promise.resolve();
    expect(settled).toBe(false);
    child.emit('close', 0);
    expect(await observed).toMatchObject({ reason: 'processing-timeout' });
  });
  it('does not recursively signal when kill emits an error event', async () => {
    const controller = new AbortController();
    const child = new FakeChild();
    child.kill.mockImplementation(() => {
      child.emit('error', new Error(STRUCTURE_PRIVATE));
      return false;
    });
    const { result } = fakeQuery(child, { signal: controller.signal });
    const observed = result.catch((error: unknown) => error);
    controller.abort();
    expect(child.kill).toHaveBeenCalledTimes(1);
    child.emit('close', 0);
    expect(await observed).toMatchObject({ reason: 'processing-timeout' });
  });
  it('sanitizes spawn failures and nonzero parser exits', async () => {
    await expect(
      runBoundedStructuralProcessor({
        path: STRUCTURE_PRIVATE,
        parserPath: STRUCTURE_PRIVATE,
        deadlineAt: performance.now() + 100,
        spawnProcess() {
          throw new Error(STRUCTURE_PRIVATE);
        },
      }),
    ).rejects.toMatchObject({ message: 'Offline GPU structural route: parser-launch-failed' });
    const child = new FakeChild();
    const { result } = fakeQuery(child);
    child.emit('close', 37);
    await expect(result).rejects.toMatchObject({ reason: 'parser-exit' });
  });
});

describe('single-pass public argument boundary', () => {
  it.each([
    undefined,
    null,
    [],
    {},
    { path: 'x' },
    { path: 'x', parserPath: 'y', extra: true },
    { path: 'x', parserPath: 'y', deadlineMs: NaN },
    { path: 'x', parserPath: 'y', deadlineMs: 0 },
    { path: 'x', parserPath: 'y', deadlineMs: null },
    { path: 'x', parserPath: 'y', deadlineMs: Infinity },
    { path: 'x', parserPath: 'y', signal: null },
    { path: 'x', parserPath: 'y', signal: {} },
  ])('rejects invalid inputs with a fixed error', async (options) => {
    await expect(summarizeOfflineGpuStructure(options as never)).rejects.toMatchObject({
      message: 'Offline GPU structural route: invalid-options',
    });
  });
  it('rejects option accessors without invoking them', async () => {
    const getter = vi.fn(() => {
      throw new Error(STRUCTURE_PRIVATE);
    });
    const options = {
      parserPath: 'x',
      get path() {
        return getter();
      },
    };
    await expect(summarizeOfflineGpuStructure(options)).rejects.toMatchObject({
      reason: 'invalid-options',
    });
    expect(getter).not.toHaveBeenCalled();
  });
  it('rejects hidden, inherited and symbolic option properties', async () => {
    const good = { path: 'x', parserPath: 'y' };
    const hidden = Object.defineProperty({ ...good }, 'hidden', { value: STRUCTURE_PRIVATE });
    for (const options of [
      hidden,
      Object.assign(Object.create(good), {}),
      { ...good, [Symbol()]: true },
    ])
      await expect(summarizeOfflineGpuStructure(options)).rejects.toMatchObject({
        reason: 'invalid-options',
      });
  });
  it.each([
    ['linux', 'x64', 'processing-timeout'],
    ['win32', 'x64', 'unsupported-platform'],
    ['darwin', 'arm64', 'unsupported-platform'],
    ['linux', 'arm64', 'unsupported-platform'],
  ] as const)(
    'rejects %s/%s before I/O without calling overridden signal methods',
    async (platform, arch, reason) => {
      const platformDescriptor = Object.getOwnPropertyDescriptor(process, 'platform')!;
      const archDescriptor = Object.getOwnPropertyDescriptor(process, 'arch')!;
      const controller = new AbortController();
      controller.abort();
      const trap = vi.fn(() => {
        throw new Error(STRUCTURE_PRIVATE);
      });
      Object.defineProperties(controller.signal, {
        addEventListener: { value: trap },
        removeEventListener: { value: trap },
      });
      try {
        Object.defineProperty(process, 'platform', { ...platformDescriptor, value: platform });
        Object.defineProperty(process, 'arch', { ...archDescriptor, value: arch });
        await expect(
          summarizeOfflineGpuStructure({ path: 'x', parserPath: 'y', signal: controller.signal }),
        ).rejects.toMatchObject({ reason });
        expect(trap).not.toHaveBeenCalled();
        expect(open).not.toHaveBeenCalled();
        expect(spawn).not.toHaveBeenCalled();
      } finally {
        Object.defineProperty(process, 'platform', platformDescriptor);
        Object.defineProperty(process, 'arch', archDescriptor);
      }
      expect(Object.getOwnPropertyDescriptor(process, 'platform')).toEqual(platformDescriptor);
      expect(Object.getOwnPropertyDescriptor(process, 'arch')).toEqual(archDescriptor);
    },
  );
  it('sanitizes malformed proxy and signal errors', async () => {
    const proxy = new Proxy(
      {},
      {
        getPrototypeOf() {
          throw new Error(STRUCTURE_PRIVATE);
        },
      },
    );
    await expect(summarizeOfflineGpuStructure(proxy as never)).rejects.toMatchObject({
      reason: 'invalid-options',
    });
    await expect(
      summarizeOfflineGpuStructure({
        path: 'x',
        parserPath: 'y',
        signal: {
          addEventListener() {
            throw new Error(STRUCTURE_PRIVATE);
          },
        } as never,
      }),
    ).rejects.toMatchObject({ reason: 'invalid-options' });
    expect(new OfflineGpuStructureError(STRUCTURE_PRIVATE).message).not.toContain(
      STRUCTURE_PRIVATE,
    );
  });
});

const parserPath = process.env.MOTOBOUND_TRACE_PROCESSOR;
const parserRequired = process.env.MOTOBOUND_TRACE_PARSER_REQUIRED === '1';
describe.skipIf(!parserPath && !parserRequired)(
  'pinned single-pass staging and real parser',
  () => {
    let directory: string;
    let input: string;
    const bytes = structuralTraceFixture([
      { kind: 'begin', name: 'CommandBufferStub::OnAsyncFlush' },
      { kind: 'begin', name: 'CommandBufferService:PutChanged' },
      { kind: 'begin', name: 'TraceGLAPI::glDrawElements' },
      { kind: 'end' },
      { kind: 'begin', name: 'TraceGLAPI::glClear' },
    ]);
    beforeAll(async () => {
      expect(parserPath).toBeTruthy();
      directory = await mkdtemp(join(tmpdir(), 'structural-runner-synthetic-'));
      input = join(directory, 'synthetic.pftrace');
      await writeFile(input, bytes, { mode: 0o600 });
    });
    afterAll(async () => {
      if (directory) await rm(directory, { recursive: true, force: true });
    });
    afterEach(async () => {
      if (directory)
        expect(
          (await readdir(directory)).filter((x) => x.startsWith('.gpu-structure-private-')),
        ).toEqual([]);
    });
    it('returns selected-closed/unselected-open structure from exactly one private parser invocation', async () => {
      const result = await summarizeOfflineGpuStructure({ path: input, parserPath: parserPath! });
      expect(result.coverageMask).toBe(2);
      expect(result.buckets[0]).toMatchObject({ count: 1, completed: 1, jointOpenCount: 0 });
      expect(result.buckets[1]).toMatchObject({ count: 1, unfinished: 1, jointOpenCount: 1 });
      expect(result.childTailCertified).toBe(false);
      expect(JSON.stringify(result)).not.toMatch(
        /PRIVATE_|\/private\/|TraceGLAPI|track_id|arg_set_id/,
      );
      expect(Buffer.byteLength(JSON.stringify(result))).toBeLessThanOrEqual(limits.maxSummaryBytes);
      expect(spawn).toHaveBeenCalledTimes(1);
      const [executable, args, options] = vi.mocked(spawn).mock.calls[0];
      expect(executable).toMatch(/\.gpu-structure-private-[^/]+\/parser$/);
      expect(args).toEqual([
        '-Q',
        OFFLINE_GPU_STRUCTURE_QUERY,
        String(executable).replace(/parser$/, 'input.pftrace'),
      ]);
      expect(options).toEqual({ shell: false, stdio: ['ignore', 'pipe', 'pipe'] });
      expect(await readFile(input)).toEqual(bytes);
    });
    it('requires actual selected emission even with positive unselected structural coverage', async () => {
      const path = join(directory, 'no-selected.pftrace');
      await writeFile(
        path,
        structuralTraceFixture([
          { kind: 'begin', name: 'CommandBufferStub::OnAsyncFlush' },
          { kind: 'begin', name: 'CommandBufferService:PutChanged' },
          { kind: 'begin', name: 'TraceGLAPI::glClear' },
        ]),
      );
      await expect(
        summarizeOfflineGpuStructure({ path, parserPath: parserPath! }),
      ).rejects.toMatchObject({ reason: 'selected-wrapper-emission-missing' });
      expect(spawn).toHaveBeenCalledTimes(1);
    });
    it('accepts selected emission with zero structural coverage without certifying tail', async () => {
      const path = join(directory, 'all-closed.pftrace');
      await writeFile(
        path,
        structuralTraceFixture(
          [{ kind: 'begin', name: 'TraceGLAPI::glDrawElements' }, { kind: 'end' }],
          { truncatePacket: true, finalFlush: 1 },
        ),
      );
      const result = await summarizeOfflineGpuStructure({ path, parserPath: parserPath! });
      expect(result).toMatchObject({
        coverageMask: 0,
        parserErrors: 0,
        reportedDataLoss: 0,
        childTailCertified: false,
      });
    });
    it.each(['missing', 'empty', 'directory', 'symlink', 'oversize'] as const)(
      'rejects a %s input before parser spawn and cleans its private staging',
      async (kind) => {
        let path = join(directory, `input-${kind}`);
        if (kind === 'empty') await writeFile(path, '');
        if (kind === 'directory') path = await mkdtemp(path);
        if (kind === 'symlink') await symlink(input, path);
        if (kind === 'oversize') {
          await writeFile(path, '');
          await truncate(path, limits.maxInputBytes + 1);
        }
        await expect(
          summarizeOfflineGpuStructure({ path, parserPath: parserPath! }),
        ).rejects.toBeInstanceOf(OfflineGpuStructureError);
        expect(spawn).not.toHaveBeenCalled();
        expect(await readFile(input)).toEqual(bytes);
      },
    );
    it.each(['missing', 'small', 'symlink', 'wrong-hash'] as const)(
      'rejects a %s parser without executing it',
      async (kind) => {
        const path = join(directory, `parser-${kind}`);
        if (kind === 'small') await writeFile(path, STRUCTURE_PRIVATE);
        if (kind === 'symlink') await symlink(parserPath!, path);
        if (kind === 'wrong-hash') {
          await writeFile(path, '');
          await truncate(path, 14_897_560);
        }
        await expect(
          summarizeOfflineGpuStructure({ path: input, parserPath: path }),
        ).rejects.toBeInstanceOf(OfflineGpuStructureError);
        expect(spawn).not.toHaveBeenCalled();
      },
    );
    it('uses a single reduced deadline during verification, not a fresh query allowance', async () => {
      await expect(
        summarizeOfflineGpuStructure({ path: input, parserPath: parserPath!, deadlineMs: 0.001 }),
      ).rejects.toMatchObject({ reason: 'processing-timeout' });
      expect(spawn).not.toHaveBeenCalled();
    });
    it.each(['overflow', 'abort'] as const)(
      'keeps staged files until %s child close, then removes only owned staging',
      async (mode) => {
        const controller = new AbortController();
        const child = new FakeChild();
        let reachedSpawn!: (paths: { executable: string; trace: string }) => void;
        const spawned = new Promise<{ executable: string; trace: string }>(
          (resolve) => (reachedSpawn = resolve),
        );
        vi.mocked(spawn).mockImplementationOnce(((executable: string, args: string[]) => {
          reachedSpawn({ executable, trace: args[2] });
          return childProcess(child);
        }) as typeof spawn);
        const observed = summarizeOfflineGpuStructure({
          path: input,
          parserPath: parserPath!,
          signal: controller.signal,
        }).catch((error: unknown) => error);
        const paths = await Promise.race([
          spawned,
          observed.then(() => {
            throw new Error('Route ended before spawn');
          }),
        ]);
        try {
          expect((await stat(paths.executable)).mode & 0o777).toBe(0o500);
          expect((await stat(paths.trace)).mode & 0o777).toBe(0o400);
          expect((await stat(join(paths.trace, '..'))).mode & 0o777).toBe(0o700);
          if (mode === 'overflow') child.stdout.write(Buffer.alloc(limits.maxStdoutBytes + 1));
          else controller.abort();
          expect(child.kill).toHaveBeenCalledWith('SIGKILL');
          child.emit('exit', 1);
          await Promise.resolve();
          expect((await stat(paths.trace)).isFile()).toBe(true);
        } finally {
          child.emit('close', 1);
          await observed;
        }
        expect(await observed).toMatchObject({
          reason: mode === 'overflow' ? 'parser-output-limit' : 'processing-timeout',
        });
        await expect(stat(paths.trace)).rejects.toMatchObject({ code: 'ENOENT' });
        expect(await readFile(input)).toEqual(bytes);
      },
    );
    it('rejects fd zero before attaching any stream and closes its unreferenced handle', async () => {
      const close = vi.fn().mockResolvedValue(undefined);
      const createReadStream = vi.fn();
      const stat = vi.fn();
      vi.mocked(open).mockResolvedValueOnce({
        fd: 0,
        close,
        createReadStream,
        stat,
      } as unknown as Awaited<ReturnType<typeof open>>);
      await expect(
        summarizeOfflineGpuStructure({ path: input, parserPath: parserPath! }),
      ).rejects.toMatchObject({ reason: 'parser-unavailable' });
      expect(createReadStream).not.toHaveBeenCalled();
      expect(stat).not.toHaveBeenCalled();
      expect(close).toHaveBeenCalledTimes(1);
      expect(spawn).not.toHaveBeenCalled();
    });
    it('rejects a FIFO without blocking on its open', async () => {
      const path = join(directory, 'synthetic-fifo');
      execFileSync('mkfifo', [path], { timeout: 1000, stdio: 'ignore' });
      let fallbackNeeded = false;
      let fallback: ReturnType<typeof setTimeout> | undefined;
      vi.mocked(open).mockImplementation((...args) => {
        if (args[0] === path) {
          expect(Number(args[1]) & constants.O_NONBLOCK).toBe(constants.O_NONBLOCK);
          expect(Number(args[1]) & constants.O_NOFOLLOW).toBe(constants.O_NOFOLLOW);
          fallback = setTimeout(() => {
            fallbackNeeded = true;
            void actualFiles
              .open(path, constants.O_WRONLY | constants.O_NONBLOCK)
              .then((handle) => handle.close())
              .catch(() => {});
          }, 1000);
        }
        return actualFiles.open(...args);
      });
      try {
        await expect(
          summarizeOfflineGpuStructure({ path, parserPath: parserPath! }),
        ).rejects.toMatchObject({ reason: 'input-size' });
        expect(fallbackNeeded).toBe(false);
        expect(spawn).not.toHaveBeenCalled();
      } finally {
        clearTimeout(fallback);
      }
    });
    it('detects input pathname replacement while reading its originally opened fd', async () => {
      const saved = join(directory, 'original-input');
      vi.mocked(open).mockImplementation(async (...args) => {
        const handle = await actualFiles.open(...args);
        if (args[0] === input) {
          await rename(input, saved);
          await symlink(saved, input);
        }
        return handle;
      });
      try {
        await expect(
          summarizeOfflineGpuStructure({ path: input, parserPath: parserPath! }),
        ).rejects.toMatchObject({ reason: 'input-changed' });
        expect(spawn).not.toHaveBeenCalled();
      } finally {
        await actualFiles.rm(input);
        await rename(saved, input);
      }
    });
    it('detects changed input metadata before launching the parser', async () => {
      vi.mocked(lstat).mockImplementation((async (
        ...args: Parameters<typeof actualFiles.lstat>
      ) => {
        const result = await actualFiles.lstat(...args);
        if (args[0] === input)
          Object.defineProperty(result, 'mtimeMs', { value: Number(result.mtimeMs) + 1 });
        return result;
      }) as typeof lstat);
      await expect(
        summarizeOfflineGpuStructure({ path: input, parserPath: parserPath! }),
      ).rejects.toMatchObject({ reason: 'input-changed' });
      expect(spawn).not.toHaveBeenCalled();
    });
    it('executes the verified private parser copy even if its original pathname is replaced afterward', async () => {
      const ownedParser = join(directory, 'owned-parser');
      await copyFile(parserPath!, ownedParser);
      vi.mocked(chmod).mockImplementation(async (...args) => {
        await actualFiles.chmod(...args);
        if (args[1] === 0o500) await writeFile(ownedParser, STRUCTURE_PRIVATE);
      });
      const result = await summarizeOfflineGpuStructure({ path: input, parserPath: ownedParser });
      expect(result.coverageMask).toBe(2);
      expect((await stat(ownedParser)).size).toBe(Buffer.byteLength(STRUCTURE_PRIVATE));
      expect(spawn).toHaveBeenCalledTimes(1);
      expect(vi.mocked(spawn).mock.calls[0][0]).not.toBe(ownedParser);
    });
    it('subtracts staging work from the same remaining parser deadline', async () => {
      vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
      let now = 100;
      vi.spyOn(performance, 'now').mockImplementation(() => now);
      vi.mocked(chmod).mockImplementation(async (...args) => {
        await actualFiles.chmod(...args);
        if (args[1] === 0o400) now += 4990;
      });
      const child = new FakeChild();
      let reachedSpawn!: (trace: string) => void;
      const spawned = new Promise<string>((resolve) => (reachedSpawn = resolve));
      vi.mocked(spawn).mockImplementationOnce(((_command: string, args: string[]) => {
        reachedSpawn(args[2]);
        return childProcess(child);
      }) as typeof spawn);
      const observed = summarizeOfflineGpuStructure({ path: input, parserPath: parserPath! }).catch(
        (error: unknown) => error,
      );
      const trace = await Promise.race([
        spawned,
        observed.then(() => {
          throw new Error('Route ended before spawn');
        }),
      ]);
      try {
        await vi.advanceTimersByTimeAsync(11);
        expect(child.kill).toHaveBeenCalledExactlyOnceWith('SIGKILL');
        expect((await stat(trace)).isFile()).toBe(true);
      } finally {
        child.emit('close', 0);
        await observed;
      }
      expect(await observed).toMatchObject({ reason: 'processing-timeout' });
      await expect(stat(trace)).rejects.toMatchObject({ code: 'ENOENT' });
    });
    it('rejects expiry during staging before any parser execution', async () => {
      let now = 100;
      vi.spyOn(performance, 'now').mockImplementation(() => now);
      vi.mocked(chmod).mockImplementation(async (...args) => {
        await actualFiles.chmod(...args);
        if (args[1] === 0o400) now += 5001;
      });
      await expect(
        summarizeOfflineGpuStructure({ path: input, parserPath: parserPath! }),
      ).rejects.toMatchObject({ reason: 'processing-timeout' });
      expect(spawn).not.toHaveBeenCalled();
    });
    it.each(['decode', 'cleanup'] as const)(
      'rejects a result whose %s finishes after the single deadline',
      async (phase) => {
        let now = 100;
        vi.spyOn(performance, 'now').mockImplementation(() => now);
        const child = new FakeChild();
        vi.mocked(spawn).mockImplementationOnce((() => {
          queueMicrotask(() => {
            child.stdout.write(validCsv);
            child.emit('close', 0);
          });
          return childProcess(child);
        }) as typeof spawn);
        if (phase === 'decode')
          vi.mocked(decodeOfflineGpuStructureRows).mockImplementation((...args) => {
            const result = actualStructure.decodeOfflineGpuStructureRows(...args);
            now += 5001;
            return result;
          });
        if (phase === 'cleanup')
          vi.mocked(rm).mockImplementation(async (...args) => {
            await actualFiles.rm(...args);
            now += 5001;
          });
        await expect(
          summarizeOfflineGpuStructure({ path: input, parserPath: parserPath! }),
        ).rejects.toMatchObject({ reason: 'processing-timeout' });
      },
    );
    it('reports cleanup failure instead of success and never exposes its dynamic exception', async () => {
      const child = new FakeChild();
      vi.mocked(spawn).mockImplementationOnce((() => {
        queueMicrotask(() => {
          child.stdout.write(validCsv);
          child.emit('close', 0);
        });
        return childProcess(child);
      }) as typeof spawn);
      vi.mocked(rm).mockRejectedValueOnce(new Error(STRUCTURE_PRIVATE));
      try {
        await expect(
          summarizeOfflineGpuStructure({ path: input, parserPath: parserPath! }),
        ).rejects.toMatchObject({
          message: 'Offline GPU structural route: private-cleanup-failed',
        });
        const leftover = (await readdir(directory)).filter((x) =>
          x.startsWith('.gpu-structure-private-'),
        );
        expect(leftover).toHaveLength(1);
        expect((await stat(join(directory, leftover[0]))).mode & 0o777).toBe(0o700);
      } finally {
        for (const name of (await readdir(directory)).filter((x) =>
          x.startsWith('.gpu-structure-private-'),
        ))
          await actualFiles.rm(join(directory, name), { recursive: true });
      }
    });
  },
);
