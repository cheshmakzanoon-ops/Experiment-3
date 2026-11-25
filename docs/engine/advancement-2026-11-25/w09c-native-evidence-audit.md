# W09C — independent native evidence audit

Assignment **51/60**, wave 9. This review checks what the native fixtures and
retained results actually establish. It does not introduce another production
patch, replace an earlier failed result, or turn a software-renderer result
into hardware acceptance.

## Current disposition

**Corrected source `774e62f` passes 914 focused tests in 70 files, full TypeScript
checking, the product/full production build, and all 47 native browser/replay
cases.** Its two independently failing material diagnostic paths remain visible;
this is software-browser acceptance of the stated contracts, not material-wide
or physical-hardware acceptance.

The completed [focused workflow](https://github.com/cheshmakzanoon-ops/Experiment-3/actions/runs/45592833399)
and its retained artifact were inspected directly:

| Item | Final inspected result |
| --- | --- |
| Source | `774e62fafdfd9ecd84001a2fcdb3b9f6ee973b86` |
| Tree | `5f466294eca0b188db58375a1caf4cd76088527b` |
| Workflow / job | `45592833399` / `139131185041` |
| Focused units | **914 passed in 70 files**, 189.00 seconds |
| Full TypeScript check / production build | **Passed / passed** |
| Build variant / edition | `product` / `full`; commit agrees with the source receipt |
| Build fingerprint | `08a29559c6223e8bef3d6c5af2229ea9421e1c6d9d9659e3144cd7c044267529` |
| Native browser/replay cases | **47 passed; zero unexpected, skipped, flaky or retried cases** |
| Overall focused workflow | **Success** |
| Artifact | `15012585753`; 1,300,824-byte original archive |
| Original archive SHA-256 | `3ae96693bf5bc12acdbd449592ef36b94bd1d05ffa9a1ce492d24e401cb2598a` |
| Backend | ANGLE / Mesa llvmpipe, LLVM 20.1.2, 256-bit software renderer |
| Material diagnostic failures | MeshBasic and raw `vec3`: 64 of 256 bytes differ through each read method |

The source, tree, lock and build receipts agree. The source hash recorded by the
native history fixture also matches the exact committed `src/main.ts` blob.
Every native case has one passed result at retry zero. The two material failures
have two explicit `native-backend-raster-limitation` annotations, preserved in
[`native-diagnostic-annotations.json`](evidence/checkpoint-774e62f/native-diagnostic-annotations.json).
This workflow's success does not assert that every broader repository workflow
passed.

### Observed native contract results

The [final result manifest](evidence/checkpoint-774e62f/result.json) indexes the
complete retained attachments. The audit directly checked these observations:

| Contract | Observed result at `774e62f` |
| --- | --- |
| Shared GPU ownership | Red and green each match all 256 expected bytes and hashes. Native fences 1, 2 and 3 are deleted once; the first two completed, the third was abandoned. No `finish` call or retained Three geometry, texture or program remains. |
| Attribute publication | Complete native buffer differences are zero before/after publication; duplicate/full/narrow updates transfer 48 / 49,152 / 24 bytes. |
| Retained history | Both trusted persisted shows retain the original document and worker. Paused worker ticks remain 57 → 57 and 95 → 95. Each restored owner has one RAF and input interval, balanced request accounting and no stale/duplicate delivery. |
| Terminal reload | New document/worker identities; trusted non-persisted hide; zero owned frames/intervals and one disposal of each tracked renderer, worker, input, UI and audio owner. |
| Native engine audio | Thirteen renders, 1,019,520 sample values; all four original/current pairs and six same-rate self-controls satisfy the stated PCM budget. Supplied-input differences are zero. The real gain perturbation is rejected. |
| UI audio | Three contexts close exactly once; every observed node disconnects and source handler clears. The replacement receives three native ended events, retains ownership, and no old cue revives. The abandoned resume remains observably pending at all three checkpoints. |
| Network transfers | 768 packets and 94,945 bytes match exactly; 768 sender views detach, six retained receiver buffers remain unchanged, all ports close and no transfers/events remain pending. |
| Wrapped records | 630 rows at ring head 100; transferred CSV snapshot differences are zero and native export detachment occurs. IndexedDB reload preserves the ghost bytes and first-crossing behavior. |
| Device ownership | Both actual DOM/focus/RAF cases pass with their stated scripted gamepad boundary; no physical controller claim is added. |

The raw MeshBasic and `vec3` controls continue to produce their prior failed hash.
Clear, exact texture upload, constant shader and `vec4` controls remain exact
through bulk native, individual-pixel and Three reads. Native uniform values and
RGBA8 attachment checks pass, with zero GL errors. These controls isolate the
observed path but still do not identify a specific driver/compiler component.

## Preserved compiler checkpoint

The preceding exact-source run passed 914 focused tests in 70 files, then failed
its full TypeScript check. Its production build and native cases did not run.
That reviewed candidate was
`26efaeefdf5a39b1d28cec4f8fb6bca1c97bf7e1`, tree
`0067cdfd51fb6b9cdecfa9cc1632f8ec19879b50`.

The [focused workflow](https://github.com/cheshmakzanoon-ops/Experiment-3/actions/runs/45590533223)
reports that exact head. Its job is `139123267349`. The preserved failure is in
[`checkpoint-26efaeef/result.json`](evidence/checkpoint-26efaeef/result.json).

| Item | Actual candidate result |
| --- | --- |
| Focused units | **914 passed in 70 files**, 204.42 seconds |
| Full TypeScript check | **Failed:** `TS2352` in `tests/engine-ui-opening-review.test.ts`, position 63:14 |
| Production build | Not run; the command uses `tsc --noEmit && vite build` |
| Native browser step | **Skipped; zero cases executed** |
| Overall focused workflow | **Failed** |
| Artifact | `15011470835`; 6,953-byte original archive |
| Original archive SHA-256 | `ca08d8a1980c3f505b45b63988e592e15917b8c2bd3f8023280d6f3ac03de7a0` |

The compiler rejects the new test fixture's direct conversion from its
controlled `Object.assign` object to `Interface`, because it intentionally lacks
the real constructor's other fields. Its diagnostic requests an explicit
conversion through `unknown`. This is a test-boundary typing failure; the
artifact does not establish a production behavior failure. The coordinator and
static-acceptance owner received the original compiler log immediately. This
assignment made no source change or assertion change to resolve it.

The five original artifact members are source/tree/lock receipts and the unit
and compiler logs. There is no built-product identity, renderer receipt or native
attachment for this candidate. Earlier native results cannot fill that gap.
The later `774e62f` run above provides its own evidence after the fixture typing
repair; it does not rewrite this failure as a pass.

## Earlier native failure retained

The preceding completed native evidence inspected here is
[`checkpoint-6cb1c88/result.json`](evidence/checkpoint-6cb1c88/result.json):

| Item | Inspected result |
| --- | --- |
| Source | `6cb1c881d19d190f5dbc68adeb9bf8b6c600da1b` |
| Tree | `a5b8816ef45c35ade9cd5ec6665fbbefd46d5707` |
| Workflow | `45585197376` |
| Units | 820 passing tests in 65 files |
| Full TypeScript check and product/full Vite build | Passed |
| Native browser/replay cases | 46 passed; one failed; none skipped or flaky |
| Overall focused workflow | **Failed** |
| Artifact | `15008124681`; 2,552,727-byte original archive |
| Original archive SHA-256 | `f9a2b58d8850e59ae364c0c31d4aadc3b86faa65c53ccaa078207c26855fc456` |

The archived source/tree/lock receipts and `BUILD_IDENTITY.json` agree with that
revision. Its backend receipt identifies
`ANGLE (Mesa, llvmpipe (LLVM 20.1.2 256 bits), OpenGL 4.5)`, with software rendering
detected and `physicalHardwareValidated: false`. That identity must accompany
the result; a generic label such as “GPU tested” would omit a material limit.

## Acceptance inventory and boundaries

The six wave-6 assignments add ten native cases to the retained suite. Their
production components run at the following boundaries; controlled fixture
conditions remain explicit.

| Domain | What executes in the browser | What the evidence does not establish |
| --- | --- | --- |
| Network | Actual server/client, codecs, prediction and clock logic through browser `MessageChannel` transfers; detached senders and exact received bytes | Physical-network latency/loss, WebRTC, socket behavior, worker isolation or separate machines |
| Retained page | Actual host lifecycle declarations, input controller/pump, native-clock physics worker, trusted two-cycle BFCache restoration and terminal reload | Whole-game BFCache eligibility, authored scene loading, a Festival session, or physical input hardware |
| Attribute uploads | Actual Three `WebGLAttributes`, the production range helper, native buffers and complete `getBufferSubData` comparisons | GPU upload duration, frame time, FPS or every producer geometry |
| Shared GPU ownership | Actual shared leases, real `WebGLSync` objects, native zero-time waits, borrower handoff and exact test-target images | Full-game image equivalence or correctness of the separately failing MeshBasic/`vec3` material paths |
| Audio arithmetic | Actual original/current engine graph in native `OfflineAudioContext`, exact supplied inputs and bounded mixed stereo PCM | Universal bit-identical native mixing, arbitrary native DSP error bounds, acoustics or output-device quality |
| UI audio ownership | Real live contexts, native sources, disconnections, close/resume promises and native source completion | Physical speaker silence or audible latency; deliberately delivered old callbacks are controlled adversarial input |
| Saved records | Actual IndexedDB save/reload, ghost interpretation, capture/CSV workers and transferable wrapped records | Every storage failure mode or a disk durability guarantee beyond the browser transactions exercised |
| Device ownership | Real dialog/focus/click/submission/scroll and animation-frame behavior around actual menu/credits owners | Physical gamepads: `navigator.getGamepads()` samples and device identifiers are scripted |

Relevant implementation and scope reports are [W06A](w06a-native-network.md),
[W06B](w06b-native-page-history.md), [W06C](w06c-native-gpu-advancement.md),
[W06D](w06d-native-audio-advancement.md), [W06E](w06e-native-records.md) and
[W06F](w06f-native-device-ownership.md). Historical “pending” paragraphs in those
reports describe their original handoffs. Later exact-source outcomes are
recorded in [CHECKPOINTS](CHECKPOINTS.md) and this consolidated acceptance record.

## GPU oracle review

The failed `6cb1c88` gate case required every byte of an 8 × 8 solid-red and
solid-green target to match. The later independent-context diagnostic recorded
the following counts against its exact 256-byte red control:

| Path | Bulk native read | All 64 individual pixel reads | Three readback |
| --- | ---: | ---: | ---: |
| MeshBasic | **64 differing bytes** | **64** | **64** |
| Raw shader with a `vec3` uniform | **64** | **64** | **64** |
| Native RGBA clear | 0 | 0 | 0 |
| Exact RGBA texture upload | 0 | 0 | 0 |
| Constant raw shader | 0 | 0 | 0 |
| Raw shader with a `vec4` uniform | 0 | 0 | 0 |

The full diagnostic is retained in
[`native-gpu-raster-path-diagnostics.json`](evidence/checkpoint-6cb1c88/native-gpu-raster-path-diagnostics.json).
All three reading methods agree for each path; native uniform values are
correct, attachments are complete RGBA8, and the recorded GL error is zero.
The same failure in a minimal raw shader isolates the tested native `vec3`
colour path independently of MeshBasic shader chunks and borrower handoff.
It does **not** identify the exact ANGLE, Mesa, LLVM or other native component
at fault. No game shader repair follows from that evidence alone.

The revised [shared-gate spec](../../../e2e/engine-native-gpu-advancement.spec.ts)
uses the previously exact test-only `vec4` material. Review confirms that:

- The red and green expectations still compare all 256 bytes. They are not
  changed to accept the failed stripes or a selected pixel.
- All existing queue, native-wait, admission, released-owner, fence-deletion,
  backend-lifetime and resource-cleanup assertions remain.
- Native wait results are forwarded unchanged. The fixture rejects `gl.finish`;
  pixel readback observes completed work and is not used to admit a frame.
- The six-path matrix now runs and attaches on every shared-gate execution.
  Nonzero differences are retained in `rasterPathFailures` and visible
  `native-backend-raster-limitation` annotations.
- Clear, upload, constant and `vec4` controls must match every byte through all
  three read methods. The independent-context `vec4` red hash must also match
  the shared-handoff red hash.
- No assertion requires the `vec3` defect to persist on a different or repaired
  backend. Its actual outcome remains observed, rather than manufactured.

This is a deliberate narrowing of the shared-gate image witness to a verified
control. It preserves that ownership contract and makes the material limit
explicit. **Even a 47/47 native suite result must not be described as all native
material controls passing if the diagnostic still contains those failures.**
The original failed checkpoints remain in the repository.

The native attribute-upload case retains its original complete-buffer checks,
48-byte duplicate upload, 49,152-byte full fallback, 24-byte resumed narrow
upload, exact versions and source-view guard values. Wave 8's pending-list
representation change did not require weakening that fixture.

## Audio oracle review

The [audio spec](../../../e2e/engine-native-audio-advancement.spec.ts) verifies
the original archived loudness source by SHA-256 and Git blob identity, and
checks all 31 shared dependency inputs against their original identities before
bundling. It executes the actual graph with separate original/current numeric
caches; it does not rewrite the original arithmetic into a reference formula.

Supplied PeriodicWave data, parameter values, automation, graph connections,
wave selection and source scheduling are compared exactly. Mixed native PCM
has a separate fixed acceptance budget, because the preserved native run also
showed original-versus-original byte differences. Its Float32 expression is
`2 * gamma_11 = 1.3113030448158677e-6`; output-peak/RMS scaling is explicitly a
fixture contract, not a universal theorem for native mixing or time-varying IIR
processing. Every original/current pair and same-rate self-control must pass.
An actual output-gain perturbation of `1 + 2^-10` must fail by more than 100 times
the relevant budgets. The sampled PCM is not edited to construct that control.

The inspected `6cb1c88` PCM attachment records thirteen native renders,
1,019,520 sample values, four passing original/current comparisons and zero
supplied-input differences. The corresponding UI-audio attachment and passing
case verify required native close completion, disconnected nodes, cleared
handlers and continued replacement ownership. The abandoned old resume may
remain pending: its real outcome is recorded, while replacement native `ended`
events and required closes provide completion barriers. Controlled stale-handler
delivery is identified separately from naturally delivered browser events.

The correct claim is exact represented engine inputs plus bounded native mixed
PCM and verified context ownership. It is not bit-identical native PCM or a
physical-audio-device result.

## History, devices and records review

The retained-page spec requires trusted `pageshow.persisted`, the same document
and worker identities, no additional document request, pause receipt, unchanged
worker ticks while held, fresh input before resumed motion, and one native RAF
and input interval owner. Its request/delivery accounting no longer treats a
repeated timestamp as an identity. A real reload must instead produce new
document/worker identities and the old owner's terminal cleanup receipt.
The complete production lifecycle declarations are extracted with AST checks;
the unrelated UI/audio boundaries remain small controlled services.

The device specs forward native RAF, focus and DOM work while supplying scripted
controller samples. Their claims distinguish trusted pointer/focus events from
controller-driven programmatic clicks. Released/replaced owners must retain
zero listeners or frames. The records specs use real reloads and native workers;
only the Vite inline-worker constructor import is adapted to a browser Blob
worker, leaving the complete production CSV worker and transfers intact.

No disabled-test markers (`skip`, `only`, `fixme`, `fails` or `todo`) were found
in the selected `engine-native-*.spec.ts` and replay spec during this review.
The [workflow](../../../.github/workflows/engine-runtime-validation.yml) retains
one browser worker, zero retries, `--forbid-only`, source identity receipts and
always-retained failure artifacts. Local Chromium remains outside this audit;
the already established local socket restriction was not retried or bypassed.

## Exact-source artifact preservation

The failed candidate archive is retained under
[`evidence/checkpoint-26efaeef/`](evidence/checkpoint-26efaeef/result.json).
The raw ZIP remains at
`/tmp/aeebac160835-engine/validation/engine-26efaeef.zip`; extracted original
members are in `validation/checkpoint7-artifact`. Its source and tree receipts
match the candidate above, and its lock receipt is
`610c1768c440c202a4e37f62d22467d4cbbddc44a5962e82bb256dcfb8627edf`.
The archive includes sanitized complete logs, original/log-copy hashes, the
job's actual step conclusions and an explicit absence of native/build identities.
No skipped native step is counted as a pass or a failed browser assertion.

The successful corrected-source archive is retained under
[`evidence/checkpoint-774e62f/`](evidence/checkpoint-774e62f/result.json).
Its 24 files occupy approximately 1.27 MB and preserve the complete attachments
needed for the claims above, including both history cycles and terminal reload
in `native-page-history.json`. The raw ZIP remains at
`/tmp/aeebac160835-engine/validation/engine-774e62f.zip`; extracted members and
the decoded Playwright report remain in `validation/checkpoint8-artifact`.
The lock digest is the same one recorded above. Sanitized logs and normalized
attachment JSON each have an archived-file digest; original member digests and
the original ZIP digest preserve their upstream identity separately.

The completed inspection covers:

1. Workflow/job/artifact IDs and the original ZIP byte count and SHA-256.
2. Source commit/tree, dependency-lock digest, built product identity and the
   actual software-backend receipt.
3. Full sanitized unit, compiler/build and native logs, with separate stage and
   overall conclusions. Sanitized logs do not replace the raw ZIP digest.
4. Actual Playwright counts, retries/skips/flakiness, native attachments and GPU
   diagnostic annotations. Material failures remain separate from test passes.
5. Both retained history cycles and the terminal reload receipt, plus exact
   input/record/upload and audio ownership evidence relevant to the release.

The coordinator owns Git publication. This assignment downloaded and archived
each focused artifact once; another copy is not an independent execution. The
review used text/source inspection, existing-JSON inspection, remote status reads
and artifact extraction. No local browser, test suite, compiler, build, timing
workload, production mutation or protected-content edit was performed. The
passing native result retains the GPU material limitation discussed above.
Subsequent executable-source changes require their own relevant acceptance;
this report identifies the exact source that was actually tested.
