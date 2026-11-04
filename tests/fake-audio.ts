/** A recording Web Audio stand-in for unit tests (vitest runs in Node, which has no
 * AudioContext). It keeps the graph's connections and every AudioParam event so a
 * test can assert what a module built and scheduled, never what it sounds like:
 * that is the offline rig's job (scripts/studio/tools/audio-render.mjs). */
export interface ParamEvent {
  kind: 'set' | 'linear' | 'exp' | 'target' | 'cancel';
  value: number;
  time: number;
}
export class FakeParam {
  value: number;
  events: ParamEvent[] = [];
  constructor(initial = 0) {
    this.value = initial;
  }
  setValueAtTime(value: number, time: number) {
    this.events.push({ kind: 'set', value, time });
    this.value = value;
    return this;
  }
  linearRampToValueAtTime(value: number, time: number) {
    this.events.push({ kind: 'linear', value, time });
    return this;
  }
  exponentialRampToValueAtTime(value: number, time: number) {
    this.events.push({ kind: 'exp', value, time });
    return this;
  }
  setTargetAtTime(value: number, time: number) {
    this.events.push({ kind: 'target', value, time });
    return this;
  }
  cancelScheduledValues(time: number) {
    this.events.push({ kind: 'cancel', value: 0, time });
    return this;
  }
}
export class FakeNode {
  readonly kind: string;
  readonly outputs: FakeNode[] = [];
  gain = new FakeParam(1);
  frequency = new FakeParam(440);
  Q = new FakeParam(1);
  threshold = new FakeParam(-24);
  knee = new FakeParam(30);
  ratio = new FakeParam(12);
  attack = new FakeParam(0.003);
  release = new FakeParam(0.25);
  pan = new FakeParam(0);
  type = '';
  curve: Float32Array | null = null;
  oversample = 'none';
  buffer: unknown = null;
  loop = false;
  loopStart = 0;
  loopEnd = 0;
  started: number[] = [];
  stopped: (number | undefined)[] = [];
  onended: (() => void) | null = null;
  constructor(kind: string) {
    this.kind = kind;
  }
  connect(node: FakeNode) {
    this.outputs.push(node);
    return node;
  }
  disconnect(node?: FakeNode) {
    if (!node) this.outputs.length = 0;
    else this.outputs.splice(this.outputs.indexOf(node), 1);
  }
  start(time = 0) {
    this.started.push(time);
  }
  stop(time?: number) {
    this.stopped.push(time);
  }
  setPeriodicWave() {}
}
export class FakeContext {
  currentTime = 0;
  state: AudioContextState = 'running';
  sampleRate = 48000;
  destination = new FakeNode('destination');
  nodes: FakeNode[] = [];
  private make(kind: string) {
    const node = new FakeNode(kind);
    this.nodes.push(node);
    return node;
  }
  createGain() {
    return this.make('gain');
  }
  createOscillator() {
    return this.make('oscillator');
  }
  createBufferSource() {
    return this.make('source');
  }
  createBiquadFilter() {
    return this.make('biquad');
  }
  createDynamicsCompressor() {
    return this.make('compressor');
  }
  createWaveShaper() {
    return this.make('shaper');
  }
  createStereoPanner() {
    return this.make('panner');
  }
  createPeriodicWave() {
    return {};
  }
  createBuffer(_channels: number, length: number) {
    return { getChannelData: () => new Float32Array(length) };
  }
  of(kind: string) {
    return this.nodes.filter((n) => n.kind === kind);
  }
  /** Can `from` reach `to` by following connections? */
  reaches(from: FakeNode, to: FakeNode, seen = new Set<FakeNode>()): boolean {
    if (from === to) return true;
    if (seen.has(from)) return false;
    seen.add(from);
    return from.outputs.some((n) => this.reaches(n, to, seen));
  }
}
export const asContext = (c: FakeContext) => c as unknown as BaseAudioContext;
export const asNode = (n: FakeNode) => n as unknown as AudioNode;
