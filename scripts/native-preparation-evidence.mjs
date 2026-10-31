import { writeFile, rename } from 'node:fs/promises';

export const NATIVE_PREPARATION_CAPTURE = Object.freeze({
  prefix: '__MOTOBOUND_NATIVE_PREPARATION__',
  maxPackets: 2048,
  maxPacketBytes: 98304,
  maxDetailBytes: 32768,
});

/** Serialized by Playwright before compatibility navigation. Deliberately
 * self-contained: listen only to existing preparation checkpoints, with no
 * RAF, GL, timer, DOM mutation, or performance hooks. */
export function installNativePreparationObserver(config) {
  const origin = performance.timeOrigin;
  const documentId = crypto.randomUUID();
  const url = location.href.slice(0, 512);
  const encoder = new TextEncoder();
  const phases = new Set(['start', 'end', 'error', 'cancelled', 'mark']);
  let sequence = 0,
    dropped = 0,
    truncated = 0;
  const integer = (value) => Number.isSafeInteger(value) && value > 0;
  window.addEventListener('apex-preparation-checkpoint', (event) => {
    // The final emitted packet explicitly says subsequent omissions are unknown.
    if (sequence >= config.maxPackets) return;
    try {
      const source = event.detail;
      if (
        !source ||
        !integer(source.run) ||
        !integer(source.sequence) ||
        !integer(source.span) ||
        !phases.has(source.phase) ||
        typeof source.label !== 'string' ||
        !Number.isFinite(source.at) ||
        source.at < 0
      ) {
        dropped++;
        return;
      }
      const checkpoint = {
        run: source.run,
        sequence: source.sequence,
        span: source.span,
        phase: source.phase,
        label: source.label.slice(0, 160),
        at: source.at,
      };
      if (source.label.length > 160) truncated++;
      if (source.detailJSON !== undefined) {
        try {
          if (
            typeof source.detailJSON !== 'string' ||
            source.detailJSON.length > config.maxDetailBytes ||
            encoder.encode(source.detailJSON).byteLength > config.maxDetailBytes
          )
            throw new Error('detail limit');
          JSON.parse(source.detailJSON);
          checkpoint.detailJSON = source.detailJSON;
        } catch {
          checkpoint.detailJSON = JSON.stringify({
            truncated: true,
            reason: 'invalid-or-oversized-detail',
          });
          truncated++;
        }
      }
      const packet = JSON.stringify({
        version: 1,
        documentId,
        origin,
        url,
        sequence: sequence + 1,
        dropped,
        truncated,
        sourceCapped: sequence + 1 === config.maxPackets,
        checkpoint,
      });
      if (encoder.encode(packet).byteLength > config.maxPacketBytes) {
        dropped++;
        return;
      }
      sequence++;
      // Emit before returning to the synchronous operation that may block.
      console.debug(config.prefix + packet);
    } catch {
      // Observation cannot alter preparation or replace its original failure.
      dropped++;
    }
  });
}

/** Strict, bounded Node-owned evidence. Never spread untrusted packet fields
 * into reports or index an object by document IDs. No GPU-health state changes. */
export function createNativePreparationSink(options = {}) {
  const limits = { maxEvents: 512, maxBytes: 2 * 1024 * 1024, maxDocuments: 32, ...options };
  if (
    !Number.isSafeInteger(limits.maxEvents) ||
    limits.maxEvents < 1 ||
    limits.maxEvents > 4096 ||
    !Number.isSafeInteger(limits.maxBytes) ||
    limits.maxBytes < 256 ||
    limits.maxBytes > 8 * 1024 * 1024 ||
    !Number.isSafeInteger(limits.maxDocuments) ||
    limits.maxDocuments < 1 ||
    limits.maxDocuments > 64
  )
    throw new Error('Invalid native preparation evidence limits');
  const encoder = new TextEncoder();
  const documents = new Map();
  const records = [];
  const stats = {
    received: 0,
    accepted: 0,
    rejected: 0,
    oversizedPackets: 0,
    reorderedPackets: 0,
    documentLimitPackets: 0,
    truncatedDetails: 0,
    evictedEvents: 0,
    evictedBytes: 0,
  };
  let retainedBytes = 0;
  const integer = (value, min = 0) => Number.isSafeInteger(value) && value >= min;
  const object = (value) => value !== null && typeof value === 'object' && !Array.isArray(value);
  const phases = new Set(['start', 'end', 'error', 'cancelled', 'mark']);
  return {
    consume(text, receivedAt = Date.now()) {
      if (typeof text !== 'string' || !text.startsWith(NATIVE_PREPARATION_CAPTURE.prefix))
        return false;
      stats.received++;
      const raw = text.slice(NATIVE_PREPARATION_CAPTURE.prefix.length);
      if (
        raw.length > NATIVE_PREPARATION_CAPTURE.maxPacketBytes ||
        encoder.encode(raw).byteLength > NATIVE_PREPARATION_CAPTURE.maxPacketBytes
      ) {
        stats.rejected++;
        stats.oversizedPackets++;
        return true;
      }
      let packet;
      try {
        packet = JSON.parse(raw);
      } catch {
        stats.rejected++;
        return true;
      }
      const c = packet?.checkpoint;
      if (
        !object(packet) ||
        packet.version !== 1 ||
        typeof packet.documentId !== 'string' ||
        !/^[A-Za-z0-9._:-]{1,128}$/.test(packet.documentId) ||
        !Number.isFinite(packet.origin) ||
        packet.origin < 0 ||
        typeof packet.url !== 'string' ||
        packet.url.length > 512 ||
        !integer(packet.sequence, 1) ||
        packet.sequence > NATIVE_PREPARATION_CAPTURE.maxPackets ||
        !integer(packet.dropped) ||
        !integer(packet.truncated) ||
        typeof packet.sourceCapped !== 'boolean' ||
        !Number.isFinite(receivedAt) ||
        receivedAt < 0 ||
        !object(c) ||
        !integer(c.run, 1) ||
        !integer(c.sequence, 1) ||
        !integer(c.span, 1) ||
        !phases.has(c.phase) ||
        typeof c.label !== 'string' ||
        !Number.isFinite(c.at) ||
        c.at < 0 ||
        (c.detailJSON !== undefined && typeof c.detailJSON !== 'string')
      ) {
        stats.rejected++;
        return true;
      }
      let doc = documents.get(packet.documentId);
      if (
        doc &&
        (doc.origin !== packet.origin ||
          doc.url !== packet.url ||
          packet.sequence <= doc.lastSequence)
      ) {
        stats.rejected++;
        stats.reorderedPackets++;
        return true;
      }
      if (!doc && documents.size >= limits.maxDocuments) {
        stats.rejected++;
        stats.documentLimitPackets++;
        return true;
      }
      const checkpoint = {
        run: c.run,
        sequence: c.sequence,
        span: c.span,
        phase: c.phase,
        label: c.label.slice(0, 160),
        at: c.at,
      };
      if (c.detailJSON !== undefined) {
        try {
          if (
            c.detailJSON.length > NATIVE_PREPARATION_CAPTURE.maxDetailBytes ||
            encoder.encode(c.detailJSON).byteLength > NATIVE_PREPARATION_CAPTURE.maxDetailBytes
          )
            throw new Error('detail limit');
          JSON.parse(c.detailJSON);
          checkpoint.detailJSON = c.detailJSON;
        } catch {
          checkpoint.detailJSON = JSON.stringify({
            truncated: true,
            reason: 'invalid-or-oversized-detail',
          });
          stats.truncatedDetails++;
        }
      }
      if (!doc) {
        doc = {
          documentId: packet.documentId,
          origin: packet.origin,
          url: packet.url,
          lastSequence: 0,
          missingPackets: 0,
          sourceDropped: 0,
          sourceTruncated: 0,
          sourceCapped: false,
        };
        documents.set(packet.documentId, doc);
      }
      doc.missingPackets += packet.sequence - doc.lastSequence - 1;
      doc.lastSequence = packet.sequence;
      doc.sourceDropped = Math.max(doc.sourceDropped, packet.dropped);
      doc.sourceTruncated = Math.max(doc.sourceTruncated, packet.truncated);
      doc.sourceCapped ||= packet.sourceCapped;
      const json = JSON.stringify({
        documentId: packet.documentId,
        origin: packet.origin,
        url: packet.url,
        sequence: packet.sequence,
        receivedAt,
        checkpoint,
      });
      const bytes = encoder.encode(json).byteLength;
      records.push({ json, bytes });
      retainedBytes += bytes;
      stats.accepted++;
      while (records.length > limits.maxEvents || retainedBytes > limits.maxBytes) {
        const removed = records.shift();
        retainedBytes -= removed.bytes;
        stats.evictedEvents++;
        stats.evictedBytes += removed.bytes;
      }
      return true;
    },
    snapshot() {
      return {
        version: 1,
        limits: { ...limits },
        ...stats,
        retainedBytes,
        documents: [...documents.values()].map((doc) => ({ ...doc })),
        events: records.map(({ json }) => JSON.parse(json)),
      };
    },
  };
}

/** Coalesce writes without a timer or unbounded promise queue. Atomic rename
 * keeps the last valid bounded JSON snapshot if the process is interrupted. */
export function createNativePreparationWriter(path) {
  let pending = null,
    writing = null,
    error = null;
  const run = async () => {
    try {
      while (pending !== null) {
        const json = pending;
        pending = null;
        await writeFile(`${path}.tmp`, json + '\n');
        await rename(`${path}.tmp`, path);
      }
    } catch (failure) {
      error = String(failure);
      pending = null;
    } finally {
      writing = null;
    }
  };
  return {
    update(snapshot) {
      if (error) return;
      pending = JSON.stringify(snapshot);
      if (!writing) writing = run();
    },
    async flush() {
      if (writing) await writing;
      return error;
    },
  };
}

/** Serialized into the retained game's document. Fatal UI evidence wins even
 * when diagnostics itself throws; Node stores this result before failing. */
export function readRetainedGameObservation() {
  const failure = document.querySelector('#errorMessage')?.textContent?.trim() || null;
  try {
    const d = window.apexDiagnostics();
    // These are existing CPU counters, not extra GL queries. Keep current info
    // separate from the last ended ledger: offscreen submissions can advance
    // the former, and a failed draw can leave a partial or previous-frame sample.
    // Self-contained because Playwright serializes this function into the page.
    const count = (value) => (Number.isSafeInteger(value) && value >= 0 ? value : null);
    const lastEndedDrawPhases = {};
    for (const phase of ['environment', 'probe', 'mirrors', 'wet', 'shadow', 'composer', 'other']) {
      const value = d.renderer?.drawBreakdown?.[phase];
      lastEndedDrawPhases[phase] = {
        calls: count(value?.calls),
        triangles: count(value?.triangles),
      };
    }
    return {
      failure,
      state: d.state,
      auto: d.auto,
      options: d.options,
      motion: d.motion,
      workerPause: d.workerPause,
      presentationFrames: d.presentation?.frames,
      preparation: d.renderer?.preparation,
      environmentWarmup: d.renderer?.environmentWarmup,
      gpuFrameQueue: d.renderer?.gpuFrameQueue,
      renderWork: {
        scope: 'aggregate-multipass-not-final-camera',
        sampling: 'observation-time-cpu-counters',
        gpuCompletion: 'not-measured',
        mayBePartialOrPreviousFrame: true,
        rendererInfo: {
          calls: count(d.renderer?.drawCalls),
          triangles: count(d.renderer?.triangles),
        },
        lastEndedDrawPhases,
      },
    };
  } catch (error) {
    return { failure, diagnosticsError: error instanceof Error ? error.message : String(error) };
  }
}

export function retainCompatibilityObservation(report, observation) {
  report.lastCompatibilityObservation = observation;
  if (observation.failure) throw new Error(`Retained game stopped: ${observation.failure}`);
  if (observation.diagnosticsError)
    throw new Error(`Retained game diagnostics failed: ${observation.diagnosticsError}`);
  return observation;
}
