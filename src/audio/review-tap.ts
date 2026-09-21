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
      this.stream.getTracks().forEach((track) => track.stop());
      this.destination = null;
      throw error;
    }
  }
  release() {
    const destination = this.destination;
    if (!destination) return;
    this.destination = null;
    try {
      this.output.disconnect(destination);
    } finally {
      this.stream.getTracks().forEach((track) => track.stop());
      destination.disconnect();
    }
  }
}
