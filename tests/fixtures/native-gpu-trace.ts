import { Buffer } from 'node:buffer';

/** Tiny fixture-only protobuf encoder, not a decoder or a trace implementation.
 * Field numbers/enums are from the reviewed official Perfetto v58.2 schemas:
 * https://github.com/google/perfetto/tree/v58.2/protos/perfetto/trace
 * trace.proto: packet=1; trace_packet.proto: timestamp=8, sequence=10,
 * track_event=11, sequence_flags=13, track_descriptor=60.
 * track_event/{track_descriptor,process_descriptor,thread_descriptor,
 * chrome_process_descriptor,track_event,debug_annotation}.proto define the
 * nested fields below. chrome_enums.proto defines GPU=6 and Renderer=2.
 * All fixture names/annotations are synthetic and safe to keep in source.
 */
export const PRIVATE_TRACE_SENTINEL = 'PRIVATE_TRACE_FIXTURE_DO_NOT_PUBLISH';

export const TRACE_FIXTURE_EVENTS = [
  { id: 1, name: 'CommandBufferStub::OnAsyncFlush', durationNs: 10_000_000 },
  { id: 2, name: 'CommandBufferStub::PerformWork', durationNs: 2_000_000 },
  { id: 3, name: 'Scheduler::RunTask', durationNs: 3_000_000 },
] as const;

export type NativeGpuTraceFixture =
  | 'valid'
  | 'metadata-only'
  | 'privacy-negative'
  | 'renderer-spoof'
  | 'untyped-spoof'
  | 'unknown-only'
  | 'wrong-category'
  | 'unfinished';

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

export function nativeGpuTraceFixture(kind: NativeGpuTraceFixture): Buffer {
  const privateFixture = kind === 'privacy-negative';
  const spoof = kind === 'renderer-spoof' || kind === 'untyped-spoof';
  const process = message(
    3,
    integer(1, 100),
    string(6, spoof ? 'Gpu' : `${PRIVATE_TRACE_SENTINEL}_process`),
    string(2, `/private/${PRIVATE_TRACE_SENTINEL}/application --synthetic-secret`),
    string(8, `${PRIVATE_TRACE_SENTINEL}_process_label`),
  );
  const chromeProcess =
    kind === 'untyped-spoof'
      ? Buffer.alloc(0)
      : message(6, integer(1, kind === 'renderer-spoof' ? 2 : 6));
  const parts = [
    packet(
      999_000_000,
      integer(13, 1), // SEQ_INCREMENTAL_STATE_CLEARED.
      message(60, integer(1, 1), process, chromeProcess),
    ),
    packet(
      999_000_001,
      message(
        60,
        integer(1, 2),
        integer(5, 1),
        string(2, `${PRIVATE_TRACE_SENTINEL}_track`),
        message(
          4,
          integer(1, 100),
          integer(2, 200),
          string(5, spoof ? 'CrGpuMain' : `${PRIVATE_TRACE_SENTINEL}_thread`),
        ),
      ),
    ),
  ];
  if (kind === 'metadata-only') return Buffer.concat(parts);
  const known = kind === 'unknown-only' ? [] : TRACE_FIXTURE_EVENTS;
  const events = [
    ...known,
    ...(privateFixture || kind === 'unknown-only'
      ? [{ id: 4, name: `"\n=/${PRIVATE_TRACE_SENTINEL}/unknown-event`, durationNs: 1_000_000 }]
      : []),
  ];
  for (const event of events) {
    const start = 1_000_000_000 + (event.id - 1) * 20_000_000;
    const annotation = privateFixture
      ? message(
          4,
          string(10, `${PRIVATE_TRACE_SENTINEL}_annotation_key`),
          string(6, `/private/${PRIVATE_TRACE_SENTINEL}/annotation-value`),
        )
      : Buffer.alloc(0);
    parts.push(
      packet(
        start,
        message(
          11,
          integer(9, 1), // TYPE_SLICE_BEGIN.
          integer(11, 2),
          string(22, kind === 'wrong-category' ? 'toplevel' : 'gpu'),
          string(23, event.name),
          annotation,
        ),
      ),
    );
    if (kind !== 'unfinished' || event.id !== 3)
      parts.push(packet(start + event.durationNs, message(11, integer(9, 2), integer(11, 2))));
  }
  return Buffer.concat(parts);
}
