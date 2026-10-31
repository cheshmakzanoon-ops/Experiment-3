import { Buffer } from 'node:buffer';
import { PRIVATE_TRACE_SENTINEL, TRACE_SUMMARY_EVENTS } from './native-gpu-trace';

// Independent expected names, not imported from the production allowlist.
export const TRACE_SERVICE_API_EVENTS = [
  { id: 10, category: 'gpu', name: 'TraceGLAPI::glDrawArrays' },
  { id: 11, category: 'gpu', name: 'TraceGLAPI::glDrawArraysInstancedANGLE' },
  { id: 12, category: 'gpu', name: 'TraceGLAPI::glDrawElements' },
  { id: 13, category: 'gpu', name: 'TraceGLAPI::glDrawElementsInstancedANGLE' },
  { id: 14, category: 'gpu', name: 'TraceGLAPI::glClientWaitSync' },
  { id: 15, category: 'gpu', name: 'TraceGLAPI::glWaitSync' },
  { id: 16, category: 'gpu', name: 'TraceGLAPI::glGetSynciv' },
  { id: 17, category: 'gpu', name: 'TraceGLAPI::glFenceSync' },
  { id: 18, category: 'gpu', name: 'TraceGLAPI::glFlush' },
  { id: 19, category: 'gpu', name: 'TraceGLAPI::glFinish' },
] as const;

export const TRACE_SERVICE_API_SUMMARY_EVENTS = [
  ...TRACE_SUMMARY_EVENTS,
  ...TRACE_SERVICE_API_EVENTS,
] as const;

export type ServiceApiEventId = (typeof TRACE_SERVICE_API_EVENTS)[number]['id'];
export type NativeGpuServiceApiFixture =
  | 'metadata-only'
  | 'all-rows-completed'
  | 'isolated-open'
  | 'completed-child'
  | 'all-completed'
  | 'all-service-completed'
  | 'all-open'
  | 'compile-only-open'
  | 'compile-and-service-open'
  | 'no-parents'
  | 'no-flush'
  | 'no-decoder'
  | 'reversed-ancestors'
  | 'cross-track-child'
  | 'cross-track-decoder'
  | 'crossed-ancestors'
  | 'completed-decoder'
  | 'completed-flush'
  | 'mixed-child-tracks'
  | 'duplicate-ancestors'
  | 'self-only-flush'
  | 'self-only-decoder'
  | 'self-flush-and-decoder'
  | 'wrong-flush-category'
  | 'wrong-decoder-category'
  | 'wrong-service-category'
  | 'category-token-list'
  | 'renderer-spoof'
  | 'untyped-spoof'
  | 'privacy-negative'
  | 'annotation-spoof'
  | 'unknown-only'
  | 'unknown-nested'
  | 'truncated-packet'
  | 'truncated-after-open';

/** Fixture-only protobuf encoder, never a decoder or runtime trace producer.
 * Uses the same reviewed official Perfetto v58.2 fields as native-gpu-trace.ts:
 * https://github.com/google/perfetto/tree/v58.2/protos/perfetto/trace
 * Trace packet=1; packet timestamp=8, sequence=10, event=11, flags=13,
 * descriptor=60. TrackEvent type=9, uuid=11, category=22, name=23,
 * annotation=4. Typed Chrome process enums are GPU=6 and Renderer=2.
 * Every name/path/annotation here is synthetic. No browser/network is used.
 */
function varint(value: number): Buffer {
  if (!Number.isSafeInteger(value) || value < 0) throw new Error('Invalid fixture integer');
  const bytes: number[] = [];
  let remaining = BigInt(value);
  while (remaining >= 128n) {
    bytes.push(Number(remaining & 127n) | 128);
    remaining >>= 7n;
  }
  bytes.push(Number(remaining));
  return Buffer.from(bytes);
}

const integer = (field: number, value: number) => Buffer.concat([varint(field * 8), varint(value)]);
const message = (field: number, ...parts: Buffer[]) => {
  const bytes = Buffer.concat(parts);
  return Buffer.concat([varint(field * 8 + 2), varint(bytes.length), bytes]);
};
const string = (field: number, value: string) => message(field, Buffer.from(value));
const packet = (timestamp: number, ...parts: Buffer[]) =>
  message(1, integer(8, timestamp), integer(10, 1), ...parts);

export function nativeGpuServiceApiTraceFixture(
  kind: NativeGpuServiceApiFixture,
  apiId: ServiceApiEventId = 10,
  wrongCategory = 'gpu.angle',
): Buffer {
  if (kind === 'truncated-packet') return Buffer.from([0x0a, 0xff]);
  const rendererSpoof = kind === 'renderer-spoof';
  const untypedSpoof = kind === 'untyped-spoof';
  const spoof = rendererSpoof || untypedSpoof;
  const privateFixture = kind === 'privacy-negative';
  const process = message(
    3,
    integer(1, 100),
    string(6, spoof ? 'Gpu' : `${PRIVATE_TRACE_SENTINEL}_service_process`),
    string(2, `/private/${PRIVATE_TRACE_SENTINEL}/service-application --synthetic-secret`),
    string(8, `${PRIVATE_TRACE_SENTINEL}_service_process_label`),
  );
  const chromeProcess = untypedSpoof
    ? Buffer.alloc(0)
    : message(6, integer(1, rendererSpoof ? 2 : 6));
  const parts = [
    packet(999_000_000, integer(13, 1), message(60, integer(1, 1), process, chromeProcess)),
  ];
  // Three independent threads in the SAME typed process. Temporal overlap
  // between them must never be substituted for a same-track ancestor chain.
  for (const track of [2, 3, 4]) {
    parts.push(
      packet(
        999_000_000 + track,
        message(
          60,
          integer(1, track),
          integer(5, 1),
          string(2, `${PRIVATE_TRACE_SENTINEL}_service_track_${track}`),
          message(
            4,
            integer(1, 100),
            integer(2, 200 + track),
            string(5, spoof ? 'CrGpuMain' : `${PRIVATE_TRACE_SENTINEL}_service_thread_${track}`),
          ),
        ),
      ),
    );
  }
  if (kind === 'metadata-only') return Buffer.concat(parts);
  let time = 1_000_000_000;
  const beginName = (name: string, category = 'gpu', track = 2, annotationValue?: string) => {
    const annotation =
      privateFixture || annotationValue !== undefined
        ? message(
            4,
            string(10, `${PRIVATE_TRACE_SENTINEL}_service_annotation_key`),
            string(
              6,
              annotationValue ?? `/private/${PRIVATE_TRACE_SENTINEL}/service-annotation-value`,
            ),
          )
        : Buffer.alloc(0);
    parts.push(
      packet(
        time,
        message(
          11,
          integer(9, 1),
          integer(11, track),
          string(22, category),
          string(23, name),
          annotation,
        ),
      ),
    );
    time += 1_000_000;
  };
  const begin = (id: number, track = 2, category?: string) => {
    const event = TRACE_SERVICE_API_SUMMARY_EVENTS[id - 1];
    beginName(event.name, category ?? event.category, track);
  };
  const end = (track = 2) => {
    parts.push(packet(time, message(11, integer(9, 2), integer(11, track))));
    time += 1_000_000;
  };
  const result = () => Buffer.concat(parts);

  if (kind === 'all-rows-completed' || kind === 'all-service-completed') {
    for (const event of kind === 'all-rows-completed'
      ? TRACE_SERVICE_API_SUMMARY_EVENTS
      : TRACE_SERVICE_API_EVENTS) {
      begin(event.id);
      end();
    }
    return result();
  }
  if (kind === 'unknown-only') {
    for (const name of [
      `"\n=/${PRIVATE_TRACE_SENTINEL}/unknown-service-event`,
      'TraceGLAPI::glDrawArraysNotAllowlisted',
      'glDrawArrays',
    ]) {
      beginName(name);
      end();
    }
    return result();
  }
  if (kind === 'annotation-spoof') {
    for (const event of TRACE_SERVICE_API_SUMMARY_EVENTS) {
      beginName(`${PRIVATE_TRACE_SENTINEL}_annotation_not_a_scope`, 'gpu', 2, event.name);
    }
    return result();
  }
  if (kind === 'self-only-flush') {
    begin(1);
    return result();
  }
  if (kind === 'self-only-decoder') {
    begin(4);
    return result();
  }
  if (kind === 'no-parents') {
    begin(apiId);
    return result();
  }
  if (kind === 'no-flush') {
    begin(4);
    begin(apiId);
    return result();
  }
  if (kind === 'no-decoder') {
    begin(1);
    begin(apiId);
    return result();
  }
  if (kind === 'reversed-ancestors') {
    begin(4);
    begin(1);
    begin(apiId);
    return result();
  }
  if (kind === 'crossed-ancestors') {
    // Both parents exist and are open, but each is on a different track from
    // the child. Neither same process nor overlapping wall time joins them.
    begin(1, 2);
    begin(4, 3);
    begin(apiId, 4);
    return result();
  }
  const category = kind === 'category-token-list' ? 'gpu.angle,gpu,gpu.service' : 'gpu';
  begin(1, 2, kind === 'wrong-flush-category' ? wrongCategory : category);
  if (kind === 'duplicate-ancestors') begin(1);
  const decoderTrack = kind === 'cross-track-decoder' ? 3 : 2;
  begin(4, decoderTrack, kind === 'wrong-decoder-category' ? wrongCategory : category);
  if (kind === 'duplicate-ancestors') begin(4);
  if (kind === 'self-flush-and-decoder') return result();
  if (kind === 'unknown-nested') {
    beginName(`"\n=/${PRIVATE_TRACE_SENTINEL}/unknown-nested-service-event`);
    return result();
  }
  if (kind === 'compile-only-open' || kind === 'compile-and-service-open') {
    begin(5);
    if (kind === 'compile-and-service-open') begin(apiId);
    return result();
  }
  if (kind === 'completed-decoder' || kind === 'completed-flush') {
    // A B/E stack cannot close a parent while leaving its child open. Use a
    // completed nested instance and an unrelated same-name open instance to
    // ensure row-level marginal counts do not manufacture a joint predicate.
    begin(apiId);
    end();
    end();
    if (kind === 'completed-flush') end();
    begin(apiId);
    return result();
  }
  if (kind === 'mixed-child-tracks') {
    begin(apiId);
    end();
    begin(apiId, 3);
    return result();
  }
  if (['all-open', 'all-completed', 'privacy-negative'].includes(kind)) {
    for (const event of TRACE_SERVICE_API_EVENTS) {
      begin(event.id);
      if (kind !== 'all-open') end();
    }
    if (kind === 'privacy-negative') {
      beginName(`"\n=/${PRIVATE_TRACE_SENTINEL}/unknown-nested-service-event`);
      end();
    }
    if (kind === 'all-completed') {
      end();
      end();
    }
    return result();
  }
  const childTrack = kind === 'cross-track-child' ? 3 : decoderTrack;
  begin(apiId, childTrack, kind === 'wrong-service-category' ? wrongCategory : category);
  if (kind === 'completed-child') end();
  if (kind === 'truncated-after-open') parts.push(Buffer.from([0x0a, 0xff]));
  return result();
}
