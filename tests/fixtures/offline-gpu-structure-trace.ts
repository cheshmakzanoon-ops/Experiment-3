import { Buffer } from 'node:buffer';

// Synthetic fixture encoder only. Field provenance: official Perfetto v58.2
// trace_packet.proto (trace_stats=35); trace_stats.proto (buffer_stats=1,
// chunks_overwritten=3, final_flush_outcome=15). Track/process/event fields
// match the independently retained native-gpu-trace fixture encoder.
export const STRUCTURE_PRIVATE = 'PRIVATE_STRUCTURE_FIXTURE_DO_NOT_EXPORT';
export type StructuralOperation =
  | { kind: 'begin'; name?: string; category?: string; track?: number; annotation?: string }
  | { kind: 'end'; track?: number };
export interface StructuralTraceOptions {
  processType?: 2 | 6 | null;
  processName?: string;
  overwrittenChunks?: number;
  finalFlush?: 0 | 1 | 2;
  truncatePacket?: boolean;
}
function varint(value: number): Buffer {
  if (!Number.isSafeInteger(value) || value < 0) throw new Error('Invalid fixture integer');
  let n = BigInt(value);
  const out: number[] = [];
  while (n >= 128n) {
    out.push(Number(n & 127n) | 128);
    n >>= 7n;
  }
  out.push(Number(n));
  return Buffer.from(out);
}
const integer = (field: number, value: number) => Buffer.concat([varint(field * 8), varint(value)]);
const message = (field: number, ...parts: Buffer[]) => {
  const bytes = Buffer.concat(parts);
  return Buffer.concat([varint(field * 8 + 2), varint(bytes.length), bytes]);
};
const string = (field: number, value: string) => message(field, Buffer.from(value));
const packet = (time: number, ...parts: Buffer[]) =>
  message(1, integer(8, time), integer(10, 1), ...parts);

export function structuralTraceFixture(
  operations: StructuralOperation[],
  options: StructuralTraceOptions = {},
): Buffer {
  const parts: Buffer[] = [];
  const type = options.processType === undefined ? 6 : options.processType;
  for (const [uuid, pid] of [
    [1, 100],
    [10, 101],
  ]) {
    parts.push(
      packet(
        999_000_000,
        integer(13, 1),
        message(
          60,
          integer(1, uuid),
          message(
            3,
            integer(1, pid),
            string(6, options.processName ?? STRUCTURE_PRIVATE),
            string(2, `/private/${STRUCTURE_PRIVATE}/application --secret`),
            string(8, STRUCTURE_PRIVATE),
          ),
          ...(type === null ? [] : [message(6, integer(1, type))]),
        ),
      ),
    );
  }
  for (const track of [2, 3, 4, 5]) {
    const second = track === 5;
    parts.push(
      packet(
        999_000_000 + track,
        message(
          60,
          integer(1, track),
          integer(5, second ? 10 : 1),
          string(2, STRUCTURE_PRIVATE),
          message(
            4,
            integer(1, second ? 101 : 100),
            integer(2, 200 + track),
            string(5, 'CrGpuMain'),
          ),
        ),
      ),
    );
  }
  let time = 1_000_000_000;
  for (const operation of operations) {
    const data =
      operation.kind === 'end'
        ? message(11, integer(9, 2), integer(11, operation.track ?? 2))
        : message(
            11,
            integer(9, 1),
            integer(11, operation.track ?? 2),
            string(22, operation.category ?? 'gpu'),
            ...(operation.name === undefined ? [] : [string(23, operation.name)]),
            message(
              4,
              string(10, STRUCTURE_PRIVATE),
              string(6, operation.annotation ?? `/private/${STRUCTURE_PRIVATE}/annotation`),
            ),
          );
    parts.push(packet(time, data));
    time += 1_000_000;
  }
  if (options.overwrittenChunks !== undefined || options.finalFlush !== undefined) {
    parts.push(
      packet(
        time,
        message(
          35,
          ...(options.overwrittenChunks === undefined
            ? []
            : [message(1, integer(3, options.overwrittenChunks))]),
          ...(options.finalFlush === undefined ? [] : [integer(15, options.finalFlush)]),
        ),
      ),
    );
  }
  if (options.truncatePacket) parts.push(Buffer.from([0x0a, 0xff]));
  return Buffer.concat(parts);
}
