/// <reference lib="webworker" />
import { CAR_STRIDE, F, H, HEADER, carBase } from '../../src/simulation/protocol.ts';
import type { Simulation } from '../../src/simulation/world.ts';
import { TelemetrySampler } from '../../src/storage/telemetry-sampler.ts';

const scope = self as unknown as DedicatedWorkerGlobalScope;
let sampler: TelemetrySampler | undefined;
let detached = 0;
let recycled = 0;
const warnings: string[] = [];

/** Only the finite frame source is prescribed. The production sampler owns
 * capture cadence, packing, elastic pages and transfer/recycle accounting. */
scope.onmessage = (
  event: MessageEvent<{
    kind: 'capture' | 'telemetry-return' | 'replay-return' | 'settle';
    buffer?: ArrayBuffer;
  }>,
) => {
  try {
    const { kind, buffer } = event.data;
    if (kind === 'telemetry-return' || kind === 'replay-return') {
      if (!sampler || !buffer) throw new Error('Return without its capture owner');
      if (kind === 'telemetry-return') sampler.recycle(buffer);
      else sampler.recycleReplay(buffer);
      recycled++;
      return;
    }
    if (kind === 'settle') {
      if (!sampler) throw new Error('Settle without its capture owner');
      scope.postMessage({
        kind: 'settled',
        detached,
        recycled,
        pages: sampler.transportPages,
        warnings,
      });
      return;
    }
    if (sampler) throw new Error('Only one capture belongs to this worker');
    const frame = new Float32Array(HEADER + CAR_STRIDE);
    const base = carBase(0);
    frame[H.CARS] = frame[base + F.QW] = 1;
    const source = {
      get tick() {
        return frame[H.TICK];
      },
      makeFrame: () => new Float32Array(frame.length),
      writeFrame: (out: Float32Array) => out.set(frame),
    };
    const publish = (stream: 'telemetry' | 'replay', sent: ArrayBuffer, rows: number) => {
      scope.postMessage({ kind: stream, buffer: sent, rows }, [sent]);
      if (sent.byteLength !== 0) throw new Error('Native capture transfer did not detach');
      detached++;
    };
    sampler = new TelemetrySampler(
      source as Simulation,
      (sent, rows) => publish('telemetry', sent, rows),
      (message) => warnings.push(message),
      (sent, rows) => publish('replay', sent, rows),
    );
    for (let row = 0; row < 730; row++) {
      const lap = Math.floor(row / 120),
        gap = row >= 600 ? 1 : 0;
      frame[H.TIME] = frame[H.RACE_TIME] = (row + 1) / 60 + gap;
      frame[H.TICK] = (row + 1) * 2 + gap * 120;
      frame[base + F.S] = ((row % 120) * 100) / 120;
      frame[base + F.LAPS] = lap;
      frame[base + F.LAP_TIME] = ((row % 120) + 1) / 60;
      frame[base + F.LAP_VALID] = lap === 2 || lap === 6 ? 0 : 1;
      sampler.capture();
    }
    sampler.flush();
    sampler.flushReplay();
    scope.postMessage({ kind: 'captured' });
  } catch (error) {
    scope.postMessage({
      kind: 'error',
      message: error instanceof Error ? error.message : String(error),
    });
  }
};
