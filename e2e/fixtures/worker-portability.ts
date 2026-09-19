import PhysicsWorker from '../../src/workers/physics.worker.ts?worker&inline';
import { TelemetryExport } from '../../src/storage/telemetry-export.ts';
import { DEFAULT_OPTIONS } from '../../src/simulation/config.ts';
import { H, type FromWorker } from '../../src/simulation/protocol.ts';
import { packTelemetry, TELEMETRY_STRIDE } from '../../src/storage/telemetry-schema.ts';

/** Execute the actual physics entry and production CSV export class. The test's
 * two routed origins only replace HTTP delivery, never worker results. */
export async function verifyWorkerPortability() {
  const physics = new PhysicsWorker({ name: 'apex-physics-portability-oracle' });
  const exporter = new TelemetryExport();
  let timeout: ReturnType<typeof setTimeout> | undefined;
  let surfaceCells = 0;
  let telemetryRows = 0;
  try {
    const frame = await new Promise<Float32Array>((resolve, reject) => {
      timeout = setTimeout(() => reject(new Error('Physics worker did not advance')), 20000);
      physics.onerror = (event) => reject(new Error(event.message));
      physics.onmessageerror = () => reject(new Error('Physics message deserialization failed'));
      physics.onmessage = (event: MessageEvent<FromWorker>) => {
        const message = event.data;
        if (message.type === 'error' || message.type === 'recordingWarning') {
          reject(new Error(message.message));
        } else if (message.type === 'surface') {
          if (
            !message.marbles.every(Number.isFinite) ||
            message.marbles.length !== message.water.length
          )
            reject(new Error('Invalid worker marble surface'));
          surfaceCells = message.marbles.length;
        } else if (message.type === 'frame') {
          const received = new Float32Array(message.buffer);
          const ready = received[H.TICK] >= 130 && surfaceCells > 0;
          const saved = ready ? received.slice() : null;
          physics.postMessage({ type: 'recycle', buffer: message.buffer }, [message.buffer]);
          if (saved) resolve(saved);
        } else if (message.type === 'telemetry') {
          telemetryRows += message.rows;
          physics.postMessage({ type: 'recycleTelemetry', buffer: message.buffer }, [
            message.buffer,
          ]);
        } else if (message.type === 'replayFrames') {
          physics.postMessage({ type: 'recycleReplay', buffer: message.buffer }, [message.buffer]);
        }
      };
      physics.postMessage({
        type: 'init',
        options: { ...DEFAULT_OPTIONS, mode: 'practice', opponents: 0 },
      });
      physics.postMessage({ type: 'autopilot', value: true });
      physics.postMessage({ type: 'pause', value: false });
    });
    clearTimeout(timeout);
    physics.postMessage({ type: 'pause', value: true });
    const values = new Float32Array(TELEMETRY_STRIDE);
    packTelemetry(frame, values, 0);
    const expected = Array.from(values);
    const csv = (await (await exporter.export(values, 1)).text()).trim().split('\n');
    const header = csv[0].split(',');
    const actual = csv[1].split(',').map(Number);
    return {
      documentOrigin: location.origin,
      tick: frame[H.TICK],
      finite: frame.every(Number.isFinite),
      surfaceCells,
      telemetryRows,
      csvColumns: header.length,
      pickupColumns: header.slice(-4),
      csvExact:
        expected.length === actual.length &&
        expected.every((value, index) => value === actual[index]),
    };
  } finally {
    clearTimeout(timeout);
    physics.terminate();
    exporter.cancel();
  }
}
