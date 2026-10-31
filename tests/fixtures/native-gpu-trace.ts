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

export const TRACE_SUMMARY_EVENTS = [
  ...TRACE_FIXTURE_EVENTS.map(({ id, name }) => ({ id, name, category: 'gpu' })),
  { id: 4, name: 'CommandBufferService:PutChanged', category: 'gpu' },
  { id: 5, name: 'GLES2DecoderPassthroughImpl::DoLinkProgram', category: 'gpu' },
  { id: 6, name: 'CompileEvent::wait', category: 'gpu.angle' },
  { id: 7, name: 'Program::MainLinkLoadEvent::wait', category: 'gpu.angle' },
  { id: 8, name: 'ProgramGL::linkJobImpl', category: 'gpu.angle' },
  { id: 9, name: 'ProgramGL::postLinkJobImpl', category: 'gpu.angle' },
] as const;

export type NativeGpuTraceFixture =
  | 'valid'
  | 'metadata-only'
  | 'privacy-negative'
  | 'renderer-spoof'
  | 'untyped-spoof'
  | 'unknown-only'
  | 'wrong-category'
  | 'unfinished'
  | 'nested-completed-child'
  | 'nested-unfinished-child'
  | 'completed-flush'
  | 'cross-track-overlap'
  | 'mixed-link-tracks'
  | 'wrong-ancestor-category'
  | 'wrong-child-category'
  | 'nested-renderer-spoof'
  | 'nested-untyped-spoof'
  | 'nested-privacy-negative'
  | `nested-only-${5 | 6 | 7 | 8 | 9}`
  | 'double-unfinished-flush'
  | 'self-only-unfinished-flush';

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

function sliceBegin(
  timestamp: number,
  track: number,
  name: string,
  category: string,
  privateFixture: boolean,
) {
  const annotation = privateFixture
    ? message(
        4,
        string(10, `${PRIVATE_TRACE_SENTINEL}_annotation_key`),
        string(6, `/private/${PRIVATE_TRACE_SENTINEL}/annotation-value`),
      )
    : Buffer.alloc(0);
  return packet(
    timestamp,
    message(
      11,
      integer(9, 1), // TYPE_SLICE_BEGIN.
      integer(11, track),
      string(22, category),
      string(23, name),
      annotation,
    ),
  );
}

const sliceEnd = (timestamp: number, track: number) =>
  packet(timestamp, message(11, integer(9, 2), integer(11, track)));

export function nativeGpuTraceFixture(kind: NativeGpuTraceFixture): Buffer {
  const privateFixture = kind === 'privacy-negative' || kind === 'nested-privacy-negative';
  const rendererSpoof = kind === 'renderer-spoof' || kind === 'nested-renderer-spoof';
  const untypedSpoof = kind === 'untyped-spoof' || kind === 'nested-untyped-spoof';
  const spoof = rendererSpoof || untypedSpoof;
  const process = message(
    3,
    integer(1, 100),
    string(6, spoof ? 'Gpu' : `${PRIVATE_TRACE_SENTINEL}_process`),
    string(2, `/private/${PRIVATE_TRACE_SENTINEL}/application --synthetic-secret`),
    string(8, `${PRIVATE_TRACE_SENTINEL}_process_label`),
  );
  const chromeProcess = untypedSpoof
    ? Buffer.alloc(0)
    : message(6, integer(1, rendererSpoof ? 2 : 6));
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
  if (
    kind.startsWith('nested-') ||
    [
      'completed-flush',
      'cross-track-overlap',
      'mixed-link-tracks',
      'wrong-ancestor-category',
      'wrong-child-category',
      'double-unfinished-flush',
      'self-only-unfinished-flush',
    ].includes(kind)
  ) {
    // All timestamps are monotonic. Track 3 is a distinct thread in the SAME
    // typed process: wall-clock overlap cannot manufacture slice ancestry.
    if (kind === 'cross-track-overlap' || kind === 'mixed-link-tracks') {
      parts.push(
        packet(
          999_000_002,
          message(
            60,
            integer(1, 3),
            integer(5, 1),
            string(2, `${PRIVATE_TRACE_SENTINEL}_second_track`),
            message(4, integer(1, 100), integer(2, 201), string(5, 'CrGpuMain')),
          ),
        ),
      );
    }
    let time = 1_000_000_000;
    const begin = (id: number, track = 2, category?: string) => {
      const event = TRACE_SUMMARY_EVENTS[id - 1];
      parts.push(sliceBegin(time, track, event.name, category ?? event.category, privateFixture));
      time += 1_000_000;
    };
    const end = (track = 2) => {
      parts.push(sliceEnd(time, track));
      time += 1_000_000;
    };
    begin(1, 2, kind === 'wrong-ancestor-category' ? 'gpu.angle' : 'gpu');
    if (kind === 'self-only-unfinished-flush') return Buffer.concat(parts);
    if (kind === 'double-unfinished-flush') {
      begin(1);
      begin(5);
      end();
      return Buffer.concat(parts);
    }
    begin(4);
    if (kind === 'mixed-link-tracks') {
      // Same fixed name, distinct slices: the completed nested link must not
      // borrow the unfinished flag from an unrelated link on another thread.
      begin(5);
      end();
      begin(5, 3);
      return Buffer.concat(parts);
    }
    const childTrack = kind === 'cross-track-overlap' ? 3 : 2;
    for (const event of TRACE_SUMMARY_EVENTS.slice(4)) {
      if (kind.startsWith('nested-only-') && event.id !== Number(kind.slice('nested-only-'.length)))
        continue;
      const category =
        kind === 'wrong-child-category'
          ? event.category === 'gpu'
            ? 'gpu.angle'
            : 'gpu'
          : event.category;
      begin(event.id, childTrack, category);
      if (kind !== 'nested-unfinished-child' && !kind.startsWith('nested-only-')) end(childTrack);
    }
    if (kind === 'nested-privacy-negative') {
      parts.push(
        sliceBegin(time, 2, `${PRIVATE_TRACE_SENTINEL}/unknown-nested-event`, 'gpu', true),
      );
      time += 1_000_000;
      end();
    }
    if (kind === 'completed-flush') {
      end();
      end();
    }
    return Buffer.concat(parts);
  }
  const known = kind === 'unknown-only' ? [] : TRACE_FIXTURE_EVENTS;
  const events = [
    ...known,
    ...(privateFixture || kind === 'unknown-only'
      ? [{ id: 4, name: `"\n=/${PRIVATE_TRACE_SENTINEL}/unknown-event`, durationNs: 1_000_000 }]
      : []),
  ];
  for (const event of events) {
    const start = 1_000_000_000 + (event.id - 1) * 20_000_000;
    parts.push(
      sliceBegin(
        start,
        2,
        event.name,
        kind === 'wrong-category' ? 'toplevel' : 'gpu',
        privateFixture,
      ),
    );
    if (kind !== 'unfinished' || event.id !== 3) parts.push(sliceEnd(start + event.durationNs, 2));
  }
  return Buffer.concat(parts);
}
