# Independent source review: f22622e

Remote source `f22622e3302ed6147c5aae6f8eb6f6bc4057a242` has tree `c413cd5062b6555d1e607297e99ad93db123de77`, exactly the immutable local `62f18b868163a9c86857ac3222414484b92bffc9` tree. Its remote parent is `c9d3ff07f0b459697133e5c6d68dcbe8492bd2ab`; the corresponding local parent is the previously reviewed `4b9d6bb70f1443930ae674e610dc14d61e187ee3`.

## Production scope

Only renderer.ts changes production behavior. Both renderer construction paths now run the existing static circuit TextureBudget registration as priority 8, before the original priority-9 far-shadow bake. The old post-queue registration calls are removed. The queue sorts numerically and cannot be extended after execution starts. Inspected circuit, offroad, quarry and venue-kit construction/batching runs through priority 4; material installers run at 5, transform sealing at 6, and probe surveying at 7. The new registration traverses the completed circuit at execution time.

The deferred factory applies selected graphics settings before construction executes. Synchronous construction retains its existing defaults. The texture algorithms, limits, filters, caster selection, bake body, quality routing and disposal order are unchanged. Async cancellation/failure still disposes the renderer, whose teardown restores budget-owned Sources before asset owners close their original bitmaps.

This is an initial rendering-consistency correction: the far bake adopts the same selected final texture policy used by later consumers. The old far-shadow inputs can differ, particularly for foliage mips and sampler state. Identical old far-shadow pixels are neither established nor claimed.

## Native evidence

Independent reviewer recover_checkpoint verified all ten committed source hashes, six evidence hashes and five installed native module hashes against the receipt. The retained ten texture-preparation cases and their fixture suffix are byte-identical; the shared native helper adds exports and an optional payload snapshot callback with the same default.

The seven new cases exercise production scheduling/bake methods, BuildQueue, TextureBudget, FarShadow and installed Three shadow/material/uniform/texture consumers. The independent original-order control performs far bake before registration, then compares its final consumer policy and native upload arguments with the corrected order. Pixel and mip data are snapshotted at submission. The priority-only 8-to-10 negative makes the two queue-mode ownership cases fail at the expected native Source-identity assertion. Cancellation, partial registration failure and normal/repeated disposal controls are substantive.

The reported 107/107 focused cases, lint and TypeScript checks are committed evidence; this audit did not rerun them. The evidence supports fixture owner/payload/lifecycle consistency and the bounded duplicate-transfer mechanism. It does not quantify duplicate transfers in the authored High scene or prove driver pixels, performance or completed application readiness.

## Browser acceptance boundary

All original e2e files and the isolated workflow are byte-identical to the reviewed parent. The High test requires the original 90-second paused readiness, completed GPU frames, driving and two 960-by-600 photo views. Its screenshot helper captures PNGs; it does not implement an automated far-shadow pixel reference. Authored-scene appearance inspection therefore remains necessary if those views complete.

The exact f22622e High run subsequently failed that unchanged readiness predicate before either photo view. Source/native review is accepted only as evidence for an isolated candidate; browser readiness and changed far-shadow appearance remain unaccepted. The cancelled c9d3ff run produced no artifacts, so it cannot isolate the timing contribution of the two source changes.

All source reads used immutable Git objects. New evidence is confined to this uniquely named scratch directory. No source, branch, ref, workflow run or existing report directory was changed by this audit.
