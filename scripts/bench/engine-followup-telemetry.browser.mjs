import { TelemetryRecorder, CHANNELS } from "engine:current";
import { TelemetryExport } from "engine:export";
import {
  appendCsvRows,
  compareCsvStream,
  fillCsvRows,
} from "./engine-followup-telemetry.fixture.mjs";

export async function run(capacity) {
  if (capacity !== 54000)
    throw new Error(
      "Native probe is bounded to the default 54000-row capacity",
    );
  const recorder = new TelemetryRecorder();
  if (recorder.capacity !== capacity || recorder.stride !== 228)
    throw new Error("Recorder defaults changed");
  appendCsvRows(recorder, 0, capacity + 243);
  const startedSnapshot = performance.now();
  const snapshot = recorder.snapshot();
  const snapshotMs = performance.now() - startedSnapshot;
  const byteLength = snapshot.byteLength;
  const expectedRow = new Float32Array(recorder.stride);
  let snapshotDifferences = 0;
  const snapshotWords = new Uint32Array(snapshot.buffer);
  const expectedWords = new Uint32Array(expectedRow.buffer);
  for (let row = 0; row < capacity; row++) {
    fillCsvRows(expectedRow, 243 + row, 1, recorder.stride);
    for (let field = 0; field < recorder.stride; field++)
      if (snapshotWords[row * recorder.stride + field] !== expectedWords[field])
        snapshotDifferences++;
  }
  if (snapshotDifferences) throw new Error("Native snapshot bytes differ");
  const nativeTerminate = Worker.prototype.terminate;
  let terminations = 0;
  Worker.prototype.terminate = function () {
    terminations++;
    return nativeTerminate.call(this);
  };
  const exporter = new TelemetryExport();
  try {
    const startedExport = performance.now();
    const completion = exporter.export(snapshot, recorder.count);
    const synchronousExportCallMs = performance.now() - startedExport;
    const senderSnapshotDetached = snapshot.byteLength === 0;
    if (!senderSnapshotDetached)
      throw new Error("Native transfer did not detach snapshot");
    const startedContinuing = performance.now();
    appendCsvRows(recorder, capacity + 243, 120);
    const continuingAppendMs = performance.now() - startedContinuing;
    const blob = await completion;
    const exportCompletionMs = performance.now() - startedExport;
    const startedVerification = performance.now();
    // Inspect the actual ring directly through its public chronological accessor,
    // retaining no second full snapshot while the worker holds the transferred one.
    let continuingDifferences = 0;
    for (let row = 0; row < capacity; row++) {
      fillCsvRows(expectedRow, 363 + row, 1, recorder.stride);
      for (let field = 0; field < recorder.stride; field++)
        if (!Object.is(recorder.at(row, field), expectedRow[field]))
          continuingDifferences++;
    }
    if (continuingDifferences)
      throw new Error("Continued recording lost chronology");
    const exact = await compareCsvStream(blob, CHANNELS, 243, capacity);
    const verificationMs = performance.now() - startedVerification;
    if (terminations !== 1)
      throw new Error(
        `Expected one worker termination, received ${terminations}`,
      );
    return {
      kind: "csv-native-browser",
      capacity,
      columns: recorder.stride,
      snapshotBytes: byteLength,
      ringBytes: capacity * recorder.stride * 4,
      combinedRingAndTransferredInputBytes:
        byteLength + capacity * recorder.stride * 4,
      snapshotMs,
      snapshotDifferences,
      senderSnapshotDetached,
      synchronousExportCallMs,
      exportCompletionMs,
      continuingRowsAppended: 120,
      continuingAppendMs,
      continuingDifferences,
      csvBytes: blob.size,
      mime: blob.type,
      exact,
      verificationMs,
      terminations,
      workerStartupIncludedInExportCompletion: true,
      fullMainThreadCsvCopiesRetained: 0,
      peakBrowserMemoryMeasured: false,
      limits: [
        "One cold native worker export; no paired browser latency claim.",
        "Export completion includes startup, production CSV formatting, Blob construction, transfer, and worker release.",
        "The main thread appends 120 rows before awaiting the worker; ring and exact streamed verification occur after completion.",
        "Verification is timed separately from export completion.",
        "Browser worker peak memory and the 216000-row maximum were not measured.",
      ],
    };
  } finally {
    exporter.cancel();
    Worker.prototype.terminate = nativeTerminate;
  }
}
