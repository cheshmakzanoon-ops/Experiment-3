# Wave 4: bounded delivery, session settlement and wire-equivalent input

All six workers completed. Subsequent integration is tracked separately.

## Engine changes

- SessionLifetime waits always settle despite throwing cleanup. Original rejection/cancellation reasons take precedence; cleanup failure rejects an otherwise successful wait. Default Festival startup now applies the existing terrain-readiness guard and remains paused when preparation is incomplete.
- Engineering diagnostics uses one acknowledged packet. An occupied credit survives repeated enable/reset requests, suppressing construction while the host stalls. Host consumption acknowledges only the owning live worker. Optional diagnostics never stop physics.
- Diagnostics validates surface IDs against the authoritative material table. The former circuit-only range rejected valid mx450 dirt contacts (surface 6); actual ticks 0 and 12 samples now pass without changes to materials or vehicle definitions.
- Festival command validation uses explicit pre-mutation domain errors. Unexpected execution failures become terminal, including already-queued resume/input traffic; fresh initialization is required to recover.
- Direct control quantization preserves the actual encoder/decoder result and field semantics while removing eight temporary byte-storage objects per call. Wire encoding and protocol versions are unchanged.
- Festival status delivery has 64 outstanding credits. At capacity physics pauses and rebases its clock; command/init mutations are rejected before execution. Returning credit resumes without catch-up. Published status order and the existing 10 Hz achievement sampling semantics are retained. Repeated overloaded pauses neutralize controls without allocating further required frames or duplicate statuses.
- Circuit telemetry exports are canceled when terminal failure or Festival ownership ends their session. Completion checks suppress stale downloads even if the worker promise had already resolved. Existing 500-row CSV chunking remains unchanged.

## Verification

| Assignment | Focused result | Evidence |
| --- | --- | --- |
| Session settlement/readiness |56 tests across 3 files |10 direct lifetime cases and 3 production startup cases |
| Engineering delivery/material domain |41 tests across 3 files |360 physics ticks with one immutable packet and no discarded construction; real motocross contacts |
| Festival command failures |39 tests across 4 files |16 actual-worker/simulation cases, including partial mutation and queued revival |
| Control quantization |102 tests across 5 files |262,137 steering comparisons; 4,589 pedal/lean comparisons; 16,384-command trace against unchanged codec |
| Festival status delivery |80 tests across 6 files |200 overloaded pauses; normal 10 s gives 1,200 ticks and 101 statuses including initialization; real achievement observer |
| Host export ownership |66 tests across 4 files |Four failures reproduced before the patch; 9 new ownership tests |

Suite totals overlap and are not a distinct aggregate. Scoped lint and whitespace checks passed. Larger worker-input bundles exceeded imposed 256/384 MB heaps; Wave 5 subsequently ran all 26 input-edge cases successfully within its 512 MB controlled suite.

The 64-packet status policy deliberately freezes Festival simulation under prolonged host failure rather than dropping already-sampled achievement transitions. This does not claim every physical event between normal 10 Hz samples is recorded. CSV memory remains proportional to retained rows because completed chunk strings live until Blob construction; no streaming-memory improvement is claimed.
