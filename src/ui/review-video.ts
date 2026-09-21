/** Optional local video evidence. No microphone, network upload or retained
 * object URL. Encoder frames may be coalesced; requests are not encoded-frame
 * counts. Separate JSON timings retain every observed application render. */
export class ReviewVideo {
  private recorder: MediaRecorder | null = null;
  private track: (MediaStreamTrack & { requestFrame(): void }) | null = null;
  private chunks: Blob[] = [];
  private bytes = 0;
  private stream: MediaStream | null = null;
  state: 'idle' | 'recording' | 'stopping' | 'ready' | 'unavailable' = 'idle';
  reason: string | null = null;
  requestedFrames = 0;
  blob: Blob | null = null;
  static readonly maximumBytes = 64 * 1024 * 1024;
  start(canvas: HTMLCanvasElement) {
    if (this.state === 'recording' || this.state === 'stopping')
      throw new Error('Video is still active');
    this.chunks = [];
    this.bytes = 0;
    this.requestedFrames = 0;
    this.blob = null;
    this.reason = null;
    try {
      if (typeof MediaRecorder === 'undefined' || typeof canvas.captureStream !== 'function')
        throw new Error('Canvas video recording is not supported');
      const mimeType = ['video/webm;codecs=vp9', 'video/webm;codecs=vp8', 'video/webm'].find(
        (mime) => MediaRecorder.isTypeSupported(mime),
      );
      if (!mimeType) throw new Error('No WebM encoder is available');
      this.stream = canvas.captureStream(0);
      const track = this.stream.getVideoTracks()[0];
      if (!track || !('requestFrame' in track) || typeof track.requestFrame !== 'function')
        throw new Error('Manual canvas frame capture is not supported');
      this.track = track as typeof this.track;
      const recorder = new MediaRecorder(this.stream, { mimeType, videoBitsPerSecond: 3_000_000 });
      this.recorder = recorder;
      recorder.ondataavailable = ({ data }) => {
        if (!data.size) return;
        if (this.bytes + data.size > ReviewVideo.maximumBytes) {
          this.reason = 'Video reached the 64 MiB evidence limit; clip is incomplete';
          this.stop();
          return;
        }
        this.chunks.push(data);
        this.bytes += data.size;
      };
      recorder.onerror = () => {
        this.reason = 'Browser video encoder failed; JSON evidence is retained';
        this.stop();
      };
      recorder.onstop = () => {
        this.blob = this.chunks.length ? new Blob(this.chunks, { type: recorder.mimeType }) : null;
        this.chunks = [];
        this.releaseTracks();
        this.recorder = null;
        this.state = this.blob ? 'ready' : 'unavailable';
        if (!this.blob) this.reason ??= 'Encoder produced no video data';
      };
      recorder.start(1000);
      this.state = 'recording';
    } catch (error) {
      this.releaseTracks();
      this.recorder = null;
      this.state = 'unavailable';
      this.reason = error instanceof Error ? error.message : String(error);
    }
  }
  frame() {
    if (this.state !== 'recording') return;
    try {
      this.track!.requestFrame();
      this.requestedFrames++;
    } catch {
      this.reason = 'Canvas frame request failed';
      this.stop();
    }
  }
  stop() {
    if (this.state !== 'recording') return;
    this.state = 'stopping';
    if (this.recorder?.state !== 'inactive') this.recorder?.stop();
    else {
      this.releaseTracks();
      this.state = 'unavailable';
    }
  }
  diagnostics() {
    return {
      state: this.state,
      reason: this.reason,
      requestedFrames: this.requestedFrames,
      bytes: this.blob?.size ?? this.bytes,
      maximumBytes: ReviewVideo.maximumBytes,
      encodedFrameCount: null,
      capturesAudio: false,
    };
  }
  dispose() {
    if (this.recorder) {
      this.recorder.ondataavailable = null;
      this.recorder.onstop = null;
      this.recorder.onerror = null;
      if (this.recorder.state !== 'inactive') this.recorder.stop();
    }
    this.releaseTracks();
    this.recorder = null;
    this.chunks = [];
    this.blob = null;
    this.bytes = 0;
    this.requestedFrames = 0;
    this.reason = null;
    this.state = 'idle';
  }
  private releaseTracks() {
    this.stream?.getTracks().forEach((track) => track.stop());
    this.stream = null;
    this.track = null;
  }
}
