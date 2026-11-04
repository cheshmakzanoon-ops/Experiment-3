# QA — Bikes, mixed-class passing (wave 3)

Branch `studio/bikes-mixed-passing`, cut from `main` @ `ebaf773` with `studio/physics-test-health` (`f3f241d`, "GP riders
get past slower classes", physics v22) merged in. Scope from the PM: make passing **safe**. `f3f241d` fixed the red
mixed GP/superbike test (a GP was held behind a superbike for the whole race, 0 completed passes) but mixed fields
then fell, and the `bikes` machine option builds exactly that field. Everything below was run on the shared 4-CPU
host, one command at a time; raw outputs are in `docs/studio/reports/qa-bikes-3/`.

## Summary

1. **Result.** On the sweep the previous agent used (aurel, parco-reale, loirette-club, haarveld, vellamar x 6 seeds,
   3 GP + 3 `sbk1000`, 2 laps, seeds 3303 + 37 k) falls go **4 -> 0**, race-control incidents **8 -> 0**, GP faster than
   the superbike in **28/30** (main 15/30, `f3f241d` 28/30). On a second, untouched seed set (5000 + 37 k) the same
   sweep is **26/30 GP faster, 0 falls, 0 incidents** (main 12/30 / 0 / 0, `f3f241d` 22/30 / 10 falls in 8 races / 14).
   Over all seven circuits x 8 seeds x two sets (112 races): falls **1** in 1 race (`f3f241d` 29 in 22 races, main 3 in
   3), incidents 1 (55 / 4). The mixed test's margin on its own seed (vellamar 3303) is **0.61 s** (was 0.03 s).
2. **What the falls were** (29 on `f3f241d`, every one traced, table in section 2): **10** a GP at 160 to 260 km/h whose
   brake lever went from nothing to the cap in 0.04 s when a traffic cap dropped under it, rear unloaded, lateral speed
   20 to 47 m/s, lowside; **10** a GP and a superbike overlapping where the racing line crosses the road (9 at the Haarveld
   chicane, the same instant in seven seeds; one superbike that hit a fallen GP) because the planner predicted the
   superbike *off the road* where the line leaves it; **5 + 3 + 1** a GP that tailed a superbike into a hairpin or slow corner with its lever pinned at the cap
   and went 25 to 40 km/h over its own plan, or the superbike beside it that ran wide.
3. **Root causes.** It was not the pace-aware pass lane entering the gravel or the kerb (it is kept 1.5 m inside the lane
   limit and the bikes left the road only after the fall began) and not the lane change exceeding the lean available (the
   lane rate and the lane targets are untouched). Three things were wrong: (a) the GP got closer to a slower class than it can brake behind,
   and a drop of the cap became a *snapped lever*; (b) of 484 pass attempts only 4 were completed, 302 ended
   `STRAIGHT ENDED` in a braking zone, and 20 % of those at over 245 km/h ended in a rear slide, because most were set up
   on corner exits with the GP still slower than the car; (c) the planner judged conflicts where the cars are now, not
   where the lines will have moved, and put the car ahead off the road.
4. **Fix** (`src/simulation/traffic.ts`, `bike-ai.ts`; physics stays **v22**, it is unreleased): a pass starts only when the
   rider is *closing* on the car (1.5 m/s) with **600 m of straight**; the relative-motion closing rule holds only with
   **400 m** of straight left (into a corner the follow reserve is back); the distance it keeps opens over 3 s after a
   pass instead of at once; lane conflicts are judged at the moment the paths meet and the slower car is kept on the
   road; a GP held back by a slower class **squeezes the lever** (applied at 2/s by 65 m/s instead of 8/s) and uses **60 %** of it
   unless the deceleration needed to stay clear rises to 6 m/s2 (which also brakes a rider whose leader is braking for
   the flag). **Single-class fields are bit-identical to `f3f241d`** (36/36 pure-GP races: race time, best lap, falls,
   passes and abort reasons identical).
5. **Not met, and why** (section 6): `scripts/bike-race.ts` crashes are 2, main's are 1 (one extra, a pure-GP 8-rider
   race at Aurel that is `f3f241d`'s launch change in a single-class field and that this branch leaves bit-identical);
   Montejaral still has 1 fall in 16 mixed races (hairpin, section 7); mixed GP-faster is only 0/8 to 5/8 at Aurel,
   Kansai East and Montejaral, where there is no straight to pass on (section 5).

## 1. Baselines (same command, same seeds, three trees)

`node --no-warnings --experimental-transform-types scripts/studio/tools/bike-ai-sweep.ts <7 circuits> gpr1,sbk1000,gpr1,sbk1000,gpr1,sbk1000 6 2 <firstSeed> 8 --trace --ruleset=gp-motorcycle`
(the ruleset makes no difference to a seeded mixed race: checked, identical). Main = `ebaf773`, `f3f241d` = the merge
parent, final = this branch. "GP faster" = best GP lap < best superbike lap. Cells: falls (races with a fall) / GP faster.

**Set A, seeds 5000 + 37 k, k = 0..7**

| Circuit | main | `f3f241d` | final |
| --- | --- | --- | --- |
| aurel | 0 (0) / 0 of 8 | 0 (0) / 4 of 8 | 0 (0) / 4 of 8 |
| parco-reale | 0 (0) / 1 | 3 (2) / 8 | 0 (0) / 8 |
| loirette-club | 0 (0) / 8 | 3 (2) / 8 | 0 (0) / 8 |
| haarveld | 0 (0) / 8 | 7 (5) / 7 | 0 (0) / 8 |
| vellamar | 0 (0) / 0 | 2 (2) / 5 | 0 (0) / 6 |
| kansai-east | 0 (0) / 1 | 2 (1) / 3 | 0 (0) / 1 |
| montejaral | 0 (0) / 0 | 4 (2) / 6 | 1 (1) / 1 |
| **all 56** | **0 (0) / 18**, incidents 0 | **21 (14) / 41**, incidents 42 | **1 (1) / 36**, incidents 1 |
| first five x 6 seeds (30) | 0 / 12, incidents 0 | 10 (8 races) / 22, incidents 14 | **0 / 26**, incidents **0** |

**Set B, seeds 3303 + 37 k, k = 0..7** (the first five circuits x 6 seeds is the previous agent's sweep: 4 falls, 8 incidents)

| Circuit | main | `f3f241d` | final |
| --- | --- | --- | --- |
| aurel | 0 (0) / 0 of 8 | 1 (1) / 7 | 0 (0) / 5 |
| parco-reale | 0 (0) / 3 | 1 (1) / 8 | 0 (0) / 8 |
| loirette-club | 0 (0) / 8 | 0 (0) / 8 | 0 (0) / 8 |
| haarveld | 0 (0) / 8 | 3 (3) / 5 | 0 (0) / 7 |
| vellamar | 0 (0) / 0 | 0 (0) / 7 | 0 (0) / 8 |
| kansai-east | 1 (1) / 3 | 1 (1) / 0 of 7 | 0 (0) / 1 |
| montejaral | 2 (2) / 0 | 2 (2) / 5 | 0 (0) / 0 |
| **all 56** | **3 (3) / 22**, incidents 4 | **8 (8) / 40 of 55**, incidents 13 | **0 (0) / 37**, incidents **0** |
| first five x 6 seeds (30) | 0 / 15, incidents 0 | 4 (4 races) / 28, incidents 8 | **0 / 28**, incidents **0** |

(Main is not fall-free everywhere: two Montejaral start-phase pack falls at t = 17 s and the Kansai East GP chicane.)
Leading indicators over all 112 races (`slides` = GP rear lateral speed above 3 m/s, `offTrack` = episodes past the
road edge): main 123 / 81, `f3f241d` 462 / 184, final 257 / 127. Position swaps GP past superbike: main 104,
`f3f241d` 322, final 222. Mean race time is the same to about a second on all three. Seeded outputs:
`mixed-{A,B}-{main,f3f241d,final}.txt`.

**Pure GP (4 `gpr1`, 3 laps, kansai-east, ardennes, montejaral, fiume-verde, haarveld, poggio-alto x 6 seeds from 5000):**
`f3f241d` and final are bit-identical in all 36 races (3 falls, all Kansai East; `pure-gp-*.txt`).

## 2. The falls of `f3f241d`, traced

`scripts/studio/tools/bike-fall-trace.ts` (new, committed) prints the last seconds of a fall frame by frame: who, where,
speed, lean against its limit, pedals, the traffic cap and the rule that set it, gap, lateral offset and closing speed to
the rider ahead, the planner's decision. `classify` (scratch) summarised all 29 falls (`f3f241d-falls-classified.txt`):

| Class | Falls | Where | The trace |
| --- | --- | --- | --- |
| A. snapped lever at speed | 10 (all GP) | parco-reale 4300 / 4593 / 4278, vellamar 772 / 518, kansai-east 31 / 33, aurel 324, loirette-club 1731, haarveld 3098 | Parco Reale seed 5259 car 2: passing superbike 3 at 284 km/h, `STRAIGHT ENDED` at 7.8 m: the cap changes from the pass's "close up" rule to the follow distance (-20 km/h in one step), lever 0 -> 0.34 in 0.04 s, lateral speed 4 -> 10 -> -5 -> -44 m/s over 1.5 s, lean -1.45. Vellamar 5000 car 4: 10 m behind a superbike at 267 km/h and 3.4 m beside it, it moves to 2.9 m, "in the corridor" (3 m threshold), cap 287 -> 248, same snap. Applying the lever at 2/s (`BA=2`) removes every slide on that trace |
| B. lines overlap | 10 (8 superbike, 2 GP) | haarveld 3454-3465 (seeds 5000, 5037, 5074, 5148, 5185, 3414, 3525; the two GP fell 2 s later at the next corner), kansai-east 88 (a superbike that hit the GP that had just fallen) | The racing line sweeps +4.6 -> -4.6 over 90 m; superbike 3 sits on the lane limit (-4.6) while it does. The planner predicts it at its offset from the line, i.e. -11 m (off the road), so GP 2 (28 km/h faster) sees a free lane and arrives at gap 1 m, lateral 0.4 m. The superbike's heading goes -11 deg in 0.2 s, it runs to lateral -14 m and lowsides at lean 1.25 under the brake (lean limit 0.46 while braking) |
| C. slow corner / hairpin | 5 | montejaral 4138-4146 (3414, 3451), parco-reale 4421, loirette-club 1972 (both bikes) | GP tails a superbike at 10-25 m into the hairpin (closing 20-36 km/h), lever at the 0.30 cap for 2-4 s at lean 0.8-0.9, where braking authority is about 2 m/s2: 25-40 km/h over plan, lateral 10-18 m |
| D. contact | 1 | montejaral 4177 | a rider down on the road ahead of the GP |
| E. other | 3 | montejaral 4164-4283 | the superbike that ran wide at the same hairpin with the GP behind it; a follower |

Pass-attempt statistics (scratch probes `attempts.ts`, `starts.ts`, `swaps.ts` on `f3f241d`'s pass logic plus the first
squeeze, the build before the start gates): over 32 mixed races (2,403 planner events) `STRAIGHT ENDED` above 245 km/h
was 236 events, 48 followed by a slide (20 %), 1 by a fall; in 12 races, at 16-30 m behind the car 14 of 34 slid (41 %).
Of 484 attempts that ended (24 races) **4** were completed; 442 of the 484 were set up with the GP *slower* than the car
(dv < 0), on corner exits, from the runway estimate alone (`freeSpeed` is the 338 km/h the AI aims at, not the 260 to
300 the bike reaches). Where the GP did take places (51 swaps in 24 races) 27 were above 60 m/s and 26 under the
brakes, only 9 under a pass the planner had set up.

## 3. What was changed

| File | Change |
| --- | --- |
| `src/simulation/traffic.ts` | `PASS_PACE`: `closeMin` 1.5 m/s and `startRunway` 600 m to start a pass; `settleRunway` 400 m for the class-wide relative-motion rule (else the follow reserve); `ease` 3 s for the distance to open after a pass; `meets()` predicts the slower car on the lane limit and where the paths meet (`meetGap` 12 m); `onTrack()` clamps the slower car's predicted lane to the road; `needDecel` (deceleration to stay clear, plus the leader's own braking) and `slower` published for the rider; `limitedBy` records which rule set the cap (diagnostic) |
| `src/simulation/bike-ai.ts` | `GP_AI_HANDS`: `brakeSqueeze` 2/s between 45 and 65 m/s, `trafficShare` 0.6, `urgentFrom/Full` 3 to 6 m/s2; `heldByTraffic()` (cap under the rider's free speed and plan, plan not asking for braking, a slower class ahead), `urgency()`; the cool-down cap (0.2) rises to the whole lever when the car ahead is about to be hit (a finished GP behind a superbike at the flag: rear-end collisions in 4 Parco Reale races on the way) |
| `src/simulation/ai.ts` | `trafficSpeed` `protected` (read by the bike rider) |
| `src/core/session-identity.ts` | the v22 note; version stays 22 (unreleased) |
| `scripts/studio/tools/bike-ai-sweep.ts`, `bike-fall-trace.ts` (new), `README.md` | `slides`, `offTrack`, `limits` per race; the trace tool |
| `tests/traffic.test.ts` | the three f3f tests keep their meaning (the helper now has the GP closing at 6 m/s, not 5 m/s slower: a pass is set up on closing speed, and the car ahead moves, a car whose body stands still is a stalled one); four new: start gates, relative-motion rule only on a straight, distance opens after a pass, slower car predicted on the road. All four fail on `f3f241d`; the last fails without the clamp |
| `tests/bike-mixed-passing.test.ts` (new) | five seeded mixed races that fell 1-3 times on `f3f241d` (all five fail there) must have no fall; a single-class field never meets the slower-class rules; steps in 10 s chunks (a minute of synchronous races times a vitest worker out) |
| `tests/bike-session.test.ts` | the mixed test now also asks for a margin above 0.15 s (0.61 s) |

## 4. Dead ends (so nobody repeats them), measured on 32 mixed races (set A: haarveld, montejaral, vellamar, parco-reale)

| Variant | Falls (races) | GP faster | Slides | Why dropped / what it taught |
| --- | --- | --- | --- | --- |
| main (follow reserve only) | 0 | 9 | - | never passes |
| `f3f241d` launch only (no pace passing) | 0 | 12 | 19 | the falls are the passing, not the start |
| `f3f241d` | 16 (11) | 26 | 143 | baseline |
| squeeze at every speed + predicted lanes | 14 (12) | 24 | 151 | the squeeze at hairpin speeds made the Montejaral/Haarveld hairpin falls worse: braking is needed on time there |
| ... without the class-wide relative-motion rule | 8 (7) | 21 | 154 | hairpin falls gone, Parco Reale 5: that rule is what protects the 280 km/h approach |
| ... without the squeeze | 7 (7) | 27 | 191 | Vellamar 5: the squeeze is the fix for class A |
| ... without predicted lanes and clamp | 9 (8) | 26 | 103 | Haarveld chicane back (class B) |
| squeeze scaled with speed | 9 (8) | 28 | 152 | right idea (kept), not enough alone |
| + start only when closing, distance opens over 3 s | 11 (10) | 26 | 154 | rarely-completed attempts removed, slides not |
| + lever share 60 % when traffic-held | 8 (6) | 25 | **57** | slides cut by two thirds; adds the flag rear-end |
| + settle and starts on straights only | 6 (3) | 24 | 46 | hairpin falls gone |
| + urgency counts the leader's braking | 2 (2) | 22 | 84 | flag collisions gone |
| + predicted lane only for riders 12 m or more ahead (alongside the swept test decides) | **0 (0)** | 24 | 50 | the 3.5 m band flickered when alongside and put the lever on and off at 260 km/h |

Also tried and dropped: relaxing the gates (`startRunway` 450 / 350, `settleRunway` 250 / 150, `closeMin` 0.5) gave no
GP-faster gain (11 / 11 / 8 of 32 against 10) and no falls: the gates are not what limits the GP at Aurel, Kansai East
and Montejaral; a lane penalty for passing lanes in front of a slower class when there is no straight (5 falls in 3 races
over 56 against 1, slides +25); switching the wake off (slides 107 -> 139, so not a wake instability); and, for the
single-class launch crash, a launch rate of 6, 5 or 4/s (it clears that one race, but that is a perturbation of a
chaotic pack, not a cause, and it costs the standing start `f3f241d` fixed).

Extending the squeeze to every GP rider (single-class fields too) is a real gain, **not adopted**: pure-GP 36 races
3 -> 0 falls, slides 246 -> 151, Aurel 3303 clean; but it breaks `tests/gp-ai-braking-plan.test.ts` "no rider falls at the
montejaral hairpin (seed 1000)" (the 60 % share on a hairpin approach), the rate-only version keeps that test and gains
nothing (1 fall, 250 slides), and gating it on 300 m of straight left made mixed fields fall 8 times in 112 races. The
previous agent's dead ends (lane rate 3 m/s, launch alone, aggressive pass start, hard re-engage of the follow cap) were
not repeated.

## 5. Which circuits benefit

A GP is level with a superbike in corners and 3 to 6 m/s quicker only at the end of a straight, and in a superbike's wake
it loses about 2 s a lap (it did 108.75 s alone at Montejaral, 110.7 s behind one). Passing needs a straight of 600 m,
and the GP gets past only where there is one:

| Alone, 3 laps (s) | aurel | parco-reale | loirette | haarveld | vellamar | montejaral |
| --- | --- | --- | --- | --- | --- | --- |
| GP | 64.08 | 112.48 | 102.40 | 106.10 | 80.70 | 108.75 |
| superbike | 65.83 | 116.37 | 103.68 | 106.08 | 82.63 | 110.17 |

GP faster in the final build (16 races each): parco-reale 16, loirette-club 16, vellamar 14, haarveld 15; aurel 9,
kansai-east 2, montejaral 1. `f3f241d` got Montejaral to 11/16 by passing into the hairpin (class C falls). That is the
trade the brief asked for: on circuits with a long straight the GP passes and does not fall; where the only place to pass
is a braking zone it follows.

## 6. Verification (everything run in this worktree unless stated)

| Command | Result |
| --- | --- |
| `npx tsc --noEmit` | 0 errors |
| `npx eslint` on `ai.ts`, `bike-ai.ts`, `traffic.ts`, `session-identity.ts`, the three test files, both sweep tools; `npx prettier --check` on the same | clean (`ai.ts` was not prettier-clean at `main`, one word changed) |
| `npx vitest run tests/traffic.test.ts` | 15 pass (the 4 new fail on `f3f241d`, checked in a throwaway tree; the clamp test fails without the clamp) |
| `npx vitest run tests/bike-mixed-passing.test.ts` | 6 pass; the 5 races fail on `f3f241d` (checked in a throwaway tree) |
| `npx vitest run tests/gp- tests/bike- tests/motocross-ai.test.ts tests/session-identity.test.ts tests/wildcard-series.test.ts tests/traffic.test.ts tests/race-control.test.ts --no-file-parallelism` | 78 files, **746 tests pass** (includes `bike-session` all, with the mixed test at +0.61 s, `gp-ai-braking-plan`, `gp-tyre-contact`) |
| `node --experimental-transform-types scripts/bike-race.ts` (throwaway tree at the final sources, so `docs/bike-race.json` is untouched) | exit 0, all 19 pass, 2 crashes (aurel clear 3303: 8 `gpr1`, pure GP; haarveld-supersport event, single class supersport, also on main). Main: 1 crash (the supersport one). `f3f241d` per the PM: 3. Aurel rain 2024 (mixed, 8 riders): 431.6 s with 0 crashes (main 414.9, `f3f241d` 440.7) |
| `node --experimental-transform-types scripts/wildcard-races.ts knobblies-on-the-banking,prototypes-and-the-flyover,red-canyon-scramble,supermoto-after-dark,supermoto-meets-the-joker,supermoto-on-the-roof,grand-prix-bikes-on-the-runway --no-write` | 7/7 PASS, impact 0 to 0.01 (`the-long-way-round`, `forest-stage-on-slicks`: dirt AI, not run) |
| pure-GP sweep, 36 races, both trees | bit-identical |
| mixed sweeps A and B, three trees | section 1 |

The extra crash in `bike-race.ts` (Aurel 3303, 8 `gpr1`): GP 5 rides 1 to 6 m behind another GP at 200 km/h on the start
straight, its lever goes 0 -> 0.33 at 207 km/h when the `close` cap (a rider 1 m ahead) drops under it and the rear weaves
(lateral speed up to 39 m/s). It is the snapped lever of class A in a pack with no slower class, which the squeeze would
fix (the extended variant does) but that variant breaks a pure-GP hairpin contract (section 4). Left as it is, bit-identical.

## 7. Still broken / next

* **Montejaral hairpin, 1 fall in 16 mixed races** (seed 5000, GP 2, 76 km/h, lateral 14 m): the GP is 40 km/h over its own
  plan after the chicane at s 3900-4100 (lever pinned at 0.30 for 4 s at lean 0.86, deceleration about 2 m/s2) and 10 to 40 m
  behind a superbike. Same place as the old pure-GP Montejaral defect. Plan the chicane and the hairpin as one corner (a
  roll-rate term), or hold the GP back further in a braking zone behind a slower class.
* **Pure-GP packs weave at 200 km/h** when a `close` cap drops under a rider 1 m behind another: 2.2 slides per race
  against 0.6 for launch alone; fix the squeeze for single-class fields without the 60 % share, or resolve the hairpin
  contract it breaks.
* **GP faster at Aurel, Kansai East, Montejaral** needs passes into corners (late braking), which the AI cannot do safely
  yet; the follow reserve and 2 s of dirty air per lap are what the GP loses there.
* Kansai East's GP chicane before the hairpin (all 3 of the pure-GP falls in 36 races; 1 mixed fall on main, set B).
* Not run: browser journeys (no UI changed), the full vitest suite, `npm run check`, wet-weather mixed sweeps beyond
  the Aurel rain race in `bike-race.ts`.

## 8. Reproduce

```
# sweeps (from each checkout; main needs the new sweep tool copied in)
node --no-warnings --experimental-transform-types scripts/studio/tools/bike-ai-sweep.ts \
     aurel,parco-reale,loirette-club,haarveld,vellamar,kansai-east,montejaral \
     gpr1,sbk1000,gpr1,sbk1000,gpr1,sbk1000 6 2 5000 8 --trace --ruleset=gp-motorcycle     # set A; 3303 for set B
node --no-warnings --experimental-transform-types scripts/studio/tools/bike-ai-sweep.ts \
     kansai-east,ardennes,montejaral,fiume-verde,haarveld,poggio-alto gpr1 4 3 5000 6      # pure GP
node --no-warnings --experimental-transform-types scripts/studio/tools/bike-fall-trace.ts \
     parco-reale 5259 gpr1,sbk1000,gpr1,sbk1000,gpr1,sbk1000 2 8 0.25                      # a fall, frame by frame (f3f241d)
```
