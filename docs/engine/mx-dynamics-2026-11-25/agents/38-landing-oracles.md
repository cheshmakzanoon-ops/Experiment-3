# Agent 38 — landing coordinates and adverse-input verdicts

Date: 2026-11-25. Wave 7, assignment 38 of 60.

## Decision and retained changes

**Retain the surveyed CG landing bounds and the shoulder survival assertions.**
Actual first-tyre clearance does not establish that the published bike station
has reached the scored landing zone. The negative-side ridden shoulder case
also suffers a later bottom-out crash; replacing its station assertion would
hide the first failure and expose another genuine acceptance failure.

**Migrate two obsolete adverse-input labels after independent threshold and
cadence checks.** Root explicitly approved this migration. The MX250 Raw
Valley front-lock case changes from `bottomed` to `crash-flat`; MX450 Raw
Arena front-lock changes from `crash-front` to `crash-flat`. Both changes are
required by their measured incoming state and the unchanged physical limits.
The test now identifies the exact eight intended bad-input cases rather than
checking only the former count of seven. Its complete-flight refinement,
ordinary-control survival, recovery and deterministic-repeat assertions remain.

Retained files:

- `scripts/bench/motocross-landing-oracles.ts`: reproducible read-only audit.
- `tests/motocross-player-dynamics.test.ts`: the approved verdict migration,
  exact adverse identities, and independent threshold classification.
- This report and the two `38-landing-oracles-*.json` evidence files.

No production source, physics constants, crash limits, models, character
assets, authored terrain, venue geometry or existing jump-corridor assertions
were changed. No git commits or pushes were performed.

## What the landing-zone coordinate means

`JumpSurvey.landing` and `landingLength` describe a longitudinal interval on
the authored far face. `LandingRecord.s` is the bike's projected CG station
at touchdown. Two existing gameplay consumers confirm that contract:

- `src/career/licences.ts` compares the sample's bike station with the
  surveyed centre/window when the airborne state ends.
- `src/simulation/offroad/landing-challenge.ts` retains that same station
  through the 0.25-second settlement and scores it against the half-zone.

The rider's first front footprint is approximately 0.75 m ahead of the CG.
That footprint can reach the downslope while the CG remains short. Changing
only the new corridor test to score the axle would therefore change its
existing gameplay contract. A broader gameplay decision to score footprints
would require corresponding consumers and separate authorization; none is
made here.

The audit wraps the actual `vertical()` boundary and reads the already sampled
front/rear patches at the swept contact event. It uses the unchanged axle
offsets, reference sag, pitch and heading to report the wheel gap and actual
projected footprint. It does not supply flight state, forces or a corrected
trajectory. Paired runs omit the observer entirely. **All four scene pairs
match exactly in full Float32 frame hashes and in unrounded Float64 physical
and thermal trace hashes**, at both reviewed checkpoints.

### Frozen pre-refinement contact evidence

The unchanged landing interval is **468.7882198–473.2607046 m**. These cases
use the exact controls and initial placement of the existing corridor test.

| Plant / side | First-contact CG | Contacting tyre station | Incoming normal speed | Complete landing |
| --- | ---: | ---: | ---: | --- |
| Legacy AI, −1 | 471.650727 | Rear 470.979408 | 3.344323 m/s | Survives |
| Legacy AI, +1 | 471.574132 | Rear 470.902916 | 3.288174 m/s | Survives |
| Ridden, −1 | 468.142960 | Front 468.891590 | 5.476729 m/s | Later `crash-flat` |
| Ridden, +1 | 468.440223 | Front 469.184889 | 4.294118 m/s | Survives |

At the two ridden contacts, the rear tyre is still respectively 0.444078 m
and 0.403314 m above its terrain patch. The negative-side first front contact
occurs on a shallow −0.064126 rad portion of the rounded knuckle. Its later
crash occurs at s468.922426, time 9.420833 s. This is not evidence that the
first-contact detector failed, nor is it a successful complete landing.

### Current coupled-source contact evidence

After assignment 33 reported stable source, the same paired audit gives:

| Ridden side | First-contact CG | Front footprint | Rear gap | Incoming normal speed | Complete landing |
| --- | ---: | ---: | ---: | ---: | --- |
| −1 | 468.095048 | 468.843686 | 0.473806 m | 5.755581 m/s | `crash-flat` at s468.935349 |
| +1 | 468.390021 | 469.134650 | 0.438040 m | 4.529446 m/s | Survives |

Both CG bounds still fail. The negative-side crash still fails the original
survival contract. Root has retained these as separate controller/approach
acceptance blockers; this agent does not loosen either assertion. This
controlled shoulder scenario is distinct from root's complete-lap trace.

## Why the adverse verdict migration is justified

The independent audit runs `front-lock` and `held-whip` on both machines,
both venues and both Raw/Sport settings at 240 and 480 Hz. It adds 960 and
1920 Hz for the four Raw front-lock configurations: **40 parameterized
flights per source checkpoint**, not 80 distinct configurations. It supplies
only the existing ordinary public controls and initial placement/speed/gear.

For each completed landing it independently classifies the frozen incoming
pitch, normal speed, crossed velocity and observed maximum shaft speed using
the unchanged limits and priority. This verifies verdict consistency; it is
not an independent multibody simulation or proof that the reduced force law
is exact. Every observed verdict agrees, every crash recovers, and every
incoming record remains immutable during settlement at both checkpoints.

The relevant unchanged limits for both MX machines are a 0.46 rad nose-down
error, normal speed above 1.5 m/s for that verdict, and **7 m/s shaft speed at
full travel** for `crash-flat`. A crossed real landing has the existing
5.5 m/s lateral threshold and higher judgment priority.

| Raw front-lock case | Pre33, 240→1920 Hz bottom speed | Coupled, 240→1920 Hz bottom speed | Coupled pitch error, 240→1920 Hz | Required verdict |
| --- | --- | --- | --- | --- |
| MX250 Valley | 7.360933→7.240910 | 7.199537→7.219674 | −0.380804→−0.390441 | `crash-flat` |
| MX450 Valley | 7.395384→7.271813 | 7.233227→7.250837 | −0.284947→−0.292790 | `crash-flat` |
| MX250 Arena | No bottom-out before pitch judgment | No bottom-out before pitch judgment | −0.476683→−0.488066 | `crash-front` |
| MX450 Arena | 7.292935→7.172554 | 7.133038→7.151013 | −0.367303→−0.373983 | `crash-flat` |

The two migrated cases remain on the same side of the physical thresholds
through all four cadences. Preserving their old strings would require an
incorrect classification of their actual state. The stronger intended set is:

- Raw `front-lock`, both machines × both venues: four cases.
- Raw `held-whip`, both machines × both venues: four cases.

The tests assert exact machine/venue/assist/scenario identities in both the
coarse crash set and the refined set. This prevents a missing intended fall
from being concealed by an unrelated ordinary-control regression. Existing
zero-crash expectations for feedback, rear tap, body reversal and early whip
are untouched. Sport front-lock/held-whip retain `bottomed` expectations.

The adverse 240→480 Hz limits remain **0.15 m/s normal** and **0.1 m/s shaft**.
Measured maxima are:

| Checkpoint | Normal difference | Shaft difference |
| --- | ---: | ---: |
| Pre33 | 0.00266005 m/s | 0.06900250 m/s |
| Coupled source | 0.00779755 m/s | 0.01415949 m/s |

## Newly exposed observer mismatch — not declared fixed here

The coupled audit returns nonzero because **all 16 tested 240 Hz flights**
report the existing rotor/thermal observer violation. None of its 480/960/1920
Hz flights report that violation. The full player suite finds the same issue
in 44 flight trajectories. This is independent of the migrated labels.

The existing benchmark reconstructs work as
`capacity × (Tend − Tstart) + endpointLoss × publicDt`, and compares airborne
spin with one outer drag-then-brake update. Complete contact refinement
introduces multiple implicit thermal intervals and multiple drag/brake
updates; those one-interval observer formulas no longer describe that
operation. Agent 37 independently reproduced the discrepancy using exact
per-inner-interval rotor and reservoir accounting, with residual at most
3.72e−10 J in its controlled cases. Its old outer thermal reconstruction
missed approximately 0.004 J and its old one-shot kinetic expression missed
approximately 0.05 J. See agent 37's independent report/tests for that proof.

This agent notified root, 33 and 37 immediately. The benchmark observer is
left unchanged for its owner's exact interval-aware correction. No work or
thermal tolerance is relaxed. The current full player suite is **not green**.

## Validation and reproducibility

The read-only audit commands are:

```sh
node --max-old-space-size=512 --experimental-transform-types \
  scripts/bench/motocross-landing-oracles.ts \
  --adapter-ref=ec2c75ccf3fa6cdf81c734977edc74105cdf52e1

node --max-old-space-size=512 --experimental-transform-types \
  scripts/bench/motocross-landing-oracles.ts
```

The optional historical adapter is transformed and loaded in memory. Its
own prototype methods replace the diagnostic process's adapter methods; the
current constructor was inspected and has unchanged initialization. All other
modules remain current and are fingerprinted in the evidence. No production
file is replaced. The evidence distinguishes the on-disk adapter from this
effective adapter, so concurrent on-disk refinement cannot masquerade as the
frozen method set. The effective sampled-source fingerprints are stable in
both recorded runs.

- Pre33 adapter SHA-256:
  `7fa932378aa37f4e93a51900e3e40f3aafa16a2c87f1a65537f5799fa31fa272`.
- Coupled adapter SHA-256:
  `02cc6351d7467833dfa21be74a2fac71ddfbbd64ecc4cd6623809325384d58b4`.
- Both runs' ground solver SHA-256:
  `68b04234548a2b037f4769d38343c26ec712a61fd9261fd6dac44641c81ca4e3`.

The paired observational checks all pass. The pre33 audit exits zero; the
current audit exits one for the reported observer violations. Its exit code
does not hide or reinterpret the explicit corridor acceptance failures.

Direct Vitest after the authorized test migration:

```sh
node node_modules/vitest/vitest.mjs run \
  tests/motocross-player-dynamics.test.ts --maxWorkers=1
```

**11 passed, 9 failed, 20 tests**, 10.64 seconds. The exact intended-adverse
identity/refinement test passes. The eight air-control cases and combined
repeat/accounting case fail at the unchanged rotor observer assertion; the
deterministic repeat equality itself passes before that assertion. Test log:
`/home/agent/motobound-agent38-player-tests.log`. This agent does not claim
that later assertions masked by those nine failures passed.

Targeted ESLint, strict TypeScript checking of the audit/test dependency
closure, and `git diff --check` pass. No npm lifecycle hook was executed.

**Ownership released:** root/later acceptance agents should rerun the audit
and complete player suite after the interval-aware observer correction. The
CG bounds and negative-side shoulder crash remain unresolved by this work.
