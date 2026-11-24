# Agent 03 — replay, telemetry and persistence audit

Date: 2026-11-24. Audit scope: engine infrastructure only. No production code, tests, Git state, models, characters, authored environments or assets were changed.

Requested base: `5edead7a44c8ccb5a187b22b750ce2bda7715128`. HEAD when reproductions completed: `b9ebb8b33570c60b0c0e9f2bba81b5e792b16e29`. The production files identified below are unchanged between those commits and have no local changes.

## Findings

| Priority | Finding | Affected functions |
| --- | --- | --- |
| P1 | A failed desktop mirror write can be hidden permanently by a successful write with the same or a later revision | `DesktopMirror.written`, `DesktopMirror.reconcile`, `SaveMirror.put`; transaction boundary supplied by `SaveStore.writeWithBackup` |
| P2 | An older recording callback's failure reclaims a newer publication of the same buffer and corrupts retained telemetry/replay rows | `ElasticTransferPool.beginTransfer/cancelTransfer/recycle`, `TelemetrySampler.flush/flushReplay` |

Both findings were reproduced against actual production classes using inline Node scripts. These are new locations/conditions beyond the prior engine programme. The persistence review previously addressed private snapshot consistency at IndexedDB enqueue time. The prior clock/transfer review repaired publication generation ownership in `FrameBufferPool`; the separate recording pool still lacks that protection.

## 1. P1 — desktop revision equality does not prove all committed data was mirrored

### Exact locations

- `src/storage/desktop-mirror.ts`: `DesktopMirror.written`, lines 178–186; each entry is independently sent with the transaction's revision, and synchronous/asynchronous failures are ignored.
- `src/storage/desktop-mirror.ts`: `DesktopMirror.reconcile`, lines 130–159; equal nonempty revision counters select `in-sync` without checking content or an incomplete-write marker.
- `desktop/src/save-mirror.cjs`: `SaveMirror.put`, lines 131–137; each successful key immediately raises the aggregate revision.
- `src/storage/data.ts`: `SaveStore.writeWithBackup`, transaction-completion callback around lines 298–307; backup and primary are emitted as separate entries sharing one revision.
- `desktop/main.cjs`: `saves:put` dispatch around lines 425–428 forwards each independent key to its mirror.

### Failure mechanism and observed evidence

Two production-relevant failure sequences violate the current recovery claim:

1. Local career write commits at revision 2. Its mirror IPC rejects. A subsequent local settings write commits at revision 3 and mirrors successfully. File and IndexedDB counters both become 3, while the file career remains stale.
2. `writeWithBackup` commits backup and primary at revision 2. The backup mirrors successfully, raising the file counter to 2; the primary IPC rejects. File and IndexedDB counters already match even if no later transaction occurs.

In both cases a newly constructed `DesktopMirror` reported `in-sync`, did not reseed, and retained `career: old` while the local committed value was `career: new`.

Actual output:

```json
{"scenario":"failed earlier transaction","report":{"action":"in-sync","keys":2,"revision":3},"localCareer":"new","mirroredCareer":"old","seeds":0}
{"scenario":"failed primary after successful backup","report":{"action":"in-sync","keys":3,"revision":2},"localCareer":"new","mirroredCareer":"old","seeds":0}
```

The local IndexedDB copy remains correct in this reproduction. The defect is that recovery no longer repairs the stale desktop copy, which matters for a subsequent reinstall/cloud restore or local-store loss. An IPC error was injected at the bridge boundary; native Electron failure frequency was not measured.

### Scoped repair direction

A mirror revision must identify a complete committed transaction/prefix, not just the newest individual key accepted. Preserve transaction boundaries through the bridge and publish a revision only after the complete batch is accepted; also avoid allowing a later successful transaction to conceal an earlier failed one. An alternative requires a durable incomplete/dirty recovery signal plus a verified full reseed. A transient renderer-only flag is insufficient after process restart. Merely awaiting the current per-key calls does not repair the successful-backup/failed-primary case because the counter has already advanced.

### Regression tests

Extend `tests/desktop-mirror-consistency.test.ts` and/or `tests/engine-persistence-integration.test.ts` with the actual renderer mirror and main-process `SaveMirror`:

- Rejected career transaction followed by successful settings transaction; create a fresh renderer mirror, reconcile and require the missing committed career value to be repaired.
- Successful backup followed by rejected primary at the same revision, then restart before any later write; require repair and preserve the valid backup.
- Repeat both rejection cases with synchronous bridge throws.
- Preserve successful multi-key writes and transaction-abort behavior; exercise two keys targeting different native mirrors if the bridge fix spans the main/ghost split.
- Ensure recovery metadata cannot claim a complete revision while a queued transaction remains unmirrored.

### Reproduction (run from repository root)

```sh
node --no-warnings --experimental-transform-types --input-type=module <<'NODE'
import { createRequire } from 'node:module';
import { DesktopMirror, REVISION_KEY } from './src/storage/desktop-mirror.ts';
const { SaveMirror } = createRequire(import.meta.url)('./desktop/src/save-mirror.cjs');
for (const scenario of ['failed earlier transaction', 'failed primary after successful backup']) {
  // No filesystem operations occur: the long, unreferenced timer is cleared below.
  const disk = new SaveMirror({dir: '/unused-audit-path', debounceMs: 3600000});
  disk.put('career', 'old', 1); disk.put('settings', 'old', 1);
  const local = new Map([['career', 'old'], ['settings', 'old'], [REVISION_KEY, 1]]);
  let rejectCareer = true, seeds = 0;
  const bridge = {saves: {
    info: async () => ({revision: disk.revision, keys: disk.keys()}),
    load: async () => disk.snapshot(),
    put: async (key, value, revision) => {
      if (key === 'career' && rejectCareer) {
        rejectCareer = false;
        throw new Error('temporary IPC failure');
      }
      disk.put(key, value, revision); return disk.revision;
    },
    seed: async (entries, revision) => {
      seeds++; disk.replaceAll(entries, revision); return true;
    },
  }};
  const kv = {
    keys: async () => [...local.keys()], get: async key => local.get(key),
    entries: async () => Object.fromEntries(local),
    putMany: async entries => {
      for (const [k,v] of Object.entries(entries)) local.set(k,v);
    },
  };
  const mirror = DesktopMirror.forBridge(bridge);
  await mirror.reconcile(kv);
  const commit = async entries => {
    for (const [k,v] of entries) local.set(k,v);
    const revision = mirror.stamp({put: (v,k) => local.set(k,v)});
    mirror.written(entries, revision);
    await Promise.resolve(); await Promise.resolve();
  };
  if (scenario === 'failed earlier transaction') {
    await commit([['career', 'new']]);
    await commit([['settings', 'new']]);
  } else await commit([['career:backup', 'old'], ['career', 'new']]);
  const restart = await DesktopMirror.forBridge(bridge).reconcile(kv);
  console.log(JSON.stringify({scenario, report: restart,
    localCareer: local.get('career'),
    mirroredCareer: disk.snapshot().entries.career, seeds}));
  clearTimeout(disk.timer);
}
NODE
```

## 2. P2 — recording transfer recovery is not tied to a publication

### Exact locations

- `src/storage/telemetry-sampler.ts`: `ElasticTransferPool.beginTransfer` / `cancelTransfer`, lines 48–57. Outstanding ownership is a `Set<ArrayBuffer>`; error recovery only checks the buffer identity.
- Same file: `ElasticTransferPool.recycle`, lines 59–87; synchronous return is explicitly supported and can immediately make the buffer available for another publication.
- Same file: `TelemetrySampler.flush`, lines 148–164, and `flushReplay`, lines 179–196; an older callback's catch restores its page/row ownership after deleting whichever outstanding entry currently matches the buffer.

### Failure mechanism and observed evidence

Publication A invokes a synchronous adapter. The adapter returns the attached buffer and re-enters capture/flush, producing publication B in that same buffer. B's consumer retains two rows. A's older callback then throws. `cancelTransfer` removes B's ownership because A and B have the same buffer identity, and restores the old one-row state. The next capture overwrites B's second retained row.

Actual output:

```json
{"stream":"telemetry","before":[4,6],"after":[4,8],"corrupted":true}
{"stream":"replay","before":[16,24],"after":[16,32],"corrupted":true}
```

This is the supported synchronous/non-transferring adapter boundary. Normal browser Worker recipients do not re-enter their sender synchronously, so the claim is scoped accordingly. Existing tests cover duplicate returns and throws before/after transfer, but not nested republication followed by an older throw.

### Scoped repair direction

Use a monotonically increasing publication identifier, stored with each outstanding buffer, and make `cancelTransfer` conditional on the original identifier still owning that buffer. The existing `FrameBufferPool` repair provides a local design precedent. Check both flush methods. Also preserve a newer active page if a callback re-enters capture without flushing before throwing; simply restoring the old field unconditionally can discard that newer page.

### Regression tests

Extend `tests/recording-transport.test.ts` for both telemetry and replay streams:

- The exact nested publication/older throw scenario below; require all retained B rows unchanged after later captures, and exactly-once ownership accounting.
- Several nested publications whose older callbacks throw.
- A newer actual `structuredClone` transfer followed by the older throw; keep detached return accounting correct.
- A complete synchronous transfer round trip and duplicate returns.
- Reentrant capture that leaves a newer partial page active when the old send fails; require captured rows not to disappear and pool capacity not to leak.

### Reproduction (run from repository root)

```sh
node --no-warnings --experimental-transform-types --input-type=module <<'NODE'
import { TelemetrySampler } from './src/storage/telemetry-sampler.ts';
import { HEADER, CAR_STRIDE, H } from './src/simulation/protocol.ts';
import { CHANNELS, TELEMETRY_STRIDE } from './src/storage/telemetry-schema.ts';
for (const stream of ['telemetry', 'replay']) {
  const sim = {
    tick: 0, makeFrame: () => new Float32Array(HEADER + CAR_STRIDE),
    writeFrame(out) {
      out[H.CARS] = 1; out[H.TIME] = this.tick / 120; out[H.TICK] = this.tick;
    },
  };
  const interval = stream === 'telemetry' ? 2 : 8;
  const stride = stream === 'telemetry' ? TELEMETRY_STRIDE : HEADER + CAR_STRIDE;
  const column = stream === 'telemetry' ? CHANNELS.indexOf('tick') : H.TICK;
  let sampler, calls = 0, held, before;
  const capture = () => {sim.tick += interval; sampler.capture();};
  const flush = () => stream === 'telemetry' ? sampler.flush() : sampler.flushReplay();
  const send = (buffer, rows) => {
    if (++calls === 1) {
      if (stream === 'telemetry') sampler.recycle(buffer);
      else sampler.recycleReplay(buffer);
      capture(); capture(); flush();
      throw new Error('older callback failed');
    }
    held = buffer;
    before = Array.from({length: rows}, (_, r) =>
      new Float32Array(buffer)[r * stride + column]);
  };
  sampler = new TelemetrySampler(sim,
    stream === 'telemetry' ? send : () => {}, () => {},
    stream === 'replay' ? send : () => {});
  capture();
  try {flush();} catch {}
  capture();
  const after = before.map((_, r) => new Float32Array(held)[r * stride + column]);
  console.log(JSON.stringify({stream, before, after,
    corrupted: String(before) !== String(after)}));
}
NODE
```

## Other boundaries inspected and verification limits

Read-only tracing included `SessionReplay` paging, hash witnesses, loaded-surface resealing, flashback metadata identity, two-read admission, four-page cache trimming, disposal, `TelemetryExport`, telemetry ring copying/truncation, `SaveStore` transaction handling, and native mirror dispatch. The prior programme already has substantial coverage for replay cache bounds and stale reads. No additional unverified replay-cache defect is promoted here.

The two inline reproductions ran successfully under Node v24.22.3 without modifying the repository or opening player storage. They are direct behavioral evidence, not native browser/Electron end-to-end validation. No full unit-suite run or performance/FPS claim is made by this audit.
