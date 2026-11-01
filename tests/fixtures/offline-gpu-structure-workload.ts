import { Buffer } from 'node:buffer';
import { open } from 'node:fs/promises';
import { structuralTraceFixture, STRUCTURE_PRIVATE } from './offline-gpu-structure-trace';

// Explicitly synthetic protobuf only; no historical/native input is read.
// TrackEvent field numbers are identical to the frozen fixture. Unknown field
// 1000 inside a TracePacket supplies inert padding, independently of slice
// density/depth. Padding-byte size is NOT representative real-trace complexity.
export interface StructuralWorkload {
  targetBytes: number;
  scopeCount: number;
  depth: number;
  qualifyingParents: boolean;
  openUnselected: boolean;
}
const varint = (value: number) => {
  if (!Number.isSafeInteger(value) || value < 0) throw new Error('Invalid synthetic integer');
  const bytes: number[] = [];
  let n = BigInt(value);
  while (n >= 128n) {
    bytes.push(Number(n & 127n) | 128);
    n >>= 7n;
  }
  bytes.push(Number(n));
  return Buffer.from(bytes);
};
const integer = (field: number, value: number) => Buffer.concat([varint(field * 8), varint(value)]);
const prefix = (field: number, bytes: number) =>
  Buffer.concat([varint(field * 8 + 2), varint(bytes)]);
const message = (field: number, ...parts: Buffer[]) => {
  const bytes = Buffer.concat(parts);
  return Buffer.concat([prefix(field, bytes.length), bytes]);
};
const string = (field: number, value: string) => message(field, Buffer.from(value));

export async function writeStructuralWorkload(path: string, spec: StructuralWorkload) {
  if (
    !Number.isSafeInteger(spec.targetBytes) ||
    spec.targetBytes < 4096 ||
    spec.targetBytes > 64 * 1024 * 1024 ||
    !Number.isSafeInteger(spec.scopeCount) ||
    spec.scopeCount < 0 ||
    spec.scopeCount > 150_000 ||
    !Number.isSafeInteger(spec.depth) ||
    spec.depth < 1 ||
    spec.depth > 256 ||
    typeof spec.qualifyingParents !== 'boolean' ||
    typeof spec.openUnselected !== 'boolean'
  )
    throw new Error('Invalid synthetic workload');
  const handle = await open(path, 'wx', 0o600);
  const queued: Buffer[] = [];
  let queuedBytes = 0;
  let written = 0;
  let eventPackets = 0;
  let paddingPackets = 0;
  let timestamp = 1_000_000_000;
  const counts = [1, 0, 0];
  const flush = async () => {
    if (!queuedBytes) return;
    await handle.writeFile(Buffer.concat(queued, queuedBytes));
    written += queuedBytes;
    queued.length = 0;
    queuedBytes = 0;
  };
  const append = async (bytes: Buffer) => {
    if (bytes.length > 64 * 1024 || written + queuedBytes + bytes.length > spec.targetBytes)
      throw new Error('Synthetic workload exceeds fixed byte target');
    if (queuedBytes + bytes.length > 64 * 1024) await flush();
    queued.push(bytes);
    queuedBytes += bytes.length;
  };
  const event = async (name?: string) => {
    const payload =
      name === undefined
        ? message(11, integer(9, 2), integer(11, 2))
        : message(11, integer(9, 1), integer(11, 2), string(22, 'gpu'), string(23, name));
    await append(message(1, integer(8, timestamp), integer(10, 1), payload));
    timestamp += 1000;
    eventPackets++;
  };
  try {
    await append(structuralTraceFixture([]));
    await event('TraceGLAPI::glDrawElements');
    await event();
    if (spec.qualifyingParents) {
      await event('CommandBufferStub::OnAsyncFlush');
      await event('CommandBufferService:PutChanged');
    }
    const names = ['TraceGLAPI::glDrawElements', 'TraceGLAPI::glClear', STRUCTURE_PRIVATE];
    for (let start = 0; start < spec.scopeCount; start += spec.depth) {
      const count = Math.min(spec.depth, spec.scopeCount - start);
      for (let offset = 0; offset < count; offset++) {
        const bucket = (start + offset) % 3;
        await event(names[bucket]);
        counts[bucket]++;
      }
      for (let offset = 0; offset < count; offset++) await event();
    }
    if (spec.openUnselected) {
      await event('TraceGLAPI::glClear');
      counts[1]++;
    }
    await flush();
    const prePaddingBytes = written;
    const padding = Buffer.alloc(60 * 1024);
    while (written + queuedBytes < spec.targetBytes) {
      const remaining = spec.targetBytes - written - queuedBytes;
      if (remaining < 5) throw new Error('Unrepresentable synthetic padding');
      let size = Math.min(padding.length, remaining);
      let inner: Buffer;
      let outer: Buffer;
      for (;;) {
        inner = prefix(1000, size);
        outer = prefix(1, inner.length + size);
        const total = inner.length + outer.length + size;
        if (total <= remaining && (remaining === total || remaining - total >= 5)) break;
        size--;
      }
      await append(Buffer.concat([outer, inner, padding.subarray(0, size)]));
      paddingPackets++;
    }
    await flush();
    return {
      inputBytes: written,
      prePaddingBytes,
      paddingBytes: written - prePaddingBytes,
      descriptorPackets: 6,
      eventPackets,
      paddingPackets,
      totalPackets: 6 + eventPackets + paddingPackets,
      bucketCounts: counts,
      expectedCoverageMask: spec.qualifyingParents && spec.openUnselected ? 2 : 0,
      maximumScopeDepth: Math.max(
        1,
        (spec.qualifyingParents ? 2 : 0) +
          Math.max(Math.min(spec.depth, spec.scopeCount), spec.openUnselected ? 1 : 0),
      ),
    };
  } finally {
    await handle.close();
  }
}
