export interface ReviewAudioSource {
  readonly stream: MediaStream;
  release(): void;
}

/** Explicit, local capture of the game's post-compressor bus. This does not
 * request a microphone or loop audio back to the speakers. Own only this tap;
 * disconnect(destination), not disconnect(), preserves normal playback. */
export class ReviewAudioTap implements ReviewAudioSource {
  readonly stream: MediaStream;
  private destination: MediaStreamAudioDestinationNode | null;
  constructor(
    context: AudioContext,
    private output: AudioNode,
  ) {
    if (context.state !== 'running') throw new Error('Game audio is not running');
    const destination = context.createMediaStreamDestination();
    this.destination = destination;
    this.stream = destination.stream;
    try {
      output.connect(destination);
    } catch (error) {
      try {
        this.release();
      } catch {
        // Cleanup must not replace the original connection failure.
      }
      throw error;
    }
  }
  release() {
    const destination = this.destination;
    if (!destination) return;
    this.destination = null;
    const failures: unknown[] = [];
    const release = (cleanup: () => void) => {
      try {
        cleanup();
      } catch (error) {
        failures.push(error);
      }
    };
    release(() => this.output.disconnect(destination));
    release(() => {
      for (const track of this.stream.getTracks()) release(() => track.stop());
    });
    release(() => destination.disconnect());
    if (failures.length) throw failures[0];
  }
}
