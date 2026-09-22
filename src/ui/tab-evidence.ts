/** Whole-tab audiovisual evidence: HTML HUD, menus and WebGL are captured by
 * the browser compositor, never reconstructed from a substitute interface.
 * Two explicit gestures choose a local file and then a browser tab. Video is
 * streamed to that file with bounded pending writes, not retained in RAM. */
interface EvidenceFile {
  write(data: Blob): Promise<void>;
  close(): Promise<void>;
  abort(reason?: unknown): Promise<void>;
}
interface EvidenceHandle {
  name: string;
  createWritable(): Promise<EvidenceFile>;
}
interface PickerWindow extends Window {
  showSaveFilePicker?: (options: {
    suggestedName: string;
    types: { description: string; accept: Record<string, string[]> }[];
  }) => Promise<EvidenceHandle>;
}
export interface TabEvidenceReport {
  version: 1;
  source: string;
  state: string;
  reason: string;
  fileName: string | null;
  bytesWritten: number;
  chunksWritten: number;
  startedAt: string | null;
  stoppedAt: string | null;
  mimeType: string | null;
  videoTrackSettings: MediaTrackSettings | null;
  tabAudioTracks: number;
  fullTabIncludesHTML: boolean;
  selectedTabIdentityVerified: false;
  startupCaptured: false;
  physicalHardwareVerified: false;
  humanAccepted: false;
  section146Accepted: false;
  observations: { at: string; kind: string; detail: string }[];
}
export class TabEvidence {
  static readonly maximumBytes = 2 * 1024 ** 3;
  static readonly maximumPendingBytes = 16 * 1024 ** 2;
  static readonly maximumDurationMs = 2 * 60 * 60 * 1000;
  private handle: EvidenceHandle | null = null;
  private file: EvidenceFile | null = null;
  private stream: MediaStream | null = null;
  private recorder: MediaRecorder | null = null;
  private writes: Promise<void> = Promise.resolve();
  private pendingBytes = 0;
  private finalizing: EvidenceFile | null = null;
  private writeFailed = false;
  private readonly preventUnload = (event: BeforeUnloadEvent) => {
    if (!this.active) return;
    event.preventDefault();
    event.returnValue = '';
  };
  private acceptedBytes = 0;
  private timer: ReturnType<typeof setTimeout> | null = null;
  private disposed = false;
  private owner = 0;
  private listener: (() => void) | null = null;
  private data: TabEvidenceReport;
  constructor(source: string) {
    if (!/^[a-f0-9]{64}$/.test(source)) throw new Error('Missing evidence source identity');
    this.data = this.empty(source);
  }
  private empty(source: string): TabEvidenceReport {
    return {
      version: 1,
      source,
      state: 'idle',
      reason: '',
      fileName: null,
      bytesWritten: 0,
      chunksWritten: 0,
      startedAt: null,
      stoppedAt: null,
      mimeType: null,
      videoTrackSettings: null,
      tabAudioTracks: 0,
      fullTabIncludesHTML: false,
      selectedTabIdentityVerified: false,
      startupCaptured: false,
      physicalHardwareVerified: false,
      humanAccepted: false,
      section146Accepted: false,
      observations: [],
    };
  }
  get active() {
    return (
      !!this.recorder ||
      !!this.file ||
      ['choosing-file', 'requesting-tab'].includes(this.data.state)
    );
  }
  report() {
    return structuredClone(this.data);
  }
  observe(kind: string, detail: string) {
    if (this.data.state !== 'recording') return;
    if (this.data.observations.length >= 4096) {
      this.stop('Observation capacity reached', true);
      return;
    }
    this.data.observations.push({
      at: new Date().toISOString(),
      kind: kind.slice(0, 40),
      detail: detail.slice(0, 160),
    });
  }
  private changed() {
    this.listener?.();
  }
  async chooseFile() {
    if (this.active || this.disposed) throw new Error('Evidence recorder is busy');
    const picker = (window as PickerWindow).showSaveFilePicker;
    if (!picker)
      throw new Error(
        'Direct-to-file recording requires a browser supporting Save File Picker. Use external capture otherwise.',
      );
    const owner = ++this.owner;
    this.data = this.empty(this.data.source);
    this.data.state = 'choosing-file';
    this.changed();
    try {
      const handle = await picker.call(window, {
        suggestedName: `apex-session-${this.data.source.slice(0, 12)}.webm`,
        types: [{ description: 'Recorded WebM video', accept: { 'video/webm': ['.webm'] } }],
      });
      if (this.disposed || owner !== this.owner) return;
      this.handle = handle;
      this.data.fileName = handle.name;
      this.data.state = 'ready';
    } catch (error) {
      this.handle = null;
      this.data.state = 'idle';
      this.data.reason = error instanceof Error ? error.message : String(error);
    } finally {
      this.changed();
    }
  }
  async start(includeTabAudio: boolean) {
    if (this.disposed || this.data.state !== 'ready' || !this.handle)
      throw new Error('Choose the local destination first');
    if (!navigator.mediaDevices?.getDisplayMedia || typeof MediaRecorder === 'undefined')
      throw new Error('Browser tab capture is unavailable');
    const mime = ['video/webm;codecs=vp9,opus', 'video/webm;codecs=vp8,opus', 'video/webm'].find(
      (type) => MediaRecorder.isTypeSupported(type),
    );
    if (!mime) throw new Error('No supported WebM encoder');
    this.data.state = 'requesting-tab';
    this.changed();
    const owner = ++this.owner;
    try {
      // This call runs directly in the START button's activation; the separate
      // file picker must not consume that permission gesture first.
      const stream = await navigator.mediaDevices.getDisplayMedia({
        video: { frameRate: { ideal: 30, max: 30 }, displaySurface: 'browser' },
        audio: includeTabAudio,
      });
      if (this.disposed || owner !== this.owner) {
        stream.getTracks().forEach((t) => t.stop());
        return;
      }
      this.stream = stream;
      const track = stream.getVideoTracks()[0];
      if (!track || track.getSettings().displaySurface !== 'browser')
        throw new Error('Select the game browser TAB, not a screen or window');
      if (!includeTabAudio)
        stream.getAudioTracks().forEach((t) => {
          t.stop();
          stream.removeTrack(t);
        });
      const file = await this.handle.createWritable();
      if (this.disposed || owner !== this.owner) {
        await file.abort('Recorder disposed');
        return;
      }
      this.file = file;
      this.pendingBytes = this.acceptedBytes = 0;
      this.writeFailed = false;
      this.finalizing = null;
      this.writes = Promise.resolve();
      const recorder = new MediaRecorder(stream, {
        mimeType: mime,
        videoBitsPerSecond: 5_000_000,
        audioBitsPerSecond: 128_000,
      });
      this.recorder = recorder;
      this.data.mimeType = recorder.mimeType;
      this.data.videoTrackSettings = track.getSettings();
      this.data.fullTabIncludesHTML = true;
      this.data.tabAudioTracks = stream.getAudioTracks().length;
      this.data.startedAt = new Date().toISOString();
      this.data.reason =
        includeTabAudio && !this.data.tabAudioTracks
          ? 'Tab audio was requested but was NOT provided by the browser'
          : '';
      // Late events from a previously finalized encoder must never write into
      // the next recording or corrupt its metadata. Final data is accepted
      // during stopping, but never after that encoder's stop event.
      const owns = () => this.recorder === recorder && this.file === file;
      recorder.ondataavailable = (event) => {
        if (owns() && this.finalizing !== file) this.append(event.data, file);
      };
      recorder.onerror = () => {
        if (owns()) this.stop('MediaRecorder reported an encoding error', true);
      };
      recorder.onstop = () => {
        if (owns()) void this.finish(file);
      };
      track.addEventListener(
        'ended',
        () => {
          if (owns()) this.stop('Browser tab sharing ended');
        },
        { once: true },
      );
      this.data.state = 'recording';
      recorder.start(1000);
      window.addEventListener?.('beforeunload', this.preventUnload);
      this.timer = setTimeout(
        () => this.stop('Two-hour recording limit reached'),
        TabEvidence.maximumDurationMs,
      );
    } catch (error) {
      this.data.state = 'failed';
      this.data.reason = error instanceof Error ? error.message : String(error);
      this.stream?.getTracks().forEach((t) => t.stop());
      this.stream = null;
      if (this.file) {
        await this.file.abort(this.data.reason).catch(() => {});
        this.file = null;
      }
      if (this.recorder) {
        this.recorder.ondataavailable = null;
        this.recorder.onerror = null;
        this.recorder.onstop = null;
      }
      this.recorder = null;
      window.removeEventListener?.('beforeunload', this.preventUnload);
    } finally {
      this.changed();
    }
  }
  private append(blob: Blob, file: EvidenceFile) {
    if (!blob.size || this.writeFailed || this.file !== file) return;
    if (
      this.pendingBytes + blob.size > TabEvidence.maximumPendingBytes ||
      this.acceptedBytes + blob.size > TabEvidence.maximumBytes
    ) {
      this.stop('Disk backpressure or recording size limit; tail was not written', true);
      return;
    }
    this.pendingBytes += blob.size;
    this.acceptedBytes += blob.size;
    this.writes = this.writes
      .then(async () => {
        // Preserve the prefix already written, but never append later chunks
        // behind a failed write: that would make the apparent stream misleading.
        if (this.writeFailed || this.file !== file) return;
        await file.write(blob);
        this.data.bytesWritten += blob.size;
        this.data.chunksWritten++;
      })
      .catch((error: unknown) => {
        this.writeFailed = true;
        this.stop(
          `Local file write failed: ${error instanceof Error ? error.message : String(error)}`,
          true,
        );
      })
      .finally(() => {
        this.pendingBytes -= blob.size;
        this.changed();
      });
  }
  stop(reason = 'Reviewer stopped recording', failed = false) {
    if (!['recording', 'stopping', 'failed'].includes(this.data.state)) return;
    if (failed) {
      this.data.state = 'failed';
      this.data.reason = reason;
    } else if (this.data.state !== 'failed') {
      this.data.state = 'stopping';
      this.data.reason = reason;
    }
    if (this.timer) {
      clearTimeout(this.timer);
      this.timer = null;
    }
    if (this.recorder && this.recorder.state !== 'inactive') {
      try {
        this.recorder.stop();
      } catch (error) {
        this.data.state = 'failed';
        this.data.reason = `Encoder could not stop: ${String(error)}`;
        this.stream?.getTracks().forEach((track) => track.stop());
        this.stream = null;
        if (this.file) void this.finish(this.file);
      }
    }
    this.changed();
  }
  private async finish(file: EvidenceFile) {
    if (this.finalizing === file || this.file !== file) return;
    this.finalizing = file;
    // Release capture immediately; slow local writes must not keep sharing alive.
    this.stream?.getTracks().forEach((track) => track.stop());
    this.stream = null;
    if (this.recorder) {
      this.recorder.ondataavailable = null;
      this.recorder.onerror = null;
      this.recorder.onstop = null;
    }
    if (this.timer) {
      clearTimeout(this.timer);
      this.timer = null;
    }
    await this.writes;
    try {
      await file.close();
    } catch (error) {
      this.data.state = 'failed';
      this.data.reason = `File finalization failed: ${String(error)}`;
    }
    this.file = null;
    this.recorder = null;
    this.finalizing = null;
    window.removeEventListener?.('beforeunload', this.preventUnload);
    this.data.stoppedAt = new Date().toISOString();
    if (this.data.state !== 'failed') this.data.state = this.data.bytesWritten ? 'saved' : 'failed';
    if (!this.data.bytesWritten && !this.data.reason)
      this.data.reason = 'No video bytes were recorded';
    this.changed();
  }
  mount(parent: HTMLElement) {
    parent.querySelector('[data-tab-evidence]')?.remove();
    const section = document.createElement('section');
    section.dataset.tabEvidence = 'true';
    section.innerHTML = `<h3>Record the actual game tab</h3><p>Records the browser tab including HUD, menus, replay and telemetry. First choose a local WebM file, then select this game tab in the browser prompt. No microphone permission is requested. Recording streams to disk (two hours / 2 GiB maximum); closing or reloading the application interrupts it. It cannot prove application startup, your identity, or physical hardware.</p><p data-tab-status role="status"></p><label class="check"><input type="checkbox" data-tab-audio checked>Request this tab's audio (the browser may require a separate Share audio selection)</label><div class="dialog-buttons"><button type="button" data-tab-file>1. CHOOSE LOCAL FILE</button><button type="button" data-tab-start>2. SHARE TAB & RECORD</button><button type="button" data-tab-stop>STOP & FINALIZE FILE</button><button type="button" data-tab-report>EXPORT RECORDING MANIFEST</button></div>`;
    parent.append(section);
    const get = (key: string) => section.querySelector<HTMLElement>(`[data-tab-${key}]`)!;
    const refresh = () => {
      if (!section.isConnected) return;
      get('status').textContent =
        `${this.data.state.toUpperCase()} · ${(this.data.bytesWritten / 1048576).toFixed(1)} MiB saved · ${this.data.tabAudioTracks ? 'tab audio present' : 'no tab audio'}${this.data.reason ? ' · ' + this.data.reason : ''}`;
      (get('file') as HTMLButtonElement).disabled = this.active;
      (get('start') as HTMLButtonElement).disabled = this.data.state !== 'ready';
      (get('stop') as HTMLButtonElement).disabled = this.data.state !== 'recording';
    };
    this.listener = refresh;
    const failure = (e: unknown) => {
      this.data.reason = String(e);
      refresh();
    };
    get('file').onclick = () => {
      void this.chooseFile().catch(failure);
    };
    get('start').onclick = () => {
      void this.start((get('audio') as HTMLInputElement).checked).catch(failure);
    };
    get('stop').onclick = () => this.stop();
    get('report').onclick = () => {
      const url = URL.createObjectURL(
        new Blob([JSON.stringify(this.report(), null, 2) + '\n'], { type: 'application/json' }),
      );
      const a = document.createElement('a');
      a.href = url;
      a.download = `apex-tab-${this.data.source.slice(0, 12)}.json`;
      a.click();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
    };
    refresh();
  }
  dispose() {
    if (this.disposed) return;
    this.disposed = true;
    this.owner++;
    this.listener = null;
    this.stop('Application disposed; recording is interrupted', true);
    // During a permission prompt no recorder owns the stream yet.
    if (!this.recorder && !['saved', 'failed'].includes(this.data.state)) {
      this.stream?.getTracks().forEach((t) => t.stop());
      this.stream = null;
      this.data.state = 'interrupted';
      this.data.reason = 'Application disposed before recording';
      this.data.stoppedAt = new Date().toISOString();
    }
  }
}
