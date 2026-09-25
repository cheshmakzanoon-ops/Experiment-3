# Phase 27H.6 reconciliation

Recovered saved commit `14c6df8276796ba496716039ca7a40a760adc323` and staged tree
`90a5fbd3c5f90b7003033289cd45a8ee0353e4a9` on the shared `12f38b1` baseline.
Publication must descend from the current remote main, without a force update.

Both implementations are retained: adaptive HUD/standings, solid gantry/tower
occlusion, sequence-qualified populated-race reviews, damp-film conformance,
complete pit-crew framing, pose reuse, and both independent browser suites.
Requirement ownership links are combined without granting new approvals.
Historical validation records are explicitly labelled with their source candidate.

Two integration repairs address actual application ordering. The initial real
paused grid snapshot is observed before releasing the worker; accepted live
worker messages also feed the existing bounded session observer. UI observation
still runs independently, and the observer's sampling/limits are unchanged.
Replay's actual duration is installed in its range control before showing the
bar, rather than waiting for the first GPU frame. Early seeks are no longer
silently clamped to the HTML default maximum of one second.

The road GPU fixture previously measured tiny normal variation directly in
8-bit pixels, leaving its deep-water comparison dominated by quantization.
Diagnostic-only output now encodes deviation from the unperturbed normal with
fixed gain. Physical shading is unchanged. Original thresholds, reversibility,
held-state and resource checks remain; an additional check rejects diagnostic
clipping. This is a component measurement, not visual acceptance.

The retained master specification, authored assets, simulation, workers, input,
storage, audio, dependency lock and original CI workflows are unchanged. Only
temporary 27H.6 import/toolchain helpers are removed from the final source tree.

Validation is source-qualified: local lint/unit/build checks and hosted browser
checks must be recorded against the reconciled tree. A successful publication
or CI run does not grant final-art, all-reference, physical-hardware, Section 146
or Steam-release approval. Those remain separate acceptance gates.

## Hosted integration follow-up

The first reconciled preflight passed the road GPU contract, but showed that
an automated post-load pause could miss the real countdown. The paddock now
provides **PREPARE GRID / START PAUSED**, an ordinary player control that holds
the initialized worker before any race time elapses. Camera and demonstration
driver choices are available in the pause dialog. Both grid suites use that
control before starting the existing recorder; normal ENTER CIRCUIT behavior
and all phase, motion and evidence qualification assertions are preserved.
This option is not stored in physics configuration or persistent saves.

The held-replay pose-cache check now requests an ordinary viewport resize to
redraw the same recorded instant. It additionally verifies that replay time,
live worker tick and pose-build count remain unchanged. A deliberately idle
paused replay cannot accumulate draw-dependent cache hits merely by waiting.

## Hosted capture workload corrections

The first exact-source preflight passed all 1,090 unit cases, both road/weather
GPU contracts, HUD checks, the numerical scenarios, and the default-quality
wet-night full-lap/replay/performance journey. Its 1440x900 software renderer
produced Low-preset close-racing frames about 1.7 seconds apart; the existing
sequence qualifier correctly rejects gaps exceeding one second. The five
functional sequence cases and independent grid/session case now explicitly
use a 640x400 Low workload, with the unchanged opponent counts and rain/spray
restored for wet cases. Reports assert and retain that viewport/configuration.
The default-quality 1440x900 wet full-lap and pit/replay journeys remain separate.
No duration/gap threshold, assertion, simulation speed, or renderer default is
relaxed. These are software-GPU integration observations, not art or hardware
performance certification.

The pit replay helper now requests valid steps of the actual range control
before asserting exact seek acknowledgement. Arbitrary observed service times
are not necessarily representable by its 0.01-second step. The pit journey
retains normal unpaused startup; the optional held-grid path is grid-only.
