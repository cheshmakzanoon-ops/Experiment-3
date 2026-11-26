# Agent 21 — bounded shoulder guidance and the clear-policy boundary

Date: 2026-11-25. Checkout: `/home/agent/motobound-579b454ae846`.
Starting and final HEAD: `61434f1e44e678e4164955c16240c61ad22da9a0`.

## Release status

**Final candidate retained provisionally at root's direction.** All 42 existing
AI cases and all 14 corridor/guidance cases pass. Both unchanged ridden-lap
cases complete two laps with no falls, but fail their existing maximum-stall
assertion. This is not a completed full-lap fix or a release-green result.

Ownership is released for these files only:

- `src/simulation/offroad/ai.ts`
- `tests/motocross-jump-corridor.test.ts`
- This report.

No jump speeds, takeoff gains, rolling targets, course geometry, surface/model
files, crash thresholds, or assertions in the existing 42-case AI and 18-case
forgiving-handling suites were changed. No commits, pushes, installation,
package hooks, full TypeScript builds, or edits to other agents' files were
performed. The old agent-15 production candidate was read from `b451b72` only;
the merged upstream AI, including its continuous shoulder guard, was preserved.

## What the production candidate changes

`governJump()` previously replaced lateral tracking with a tangent-only command
inside its existing 28 m lip range. A bike parallel to the straight at lateral
±5.5 m therefore received zero corrective steering and continued along the
faded jump profile. This is the specific defect identified in reports 14/15 and
reproduced in the baseline.

The final change first computes the actual current front/rear footprint from
the bike's heading, each axle reach, and each tyre's half-width. Only when that
footprint exceeds the existing full-profile boundary, `track width + 0.4 m`,
does the governor retain the held feature-lane correction. The correction uses
the same ±0.5 input bound and the same lane-control gains already used by the
rhythm approach. Bikes inside that boundary retain the original square-to-lip
command exactly. This avoids changing every otherwise supported jump approach
merely to recenter its lane.

`motocrossJumpCorridor()` projects the present horizontal velocity, including
the measured transverse slide, through the face, lip, and near/centre/far
landing stations. It reserves both tyre footprints. Its result determines
whether a shoulder rider can begin the existing lane-to-lip steering blend.
It is **not used by `limitSpeed()`**, does not change clear/roll decisions, and
does not pretend to forecast future ground steering or prove a full ballistic
trajectory. On a shoulder whose current projected corridor still misses, the
ordinary bounded lane input remains active. All motion still comes from the
normal steering/contact plant.

The existing `motocrossJumpApproachSteer()` timing, governor activation range,
speed-control gains, heading guard, braking decisions, and jump speed targets
are unchanged.

## Why the rejected mandatory-roll contract was replaced

The full-height survey envelope is useful for steering, but crossing its edge
does not prove that the actual lower shoulder terrain cannot support a safe
clear. The user/root explicitly authorized revising agent 15's new candidate
contracts once physical counterevidence was established; the older AI/lap
assertions remain unchanged.

Three observations establish this distinction:

1. The baseline BARN DOUBLE case with the parked rider at lateral 11 m clears
   14.359 m with no fall. At commitment it is 14.170 m before the face,
   lateral −0.930 m, heading 0.580 rad across the face, and already unwinding
   with yaw −0.329 rad/s. Its departure is around lateral +5.35 m and its later
   landing travel reaches +7.54 m. The old candidate's initial 0.5 rad heading
   rejection, and a universal full-height projection veto, both reject a
   physically supported clear in the unchanged regression.
2. With bounded guidance, the ±5.5 m AI shoulder cases clear the finish triple
   cleanly into its landing zone without an abort. A mandatory roll would
   discard this recoverable approach.
3. In the final ridden-plant cases, departure lateral is −4.928/+4.711 m,
   outside the 4.6 m full-height boundary, yet both clear into the surveyed
   longitudinal landing zone and complete the feature without a fall. Thus
   even requiring every actual departure footprint to enter that full-height
   band would be stricter than the observed physical requirement.

The new physical regressions therefore require inward progress, a flight over
one second, touchdown inside the actual landing zone, lateral return into the
groomed landing width, continued travel through the whole landing, and zero
falls. They retain the original course, speed, seed, and ±5.5 m setup. They also
exercise the ridden plant with `aiControlled` withheld and airborne steering
and front-brake input released, matching the existing full-lap driver. They no
longer require an unnecessary roll/abort or an arbitrary 3.5 m face coordinate.

The six geometric corridor cases remain, explicitly described as steering
handoff diagnostics. Two direct shoulder-steering cases remain. Two new
inner-lane cases require the calibrated tangent command to remain unchanged.
Together with the four physical cases, the file now contains 14 tests.

## Final verification

Executed directly, without hooks:

```sh
./node_modules/.bin/vitest run tests/motocross-ai.test.ts tests/motocross-jump-corridor.test.ts tests/motocross-forgiving-handling.test.ts --reporter=dot --maxWorkers=1
```

Final run: **72 passed, 2 failed, 74 total; 28.43 seconds**.

| Gate | Result |
| --- | --- |
| Existing motocross AI suite | 42/42 passed, including all four supported BARN DOUBLE clears |
| Corridor and bounded-guidance regressions | 14/14 passed |
| Existing forgiving-handling suite | 16/18 passed |
| Valley ridden two-lap gate | Two laps, zero crashes; maximum stall 4.158333 s fails unchanged `< 1 s` assertion |
| Arena ridden two-lap gate | Two laps, zero crashes; maximum stall 4.150000 s fails unchanged `< 1 s` assertion |

`git diff --check` passed for both owned source/test files. The AI and
forgiving-handling test hashes were unchanged at this run.

### Final shoulder trajectories

These production runs start 24 m before Arena's FINISH TRIPLE at the unchanged
`jumpHoldSpeed`, lateral ±5.5 m, gear 2, seed 41003. They continue past the end
of the landing, so a later nose-first rebound cannot be hidden by the initial
touchdown result.

| Plant / side | Departure lateral | Landing station | Landing lateral | Flight distance | Initial landing normal speed | Falls / aborts |
| --- | ---: | ---: | ---: | ---: | ---: | --- |
| AI / − | −4.1693 m | 471.6507 m | −1.4591 m | 19.8989 m | 3.3443 m/s | 0 / 0 |
| AI / + | +3.3605 m | 471.5741 m | +0.6564 m | 19.8206 m | 3.2882 m/s | 0 / 0 |
| Ridden / − | −4.9284 m | 469.2443 m | −3.3408 m | 17.2757 m | 7.6402 m/s | 0 / 0 |
| Ridden / + | +4.7111 m | 469.5469 m | +2.2497 m | 17.7203 m | 6.2698 m/s | 0 / 0 |

Landing stations are the solver's saved event positions; lateral values are
the adjacent completed-step measurements. The ridden landings are harder than
the AI landings. Their successful execution in this setup does not establish a
general safe-clear policy for arbitrary headings, slides, loads, or terrain.

## Paired diagnosis and rejected alternatives

The initial unchanged baseline command gave **59 passed, 11 failed**: all
42 existing AI cases passed; Arena's ridden lap passed; Valley's ridden lap
failed only its 4.166667 s stall. All ten retained agent-15 corridor tests were
red because the rejected helper was absent, tangent steering remained zero,
and both parallel approaches reached the face at about |lateral| 5.491 m.

Two broader steering variants were then rejected before the final scoped
candidate. None changed speed or crash thresholds.

| Variant | Existing AI | Ridden diagnosis |
| --- | --- | --- |
| Apply held-lane blend to every clear approach | 42/42 passed | Valley's stall disappeared, but Arena gained a front fall at s474.344846 and a 4.208333 s stall |
| Keep that lane input until the projected full-height corridor fits | 38/42 passed | Both circuits had no falls, but four BARN flights shortened to 11.822994 m and failed their unchanged `> 12 m` requirement; Arena stalled 4.233333 s |
| Final: recover only an actual shoulder footprint | 42/42 passed | Both circuits have no falls; stall gates remain red |

The first broad variant and baseline were explicitly rerun against the same
stable adapter/helper hashes listed below. The source hashes were captured
before and after each diagnostic run and did not change within those runs.

The first broad variant's Arena fall is a concrete secondary-impact failure,
not a successful landing fix: first touchdown at s468.348258 is front-only,
normal speed 3.794836 m/s, pitch error 0.103211 rad. The rear then bottoms at
4.801383 m/s; the next hop leaves around s469.859 with pitch rate
−3.468160 rad/s. Pitch reaches the clamp and the bike falls at its next front
touchdown. This distinguishes a clean initial patch from a safe completed
landing and motivated the whole-feature regression.

No further variants or tuning were attempted after the final scoped candidate.

## Remaining ridden stalls

The final diagnostic uses exactly the existing ridden-lap input arrangement.
It records four seconds of state around falls and stalls, without replacing
the physics or planner. Both final circuits complete two laps with empty
crash-cause lists.

| Circuit | Start time | Duration | Beached station / lateral | Mid-stall observed state |
| --- | ---: | ---: | --- | --- |
| Valley Ridge | 62.9333 s | 4.1583 s | s593.7997 / −1.3447 m | Speed 0, target 5.598 m/s, throttle 0.975, brake 0, pitch 0.530 rad, front/rear support 648/1160 N |
| Arena Nord | 109.4167 s | 4.1500 s | s153.6270 / +0.8812 m | Speed 0, target 5.001 m/s, throttle 1, brake 0, pitch 0.739 rad, front/rear support 380/1428 N |

The jump plan is null at both stalls, and drive is requested continuously.
These fields justify inspecting the ground force/slope and restart path next;
they do not by themselves prove which force term causes the failure. Arena's
stall is an integration regression relative to the paired baseline, despite
the absence of added falls. Root explicitly retained the candidate
provisionally with the stall assertions still red for the next physics wave.

## Source provenance and diagnostic artifacts

The final combined test command and final lap diagnostic used these hashes.
The final diagnostic's before/after fingerprints match. Later recovery or
ground-force changes by other agents require an integrated rerun.

| File | SHA-256 |
| --- | --- |
| `src/simulation/offroad/ai.ts` | `af74fb9ae81eddc305f565b91c8488d518211f32da140ba811ca2aa8e8971982` |
| `src/simulation/offroad/dirt-bike-vehicle.ts` | `0672ea2309cee36f8b2a88812adf30f06626c174b323d69a339674ecddbe39ee` |
| `src/simulation/offroad/mx-ground-physics.ts` | `8cdf2f5ad7ac540c8716a18b604d5ef4b504cc04d5681a0c680aef9ebc581140` |
| `src/simulation/offroad/contact-impulse.ts` | `825d280cfd4c1769db8fee0abcdfa91989f4c6b73ac502e120f59f1061afa28e` |
| `src/simulation/offroad/rider-weight.ts` | `5027085c4bb2b192d89a0368d56ca9296b34ed5130e936db0741eed30304ad96` |
| `tests/motocross-jump-corridor.test.ts` | `6cd4682fb4cff98d583a7ff645ca6a817d4d076906d03005441621e46cfed86b` |
| Unchanged `tests/motocross-ai.test.ts` | `1920900207b75cca0d15a220aca9e7924f3f2376f1b6b04d9cee5a9752470103` |
| Unchanged `tests/motocross-forgiving-handling.test.ts` | `495119af76deed9cbf3cb4f8f8c889bab2aeb1d5e15c510f64e424adafab29d1` |

Baseline AI hash:
`c6b3279324d8f52c3d29208e466fb61862d63b800b4c89539f5515ebb3ec1a0e`.

Temporary diagnostics are under
`/home/agent/motobound-diagnostics-579b454ae846/`:

- `agent21-barn-baseline.json` and `agent21-barn-lane1.json`.
- `agent21-shoulder-lane1.json`, `agent21-shoulder-lane1-ridden.json`,
  `agent21-shoulder-lane2-ridden.json`, `agent21-shoulder-lane3-ai.json`, and
  `agent21-shoulder-lane3-ridden.json`.
- `agent21-laps-stable-baseline.json`, `agent21-laps-stable-lane1.json`, and
  `agent21-laps-stable-lane3.json`.
- `agent21-ai-baseline.ts`, `agent21-ai-lane1.ts`, and `agent21-ai-lane2.ts`
  preserve the exact compared controller variants.

Reproduction runners are `/home/agent/mx-corridor-agent21-579b454ae846.ts`,
`/home/agent/mx-shoulder-agent21-579b454ae846.ts`, and
`/home/agent/mx-lap-agent21-579b454ae846.ts`. These are analysis artifacts, not
additional repository edits. Production ownership is now released.
