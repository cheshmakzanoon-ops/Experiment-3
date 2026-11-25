/** Deterministic finite inputs shared by the Node and native-browser probes. */
export function fillCsvRows(values, start, rows, stride) {
  for (let row = 0; row < rows; row++)
    for (let column = 0; column < stride; column++)
      values[row * stride + column] =
        ((((start + row) * 17 + column * 3) % 8192) - 4096) / 64;
  return values;
}

export function fillSnapshotRows(
  values,
  start,
  rows,
  stride,
  sessionColumn,
  tickColumn,
  branch = 0,
) {
  fillCsvRows(values, start + branch * 100003, rows, stride);
  for (let row = 0; row < rows; row++) {
    const offset = row * stride;
    // Equal, exactly representable practice/session clocks isolate snapshot()
    // from the intentionally changed race-clock truncation semantics.
    values[offset] = values[offset + sessionColumn] = (start + row) / 64;
    values[offset + tickColumn] = (start + row) * 2;
    values[offset + 7] = (start + row) % 2 ? -0 : 0;
    values[offset + 8] = Math.fround((((start + row) % 997) - 498) / 37);
  }
  return values;
}

export function appendCsvRows(recorder, start, rows) {
  const batch = new Float32Array(60 * recorder.stride);
  for (let offset = 0; offset < rows; offset += 60) {
    const count = Math.min(60, rows - offset);
    fillCsvRows(batch, start + offset, count, recorder.stride);
    recorder.appendBatch(batch, count);
  }
}

/** Independent expected text, retained only one 500-row chunk at a time. */
export function* csvExpectedChunks(channels, start, count) {
  yield channels.join(",") + "\n";
  const stride = channels.length;
  for (let offset = 0; offset < count; offset += 500) {
    const rows = [];
    for (let row = offset; row < Math.min(count, offset + 500); row++) {
      const columns = [];
      for (let column = 0; column < stride; column++)
        columns.push(
          String(((((start + row) * 17 + column * 3) % 8192) - 4096) / 64),
        );
      rows.push(columns.join(","));
    }
    yield rows.join("\n") + "\n";
  }
}

/** Compare every byte without materializing a second full CSV or Blob.text(). */
export async function compareCsvStream(
  blob,
  channels,
  start,
  count,
  consume = () => {},
) {
  const expected = csvExpectedChunks(channels, start, count);
  const encoder = new TextEncoder();
  let part = encoder.encode(expected.next().value);
  let cursor = 0;
  let compared = 0;
  let mismatches = 0;
  let firstMismatch = null;
  let expectedChunks = 1;
  for await (const bytes of blob.stream()) {
    consume(bytes);
    for (let index = 0; index < bytes.length; index++) {
      if (cursor === part.length) {
        const next = expected.next();
        if (next.done)
          throw new Error("CSV contains unexpected trailing bytes");
        part = encoder.encode(next.value);
        cursor = 0;
        expectedChunks++;
      }
      if (bytes[index] !== part[cursor]) {
        mismatches++;
        firstMismatch ??= compared;
      }
      cursor++;
      compared++;
    }
  }
  if (cursor !== part.length || !expected.next().done)
    throw new Error("CSV ended before the independent expected output");
  if (compared !== blob.size)
    throw new Error("Blob stream byte count mismatch");
  if (mismatches)
    throw new Error(
      `CSV differs at ${mismatches} bytes, first ${firstMismatch}`,
    );
  return {
    comparedBytes: compared,
    differingBytes: mismatches,
    expectedChunks,
  };
}
