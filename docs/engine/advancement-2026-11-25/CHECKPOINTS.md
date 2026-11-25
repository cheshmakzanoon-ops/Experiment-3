# Published engine checkpoints

Baseline: `350119e8ec0606e8c5de5b3ab80df41104025679`.
The coordinator publishes completed, reviewed file sets to `main` with a
fast-forward lease. Concurrent CI documentation commits are preserved.

## Audit and ownership plan

`e7e443ae06ba04020e07e8a8d980e4e1304a433c` records the baseline, six audits,
protected scope and actual assignment ledger. This is documentation, not a
production performance change.

## Startup ownership and remote presentation

`6c96144dad0b2171ea15116ad97c79fbe6fb7f09` prevents simultaneous circuit and
Festival startup ownership and separates the remote presentation clock from
authoritative network timing. Implementation evidence is in `w02d-startup.md`
and `w02b-network-clock.md`.

The [focused engine workflow](https://github.com/cheshmakzanoon-ops/Experiment-3/actions/runs/45557220386)
completed successfully at this exact commit: focused units, full TypeScript
checking, production build, native browser contracts and replay ownership.
Its browser backend is Mesa software graphics. This does not certify a physical
GPU, controller or audio device, or assert that every unrelated workflow passed.

## Exact work reuse

`b594cfc762338c8a6766d8a6243b41e34e17a35a` publishes paved lane query indexing,
surface coefficient reuse, shared snapshot serialization and audio filter math
reuse. The four new suites passed together: 44 tests, zero failures. Scoped
ESLint passed. A full TypeScript check passed with a 4 GiB Node heap. Individual
notes retain the broader existing regressions and actual baseline comparisons.

The lane work reduces candidate checks; surface and audio changes reduce repeated
arithmetic; snapshot batching reduces repeated scalar serialization. These are
operation-count results until the separate timing wave runs. New retained surface
arrays cost 280 KiB per Track; multi-recipient snapshots add three temporary
backing buffers per boundary. These costs remain part of performance acceptance.

Its [focused engine workflow](https://github.com/cheshmakzanoon-ops/Experiment-3/actions/runs/45558489932)
completed successfully at this exact commit, including focused units,
TypeScript, production build, native browser contracts and replay ownership.
The artifact verifies **579 unit tests in 48 files** and **37 browser/replay
tests**. The browser backend remains Mesa software graphics. Source identity,
backend identity, full sanitized logs and the archive digest are retained under
`evidence/checkpoint-b594cfc/`.

## Runtime ownership, records and composed input

`955bc20f98fa1397ce1e41cd877c78c41a42cab5` publishes the completed third and
fourth implementation waves and four completed integration assignments. It
includes shared GPU completion leases, Festival frame admission and idle pacing,
retained-page suspension, UI/input teardown, credits and menu polling ownership,
bounded dirty-range unions, unsupported flashback journal elimination, ghost
first-passage lookup, telemetry closing-gap validation, audio sine-basis reuse,
and exact input-packet capacity.

The coordinator's frozen local checkpoint passed **793 tests in 58 files**.
Subsequent focused composition groups passed independently, including the final
**83 device/menu/page tests**. The actual-source network composition proof retains
2,292 equal datagrams and 278,730 equal packet bytes, with the intended remote
clock correction excluded from byte-equivalence claims. These are not timing or
physical-device results.

The [focused engine workflow](https://github.com/cheshmakzanoon-ops/Experiment-3/actions/runs/45568546604)
completed successfully at this exact commit: **813 tests in 62 files**, full
TypeScript checking, production build, and **37 native browser/replay cases**.
The backend is WebGL2 through ANGLE/Mesa llvmpipe software graphics; the backend
probe reports no GL error and explicitly does not validate physical hardware.
Source identity, sanitized full logs, backend identity and the artifact digest
are retained under `evidence/checkpoint-955bc20/`. The newly authored wave-6
fixtures were not included in this checkpoint and require their own CI run.

## Native ownership and transport accounting

`9922926e786c35e84810efc8b15e75bcfaba5372` publishes the composed audio and
graphics proofs, five native acceptance fixtures, and a transport accounting
repair: capture an input packet's length before a successful send can detach its
buffer. Failed sends still do not count as successful network traffic.

The [focused engine workflow](https://github.com/cheshmakzanoon-ops/Experiment-3/actions/runs/45573448610)
passed **820 unit tests in 65 files**, full TypeScript checking and the production
build. The browser run had **41 passes and four failures**. The new transferred
network, native attribute upload, IndexedDB ghost reload and CSV worker cases
passed. New audio PCM equality, live menu audio context ownership, shared-fence
pixel and retained-page callback-count checks failed and require investigation.
The first strict native history restore was admitted, but later assertions and
the second restore remain unproven at this checkpoint.

The failed result is retained, including sanitized logs, source/tree/lock identity,
backend identity, native result attachments and archive digest, under
`evidence/checkpoint-9922926/`. Existing passing tests do not substitute for the
four failed checks. The native backend remains Mesa llvmpipe software graphics.

## Native diagnostics and measured baseline comparisons

`6a1c76fae3736e4d814ab6d0a354f6837320731c` publishes native DOM/controller
ownership cases, direct RAF request/epoch accounting, complete GPU readback
diagnostics and a revised audio acceptance fixture. Original/original PCM also
differed in the failed native run, so mixed native output is now tested against
a documented Float32 fixture contract with same-rate self-controls and a real
gain perturbation; supplied waveform, graph and automation inputs remain exact.
The GPU pixel mismatch and live audio timeout retain their original assertions
and need the more detailed native diagnostics.

The checkpoint also retains both actual-source paired measurement reports. Warm
paved lane queries improved 1.76–3.70 times, while deliberately all-miss streams
were 2.19–2.67 times slower. Surface rain and staged mutable-weather workloads
improved; first wet updates, changing-timestep solvers and some other cases
regressed. See W07A and W07B for every sample, timing boundary, controls, source
identity, pair-order analysis and exact-output checks. These are local CPU
workload results, not game-wide frame-rate or physical-hardware measurements.

The [exact-source workflow](https://github.com/cheshmakzanoon-ops/Experiment-3/actions/runs/45579529295)
passed 820 unit tests in 65 files, full TypeScript checking and the production
build. The browser run passed 45 of 47 cases, including both native device cases,
all revised PCM checks and both strict BFCache restoration cycles followed by
terminal reload cleanup. The remaining audio failure waits for an abandoned
resume after its context has closed; required close promises did fulfill. The
GPU failure now records complete striped pixel data for diagnosis. Both failed
checks and all new passing native evidence are preserved under
`evidence/checkpoint-6a1c76f/`; the overall workflow is still failed.

## Complete initial measurement evidence and native raster isolation

`6cb1c881d19d190f5dbc68adeb9bf8b6c600da1b` preserves all six original
measurement tools, reports and raw results. It also repairs the audio fixture's
wait on an abandoned resume promise and adds independent native raster
diagnostics. There is no production-code change relative to the preceding
checkpoint.

The [exact-source workflow](https://github.com/cheshmakzanoon-ops/Experiment-3/actions/runs/45585197376)
passed **820 unit tests in 65 files**, full TypeScript checking and the production
build. **46 of 47 native browser/replay cases passed**. The audio replacement
and teardown case now passes, alongside both strict retained-page restoration
cycles and terminal cleanup.

The remaining full-image GPU assertion is preserved as a failure. A separate
native context reproduces its exact 64 differing bytes with a minimal raw
`vec3` uniform shader, independently of Three materials and shared lease
ownership. The raw `vec4` and constant shaders, native RGBA clear and exact
texture upload each return all 256 bytes correctly. Bulk, individual-pixel and
Three readbacks agree, with correct uniform values, complete RGBA8 attachments
and no GL errors. This isolates the failing native shader path on the recorded
software backend; it does not identify a specific driver/compiler defect or
certify hardware rendering. All source identities, logs, original failed
assertions and the six-path matrix are retained under
`evidence/checkpoint-6cb1c88/`.

## Reviewed runtime repairs and expanded unit acceptance

`26efaeefdf5a39b1d28cec4f8fb6bca1c97bf7e1` publishes all wave-eight
repairs: exact tiny-distance ghost endpoints, the measured twelve-recipient
snapshot threshold, bounded deferred range merging, modal-operation ownership,
and startup cancellation checks after synchronous public events and focus. It
also publishes the strict test-only vec4 shared-GPU witness, retains the
always-visible material diagnostics, and expands the focused workflow with
three supplementary compatibility suites and the missing UI trigger.

The [exact-source workflow](https://github.com/cheshmakzanoon-ops/Experiment-3/actions/runs/45590533223)
passed **914 tests in all 70 selected files**, then failed its full TypeScript
check with TS2352 in the controlled Interface test fixture. The chained Vite
build did not run, and all native steps were skipped. Earlier native passes
are not substituted for this candidate. The full failure and exact source
identities are retained under `evidence/checkpoint-26efaeef/`.

The coordinator's single local consolidated attempt was killed after partial
output, without a final test summary. Its 104 recorded input hashes stayed
unchanged; the incomplete attempt is retained separately in W09A. Complete unit
acceptance comes from the inspected CI artifact.

A follow-up compiler repair adds the explicit `unknown` bridge at that deliberate
constructor-free fixture boundary. Before/after emitted JavaScript is identical;
all seven fixture regressions, scoped lint and formatting pass. Full semantic
checking, the production build and revised native witness still require the
corrected-source workflow.

The single reserved range follow-up at this source passed all 624 paired
equivalence checks and all producer publications. It retains every upload-byte
saving. Sixteen disjoint marks still cost approximately 0.229 microseconds more
per helper batch, or 0.333 microseconds more for the overlapping complete
recording-upload scope, than the original append-only helper. The two scopes
must not be added. W08E preserves all 52 rows and the unfavorable comparisons;
this is no claim of universal speedup, native GPU duration, or game-wide FPS.
