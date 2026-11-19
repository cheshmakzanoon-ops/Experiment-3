# Independent GP support-admission peer review — assignment 23

## Finding

The absolute-capacity GP admission candidate changes permitted lean under a proportional change in both axle loads even though the physical lateral-to-normal force ratio is unchanged. The GP admission change causes the original mixed GP/SBK pace regression; common-mode target bias is an independently demonstrated mechanism within that change. Two observation-only runs reproduce both prior results exactly, and the engine snapshots differ only in GP admission logic and comments. The observation shadow does not isolate how many seconds of the total loss come from common-mode clipping versus the accompanying stopping-energy restriction.

| Original mixed case | Before GP admission | Absolute GP admission |
| --- | ---: | ---: |
| Fastest GP lap | 89.359302401 s | 95.505494526 s |
| Fastest SBK lap | 90.415059674 s | 89.688832625 s |
| SBK minus GP | +1.055757272 s | −5.816661902 s |
| Falls | 0 | 1 |
| Classified | All 6 | All 6 |
| Longest stopped interval | 0.525 s | 6.450 s |

This is the unchanged `tests/bike-session.test.ts` case: Vellamar, clear weather, seed 3303, two laps, six alternating GP-R1/SBK-1000 riders, player autopilot, 1/120-second world steps. The original >0.15-second GP pace margin is unchanged. The observer adds no road queries and modifies no inputs, returned controller commands, forces or state. Its reproduced lap values are exact.

## Actual-core common-load bench

Two production GP cores receive the same held speed (30 m/s), lean (0.35 rad), roll rate (zero), rider offset (0.08 m), grip and full lean intent. Their admission histories advance through actual `Bike.step` calls. The control core keeps static axle loads; the comparison core scales both axle loads by the same factor. Physical pose is held only to isolate the target computation from subsequent trajectory changes.

After the comparison core has settled at half static load, both axle loads increase proportionally to 1.5 times static. The full support capacity divided by reaction stays **exactly 1.75**. The instantaneous physical limit stays **1.005094858 rad**, and the nominal requested lean stays **0.990796680 rad**. Nonetheless, the absolute-admission target becomes:

| Time from reload | Target |
| --- | ---: |
| First frame | 0.513259481 rad |
| 20.833 ms | 0.634842558 rad |
| 79.167 ms | 0.823385914 rad |
| 245.833 ms | 0.971635348 rad |

The constant-load control stays at 0.990796680 rad. Thus this change cannot be attributed to less friction, a less capable axle, rider input, temperature, path error or a different physical lean equilibrium. The numerator retains an earlier low absolute load while the denominator immediately uses current high reaction.

## Mixed-race observation

For GP riders 0, 2 and 4, the absolute-admission implementation spends **21.533, 21.892 and 17.792 seconds**, respectively, clipping requested lean by more than 0.02 rad beyond what current physical support requires. An independent dimensionless ratio shadow, advanced without affecting the race, removes more than 0.02 rad of that extra restriction for **11.717, 13.583 and 12.558 seconds**.

The largest downstream speed deficits occur on the straight following repeated corner restrictions around stations 1900–2200. For rider 2 over stations 1900–2000, the two-lap mean speed falls from about **64.95 to 40.65 m/s** and mean requested throttle from **0.949 to 0.344**. These are downstream consequences in the coupled rider/trajectory simulation, not evidence that the engine needs more power. The added GP admission is the only executable engine difference between the observed snapshots; `bike-ai.ts` differences are comments only.

The admission candidate also introduces one fall for rider 0 at station 1952.828 on lap 2. The fastest GP lap still degrades before relying on that incident; riders 2 and 4 remain upright and have best laps of 95.640 and 98.717 seconds.

## Physically consistent representation

Let `R = (Nfront + Nrear)/mass`, `C` be the full per-contact lateral acceleration capacity, and `q = C/R`. Proportional axle-load changes preserve `q`; asymmetric contact loss, friction loss and camber changes can reduce it. A lean target should therefore use admitted `q`, with immediate decreases and the existing response time for increases. A true zero-support interval resets admission to zero.

Stopping work also depends on the magnitude of the reaction. A brief common load peak must not immediately authorize the roll momentum appropriate to sustained high support. A separate admitted reaction `Ra` preserves that protection. Current forces, inverse balance and arrest authority should continue to use actual `R` and the actual per-contact force budgets.

One additional consistency condition is necessary: current longitudinally remaining recovery must also be normalized by actual reaction before it enters an energy calculation based on admitted reaction. With current remaining recovery acceleration `A`, admitted full-support ratio `qa`, direction `d`, ahead angle `a`, target `t`, and roll factor `k = mass*height/inertia`, the consistent form is:

```text
E = k * Ra * [min(A/R, recovery*qa) * d * (sin(t)-sin(a))
              + cos(t)-cos(a)]
```

If `A` already includes the recovery margin, do not apply that margin to `A/R` twice. The actual force clamp remains `A`, not the admitted force. Because `Ra <= R` and the admitted normalized recovery does not exceed current normalized recovery, a positive admitted work estimate cannot exceed current physical work over the same angle interval.

### Counterexample for mixing absolute recovery with admitted gravity

Use fixture values `R=14.7`, `Ra=4.9`, current remaining recovery `A=4`, admitted ratio `qa=1.75`, ahead 0.4 rad and target 0.6 rad. Here `qa` is already expressed in the recovery ratio convention.

- Current physical work divided by `k`: **−0.706266548**. There is no positive stopping work for the requested outward roll.
- Combining `min(A,qa*Ra)` with admitted gravity `Ra`: **+0.231842167**. This incorrectly permits additional roll.
- Consistently normalized paired work: **−0.235422183**. The roll reference correctly receives zero positive stopping energy.

This is a representation correction, not a gain or pace calibration. The existing response, force coefficients, grip, AI limits and acceptance tests need no alteration.

## Evidence and scope

Retained files in this directory:

- `common-load-bench.mjs` / `.json`: actual-core held-pose evidence with source hash.
- `mixed-observe.mjs`: observation harness; both reviewed runs use its default observation mode.
- `mixed-supported.json.gz` and `mixed-reaction.json.gz`: losslessly compressed full observations and exact source hashes.
- `peer-review-evidence.json`: compact findings, complete bench and original race summaries.

Reviewed supported source: `bike.ts` SHA-256 `d5bcc7e0cbd1915eed7690a34c608ffc0df6b45016a78f70f68e38e4041794fc`; `bike-ai.ts` SHA-256 `fdfcc6668dc278280d628df27259cbda859ad5aafa7a84cc5d2fe2b4cc6062c3`.

This review made **no shared-repository, production or candidate source edits**. Assignment 27 owns the proposed paired representation and its integration. A ratio shadow is a diagnostic, not a corrected-case acceptance result. The unchanged mixed race, transient-support invariants, zero-force flight and other required gates still need to run on the actual corrected candidate.
