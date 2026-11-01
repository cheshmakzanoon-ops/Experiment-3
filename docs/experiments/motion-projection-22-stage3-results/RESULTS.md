# Motion / end-projection experiment: stage-three validation

**Original gates pass; live integration remains on hold. Main runtime is still physics 21.** This unpublished-22 experiment is unmerged and unaccepted. Its narrow contact fixtures pass, but the seeded Arena player-slot rider regresses materially. Better maximum stop time alone is not sufficient. No source tuning, broader integration/cost run, performance acceptance or diagnostic replay followed automatically.

The unchanged patch and source verifier remain in [the stage-one archive](../motion-projection-22-stage1/README.md), documentation-only commit `2f15bc3641c0ead69407d1670ecb351544b7d981`. This supplement contains **results, not a duplicated or applied patch**. Stage-one and stage-two historical receipts remain unchanged.

- Frozen base: `2caf3413013f522c74f708262996c437e9433744`.
- Final source fingerprint (850 inputs): `40d61808773a0252274d6eb553ff28029399fb77af9f3b611e4005021e522f9f`.
- Code/config fingerprint (1,993 inputs): `025e6a48a7c313a099efa1cb333d8eefca93590f2163cbf72dcbe6de6a00fff1`.
- Unchanged patch SHA-256: `b643da358b1eacd3b2045b343eb6c784ff3c4e068a5e8390ed806064b43271c8`.
- Runtime: Node 22.23.4; full runtime/report/archive/audit digests are in `verification.json`.

## Completed, separate evidence

| Scope | Result | What it does not establish |
|---|---|---|
| Supported SM450 open-world supplement | 8 fresh v21/current × raw/sport × control/observer executions; 2 outer ticks each; 32 actual adapter advances; 24 canonical artifacts and 18 exact comparisons; 16 observed solves | Single participant, zero pair queries/contacts; no multi-rider or full Festival acceptance |
| Original all-57 `--strict` calibration | 228 fine/coarse pairs at 1/240 and 1/120 s; no band failures; entire non-provenance report exactly equals verified v21 | Original direct legacy rigs, not framed contact response; 15 original near-edge disclosures remain |
| Original unfiltered off-road calibration | 20 jump runs + 3 standing starts; report byte-identical to both references | Direct calibration is not a contact-event ledger |
| Original unfiltered production off-road races | All 10 scenarios pass original assertions; 74/74 entrants classified, none retired; complete outcome comparisons retained | Broad bounds do not establish rider-level gameplay acceptance or explain newly changed contacts |

Actual SM450 definitions/classes and raw/sport branch were asserted. Supermoto correctly uses `playerMotocross=false`; its current frames were ordinary/null. The earlier two requested-MX450 open-world cases remain **EH3 fallback comparisons**, not silently upgraded dirt-bike coverage.

The strict and full off-road processes exited 0 under their original 780/1,800-second caps, with source/runtime/archive checks intact. Off-road root-resolution maps also remained stable. Independent offline review reconstructed the full current non-wall report from all 242 v21 / 240 rate-only difference records and verified all 74 rider rows, including 444 rider-field pairs per reference. Wall durations are not a performance comparison.

## All scenarios

Columns are **v21 / rate-only v22 / current motion contract**. V21's original gate failed only six-lap Arena parked time; both unpublished-22 implementations pass that gate and remain distinct source identities.

| Scenario | Total crashes | Race-clock seconds | Maximum stop seconds |
|---|---|---|---|
| Valley Ridge motocross moto | 0 / 0 / 0 | 283.59 / 275.70 / 280.29 | 9.36 / 9.36 / 9.36 |
| Arena Nord supercross main | 4 / 0 / 2 | 282.96 / 269.64 / 282.32 | 16.43 / 16.34 / 16.34 |
| Kestrel rallycross heat | 0 / 0 / 0 | 246.88 / 246.88 / 246.88 | 0.00 / 0.00 / 0.00 |
| Pinewood special stage | 0 / 0 / 0 | 178.53 / 178.53 / 178.53 | 0.41 / 0.41 / 0.41 |
| event valley-ridge-mx-moto-1 | 0 / 0 / 0 | 397.11 / 397.11 / 397.11 | 9.76 / 9.76 / 9.76 |
| event valley-ridge-mx-moto-2 | 3 / 4 / 2 | 717.04 / 753.49 / 736.10 | 15.39 / 18.01 / 15.39 |
| event arena-nord-supercross | 7 / 2 / 7 | 531.74 / 523.05 / 537.77 | 21.13 / 15.27 / 15.27 |
| event valley-ridge-supermoto | 3 / 3 / 3 | 316.27 / 316.27 / 316.27 | 13.56 / 13.56 / 13.56 |
| event kestrel-rallycross-heat | 0 / 0 / 0 | 246.88 / 246.88 / 246.88 | 0.00 / 0.00 / 0.00 |
| event pinewood-special-stage | 0 / 0 / 0 | 219.09 / 219.09 / 219.09 | 0.41 / 0.41 / 0.41 |

Every entrant is included in [the 74-row summary](ALL-RIDER-SUMMARY.md). `comparisons.json` contains all three arms' per-rider fields/deltas plus the complete recursive non-wall difference sets, including classification, terrain, logs and optional fields. Only each race's `wallSeconds` is excluded. Difference-record counts are not literal changed-leaf counts when whole arrays change. Seven v21 and seventeen rate-only numeric records retain an int/float “type/shape” label issue; both are JSON numbers, values remain correct, and full reconstruction passes. Frozen records were not rewritten.

## Material Arena hold

All participants, **including player slot/rider 0, are AI-driven** by the original `autoPlayer=true` script. This is not a human playtest.

| Rider 0 | v21 | Rate-only v22 | Current |
|---|---|---|---|
| Three-lap recorded sequence | none | none | `contact@325`, `contact@448` |
| Three-lap reported finish (s) | 250.97 | 250.77 | 271.97 |
| Six-lap recorded sequence | `crash-flat@468` | `crash-flat@469`, `crash-front@477` | `crash-front@466`, `contact@333`, `crash-front@472` |
| Six-lap reported finish (s) | 482.96 | 525.84 | 547.77 |

The six-lap maximum stop improves **21.13 → 15.27 s** versus v21, but total crashes remain **7**; the rate-only candidate's **2**-crash result is not retained. Rider 0 worsens **1 / 2 → 3** crashes in six laps and **0 / 0 → 2** in three laps. Existing assertions still pass; no new gate is invented or formal pass relabelled as failed. Integration is nevertheless held on this material, unexplained rider-level regression.

**`@` denotes rounded lap metres, not time or lap number.** Ordered cause strings are not cross-source event matches. The adapter may prefer a recent crash-landing label over a pending contact label; neither label establishes an exclusive cause. Finish-time fields can include lap penalties, so their full difference cannot be attributed to crashes. A best-lap value of zero means no recorded valid best lap, not a zero-second/faster lap. Landing counts are not clean-jump counts.

Wet Valley is mixed: crashes improve from 3 / 4 to 2, but current race-clock time 736.10 s remains worse than v21's 717.04 s (rate-only: 753.49 s). Current rider 9 has the v21 reported sequence `crash-front@318`, `crash-front@780`, and worsens 1→2 crashes versus rate-only. Maximum stop equals v21's 15.39 s; no wet-crash cause is established.

## Interpretation and next boundary

The frozen five-family fixtures support the narrow discrete motion/end-projection contract: retain integrated crossing, omit zero-duration projection sweep, preserve actual endpoint depenetration and ordinary/teleport controls. They **do not prove that the new Arena contacts are correct**. Both original implementations missed the specified mixed fixture segment; the old rate-only candidate is not a demonstrated safe fallback.

The original race reports lack projection/query/approach history, event times/laps, partner states and contact energies. The inherited impact predicate is unchanged, and the landing judge still precedes the corrected body write. A separately reviewed four-execution v21/current control/observer Arena diagnostic is proposed to link actual impulse energy/latch to next-step absorption/fall, landing inputs and cause append. **It has not run.** No force-eligibility change, tuning, automatic broader tests or activation is authorized by this supplement.

The prior narrow scope, discrete-path approximation, unsupported-branch legacy fallback, failed-world ownership limits and omitted Y/pitch absorption remain. Requested vehicle IDs in original reports are option fields; entrant and instance-derived bike counts were checked, but no new per-rider constructor ledger is invented. The strict run did not record all dependency/baseline alias resolutions at both boundaries; later off-road root maps are not backdated. Source/import/runtime compatibility and these limits are retained in the sealed audits.

## Original command payloads

On a separately reconstructed exact isolated source, `SOURCE`, `OUT` and `NODE` are absolute paths to that checkout, a **fresh output directory** and the pinned executable. Invoke each gate independently with its own fresh `OUT`; the strict output template is copied from the frozen base. The exact executed wrapper and fail-fast shell bodies were:

```sh
# Strict gate, inside the original 780-second external watchdog.
cd "$SOURCE"
GATE_SOURCE="$SOURCE" GATE_OUTPUT="$OUT" GATE_NODE="$NODE" \
  "$NODE" --experimental-transform-types "$SOURCE/scripts/source-stability.ts" -- \
  bash -c 'set -euo pipefail; cd "$GATE_OUTPUT"; "$GATE_NODE" --experimental-transform-types "$GATE_SOURCE/scripts/vehicle-calibration.ts" --strict'

# Full off-road gate, separately inside the original 1,800-second external watchdog.
cd "$SOURCE"
GATE_SOURCE="$SOURCE" GATE_OUTPUT="$OUT" GATE_NODE="$NODE" \
  "$NODE" --experimental-transform-types "$SOURCE/scripts/source-stability.ts" -- \
  bash -c 'set -euo pipefail; unset OFFROAD_RACE; cd "$GATE_OUTPUT"; "$GATE_NODE" --experimental-transform-types "$GATE_SOURCE/scripts/offroad-calibration.ts"; "$GATE_NODE" --experimental-transform-types "$GATE_SOURCE/scripts/offroad-races.ts"'
```

The full-off-road shell's `set -e` stops before races if calibration exits nonzero. The external runner supplies the recorded watchdog, fresh output/template setup and before/after manifests; those controls are not supplied merely by pasting the payload commands.

No script, seed, scenario option, timestep, band or assertion changed. The SM450 harness and raw canonical/event artifacts remain separately retained and fingerprinted, not bundled; these command payloads do not reproduce that private harness. This compact package contains no source patch, assets or bulky logs. `CHECKSUMS.sha256` verifies its files; `verification.json` identifies the exact retained reports and archives.
