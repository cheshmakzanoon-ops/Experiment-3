import { afterEach, expect, it, vi } from 'vitest';
import { TabEvidence } from '../src/ui/tab-evidence.ts';
const source = 'a'.repeat(64);
afterEach(() => vi.unstubAllGlobals());
function fixture(surface = 'browser', write: (blob: Blob) => Promise<void> = async () => {}) {
  const track = {
    getSettings: () => ({ displaySurface: surface, width: 1920, height: 1080 }),
    stop: vi.fn(),
    addEventListener: vi.fn(),
  };
  const stream = {
    getVideoTracks: () => [track],
    getAudioTracks: () => [],
    getTracks: () => [track],
    removeTrack: vi.fn(),
  };
  const file = { write: vi.fn(write), close: vi.fn(async () => {}), abort: vi.fn(async () => {}) };
  const createWritable = vi.fn(async () => file);
  const getDisplayMedia = vi.fn(async () => stream);
  const instances: FakeRecorder[] = [];
  class FakeRecorder {
    state = 'inactive';
    mimeType = 'video/webm';
    ondataavailable: ((event: { data: Blob }) => void) | null = null;
    onstop: (() => void) | null = null;
    onerror: (() => void) | null = null;
    static isTypeSupported() {
      return true;
    }
    constructor() {
      instances.push(this);
    }
    start() {
      this.state = 'recording';
    }
    emit(blob = new Blob(['recorded-fixture'])) {
      this.ondataavailable?.({ data: blob });
    }
    stop() {
      this.state = 'inactive';
      queueMicrotask(() => {
        this.emit();
        this.onstop?.();
      });
    }
  }
  vi.stubGlobal('window', {
    showSaveFilePicker: vi.fn(async () => ({ name: 'fixture.webm', createWritable })),
  });
  vi.stubGlobal('navigator', { mediaDevices: { getDisplayMedia } });
  vi.stubGlobal('MediaRecorder', FakeRecorder);
  return {
    file,
    track,
    getDisplayMedia,
    createWritable,
    recorder: () => instances[instances.length - 1]!,
  };
}
it('streams ordered chunks, finalizes once, records absent audio honestly and never certifies a human', async () => {
  const f = fixture(),
    r = new TabEvidence(source);
  await r.chooseFile();
  await r.start(true);
  expect(r.report().state).toBe('recording');
  expect(r.report().tabAudioTracks).toBe(0);
  expect(r.report().reason).toContain('NOT provided');
  f.recorder().emit();
  r.observe('action', 'telemetry');
  r.stop();
  await vi.waitFor(() => expect(r.report().state).toBe('saved'));
  expect(f.file.write).toHaveBeenCalledTimes(2);
  expect(f.file.close).toHaveBeenCalledTimes(1);
  expect(f.track.stop).toHaveBeenCalledTimes(1);
  expect(r.report()).toMatchObject({
    fullTabIncludesHTML: true,
    humanAccepted: false,
    section146Accepted: false,
    physicalHardwareVerified: false,
    startupCaptured: false,
    selectedTabIdentityVerified: false,
  });
  expect(r.report().observations).toHaveLength(1);
  r.dispose();
});
it('rejects whole-screen capture before opening or overwriting the selected file', async () => {
  const f = fixture('monitor'),
    r = new TabEvidence(source);
  await r.chooseFile();
  await r.start(false);
  expect(r.report().state).toBe('failed');
  expect(f.createWritable).not.toHaveBeenCalled();
  expect(f.track.stop).toHaveBeenCalledTimes(1);
  r.dispose();
});
it('retains a write error, finalizes a failed partial file, and cannot restart while stopping', async () => {
  const f = fixture(
      'browser',
      vi.fn(async () => {
        throw new Error('disk full');
      }),
    ),
    r = new TabEvidence(source);
  await r.chooseFile();
  await r.start(false);
  f.recorder().emit();
  await vi.waitFor(() => expect(r.report().state).toBe('failed'));
  await vi.waitFor(() => expect(f.file.close).toHaveBeenCalledTimes(1));
  expect(r.report().reason).toMatch(/write failed|No video bytes/);
  expect(r.report().section146Accepted).toBe(false);
  r.dispose();
});
it('bounds queued bytes instead of retaining an entire two-hour recording in memory', async () => {
  const f = fixture(),
    r = new TabEvidence(source);
  await r.chooseFile();
  await r.start(false);
  f.recorder().emit(new Blob([new Uint8Array(TabEvidence.maximumPendingBytes + 1)]));
  await vi.waitFor(() => expect(f.file.close).toHaveBeenCalledTimes(1));
  expect(r.report().state).toBe('failed');
  expect(r.report().reason).toContain('backpressure');
  expect(r.report().bytesWritten).toBeLessThan(TabEvidence.maximumPendingBytes);
  r.dispose();
});
it('stops tracks when the application is disposed during an outstanding capture prompt', async () => {
  const f = fixture(),
    r = new TabEvidence(source);
  let resolve: (s: unknown) => void = () => {};
  const pending = new Promise((resolve_) => {
    resolve = resolve_;
  });
  vi.stubGlobal('navigator', { mediaDevices: { getDisplayMedia: () => pending } });
  await r.chooseFile();
  const start = r.start(false);
  r.dispose();
  resolve({ getTracks: () => [f.track] });
  await start;
  expect(f.track.stop).toHaveBeenCalledTimes(1);
  expect(f.createWritable).not.toHaveBeenCalled();
});

it('finalizes a recorder only once even when its stop callback is duplicated', async () => {
  const f = fixture(),
    r = new TabEvidence(source);
  await r.chooseFile();
  await r.start(false);
  f.recorder().emit();
  const stopped = f.recorder().onstop!;
  r.stop();
  stopped();
  stopped();
  await vi.waitFor(() => expect(r.active).toBe(false));
  expect(f.file.close).toHaveBeenCalledTimes(1);
  expect(f.track.stop).toHaveBeenCalledTimes(1);
  r.dispose();
});
it('late encoder callbacks cannot modify the following recording', async () => {
  const f = fixture(),
    r = new TabEvidence(source);
  await r.chooseFile();
  await r.start(false);
  const old = f.recorder(),
    emit = old.ondataavailable!,
    stop = old.onstop!,
    fail = old.onerror!;
  old.emit();
  r.stop();
  await vi.waitFor(() => expect(r.report().state).toBe('saved'));
  await r.chooseFile();
  await r.start(false);
  const before = r.report();
  emit({ data: new Blob(['stale']) });
  stop();
  fail();
  await Promise.resolve();
  expect(r.report()).toEqual(before);
  expect(r.report().state).toBe('recording');
  r.stop();
  await vi.waitFor(() => expect(r.active).toBe(false));
  r.dispose();
});
it('never writes queued tail data after the first local file write fails', async () => {
  const f = fixture('browser', async () => {
      throw new Error('disk failure');
    }),
    r = new TabEvidence(source);
  await r.chooseFile();
  await r.start(false);
  f.recorder().emit(new Blob(['one']));
  f.recorder().emit(new Blob(['two']));
  await vi.waitFor(() => expect(r.active).toBe(false));
  expect(f.file.write).toHaveBeenCalledTimes(1);
  expect(r.report().bytesWritten).toBe(0);
  expect(r.report().state).toBe('failed');
  r.dispose();
});
