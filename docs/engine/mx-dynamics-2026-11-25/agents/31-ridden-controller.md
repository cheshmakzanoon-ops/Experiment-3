# Agent 31 — committed landing-plan lifetime

Date: 2026-11-25. Wave 6, assignment 31 of 60.

## Delivered and released

Retained one controller correction: a locked clear plan now remembers its
**first qualifying touchdown time**. The existing 250 ms settling allowance
survives a small physical rebound replacing `lastLanding`. Later hops do not
renew that deadline. Upstream traffic and flag speed caps remain authoritative.

Owned changes are limited to:

- `src/simulation/offroad/ai.ts`: the optional plan timestamp and its use in
  the existing inside-gap handoff.
- `tests/motocross-landing-plan.test.ts`: nine temporal controller regressions.
- This report.

No forces, damping, actuator limits, jump speeds, crash thresholds, venue data,
models, character assets, or existing test assertions were changed. No generic
wheelspin bypass or throttle-reserve variant is retained. Production ownership
is released. **The integrated Arena ridden-lap gate remains red**; this is a
bounded controller lifetime fix, not a claim that every landing now succeeds.

## Confirmed defect

The old inside-gap branch exempted a committed clear from the walking-speed
target only while the *latest* landing record had more than 120 ms airtime and
was less than 250 ms old. That record correctly changes whenever the bike
contacts again. Consequently, a tiny rebound could cancel the allowance early;
a second longer hop could instead start a fresh 250 ms window.

The stable post-projection diagnostic demonstrates the early cancellation:

| Venue | Original touchdown | Rebound record | Resulting command |
| --- | --- | --- | --- |
| Valley Ridge | t136.287682, 1.479349 s airtime | t136.446905, 0.071905 s airtime | Plan cleared and target fell from about 21.7 to 4 m/s after about 159 ms |
| Arena Nord | t139.255972, 1.418472 s airtime | t139.347513, 0.005846 s airtime | Plan cleared and target fell from about 18.5 to 4 m/s after about 92 ms |

Both commands then requested full front braking while the chassis was already
rotating nose-down after rear compression. The original landing must not be
reclassified as a beached gap rider merely because its live contact record
changes. The first impact and suspension response remain real and must still
be resolved by physics.

The new timestamp belongs to the existing plan object, so replacement plans
do not inherit it. It arms only from a qualifying, current, nonfuture landing
on that same jump. Once armed, the rule remains:

```text
0 <= vehicle.clock - firstTouchdown <= LANDING_RULES.settleSeconds
```

The returned target is still `desired`, which already contains upstream race
control and traffic restrictions. A zero target remains zero. Expiry, clock
reset, a rolling plan, or an unrelated/stale landing falls through to the
existing inside-gap policy. There is no additional force, steering override,
automatic pose change, or extended recovery timeout.

## Focused regression evidence

The nine new tests invoke the real planner with controlled landing telemetry.
They isolate plan lifetime; they are not fabricated claims of complete physical
jump execution. The separate real riding traces establish the triggering
sequence.

Before the source change, **6 failed and 3 passed**. Afterward, **9/9 pass**:

- Both bikes preserve the original window across a 6 ms rebound.
- A later qualifying hop cannot renew the first touchdown deadline.
- Zero, 0.5 m/s and 3 m/s upstream caps remain exact, without erasing the
  unexpired plan.
- Small, stale, future and other-jump records cannot arm the allowance.
- A replacement rolling plan does not inherit it.
- A reset vehicle clock expires it safely.

Executed directly, without npm lifecycle hooks:

```sh
node node_modules/vitest/vitest.mjs run \
  tests/motocross-landing-plan.test.ts \
  tests/motocross-ai.test.ts \
  tests/motocross-jump-corridor.test.ts \
  tests/motocross-forgiving-handling.test.ts --maxWorkers=1
```

Combined result: **80 passed, 3 failed, 83 total**, 33.87 seconds.

| Suite | Result |
| --- | --- |
| New landing-plan lifetime | 9/9 passed |
| Existing AI clear/roll, traffic, recovery and settle contracts | 42/42 passed |
| Existing forgiving handling | 17/18 passed; Valley's complete ridden-lap gate passes |
| Corridor/guidance | 12/14 passed; both AI physical shoulders pass, both ridden shoulders land short of the unchanged longitudinal lower bound |

The ridden shoulder stations were 468.147644 m and 468.430547 m against the
unchanged lower bound 468.788220 m. No assertion was changed to accept them.
The failed Arena lap reports two falls before reaching its stall assertion;
the separate diagnostic below also exposes a 1.308333 s stall.

Focused ESLint and `git diff --check` passed. A targeted strict TypeScript
project including the changed planner and new test passed at a 512 MB heap.
The first temporary-config invocation could not locate ambient types from its
external directory; explicit runtime type roots corrected that configuration.
No full-repository typecheck was run by this assignment.

## Rejected runtime-only experiments

These experiments modified only the diagnostic's live controller instance.
They never replaced production source or edited calibrated tests. Each listed
run has matching before/after hashes for the diagnostic's five engine sources.
They used the post-agent-27 physics **before** the brake/contact follow-ups in
29/30, so they are not final integrated acceptance numbers.

| Experiment | Valley result | Arena result | Decision |
| --- | --- | --- | --- |
| Unchanged post-27 controller | 2 laps, one front fall, 0.416667 s stall | 2 laps, one front fall, 0.591667 s stall | Baseline |
| Retain landing window across record replacement | No fall, later 7.233333 s barrier stall | One front fall, 0.591667 s stall | Demonstrates lifetime effect; not a full-lap fix |
| Suppress all turn-contact throttle reserve during settling | One later corner lowside, 1.266667 s stall | No falls, 0.183333 s stall | Rejected |
| Restore throttle only during rear-only, nose-down settling | Two later lowsides, 0.325 s stall | One front fall, 0.591667 s stall | Rejected |

The lifetime experiment also allowed a second qualifying landing to update its
temporary timestamp. The retained production implementation deliberately keeps
the **first** timestamp, verified by the nonrenewal regression.

The older approximately 5% throttle stall from agent 25 is a different
checkpoint. Its 5% request comes from the shared car-style wheelspin feather,
but the trace is also pinned near the outside barrier. The post-27 baseline
already passes the stall limit on both venues. Therefore no general wheelspin
feather bypass was justified or retained.

## Integrated handoff after 29/30

The final diagnostic used the production plan fix with the then-current
agent-29 braking and agent-30 contact integration. It runs the same two-lap
player-plant setup as `motocross-forgiving-handling.test.ts`: AI marks are
withheld and airborne ground-steering/front-lever requests are released.

| Venue | Completed | Time | Maximum riding stall | Falls |
| --- | ---: | ---: | ---: | --- |
| Valley Ridge | 2 laps | 183.625 s | 0.183333 s | None |
| Arena Nord | 2 laps | 167.158333 s | 1.308333 s | Lowside at s474.642281; flat-impact crash at s468.796889 |

Arena's first remaining incident starts with a shoulder landing at s468.988352,
lateral about +4.866 m, normal speed 8.837877 m/s, and pitch error −0.168969 rad.
It rebounds and subsequently loses front grip near the outside edge. The
second incident touches down at s467.998759, before the surveyed landing zone,
with normal speed 6.249386 m/s. Its subsequent bottoming speed is
8.959850 m/s and the unchanged physical classifier reports `crash-flat`.

The full traces were handed to root for the separate ground-force and flight
reviews. Changes made by those later assignments require a new integrated run;
they cannot be credited to this controller patch.

## Reproduction and source identity

Final diagnostic command:

```sh
node --max-old-space-size=512 --experimental-transform-types \
  /home/agent/mx-lap-agent21-579b454ae846.ts agent31-final-controller
```

The temporary analysis runner and JSON traces remain under
`/home/agent/motobound-diagnostics-579b454ae846/`. Relevant files are
`agent21-laps-agent31-post-projection.json`, `agent21-laps-agent31-latch.json`,
`agent21-laps-agent31-reserve.json`, `agent21-laps-agent31-rear-settle.json`,
and `agent21-laps-agent31-final-controller.json`. The runtime-only variants
are reproducible from `/home/agent/mx-lap-agent31-579b454ae846.ts`.

The final diagnostic's recorded before/after hashes match:

| Source | SHA-256 |
| --- | --- |
| `src/simulation/offroad/ai.ts` | `701fa894de6ae3455ce5cbef1f0351478691815883443b6d158e324775407260` |
| `src/simulation/offroad/dirt-bike-vehicle.ts` | `7fa932378aa37f4e93a51900e3e40f3aafa16a2c87f1a65537f5799fa31fa272` |
| `src/simulation/offroad/mx-ground-physics.ts` | `5ba192c09576465e2b63f377372141430f9ddb574666bc7b711af2b4891dbfe3` |
| `src/simulation/offroad/rider-weight.ts` | `5027085c4bb2b192d89a0368d56ca9296b34ed5130e936db0741eed30304ad96` |
| `src/simulation/offroad/contact-impulse.ts` | `825d280cfd4c1769db8fee0abcdfa91989f4c6b73ac502e120f59f1061afa28e` |

The released new-test hash is
`923897cfbbe7c834a32935e052a16e9a427b8344fde9e55df8ce40b1572a8b59`.
The starting planner hash was
`af74fb9ae81eddc305f565b91c8488d518211f32da140ba811ca2aa8e8971982`.

No git mutations, installation, child agents, or publication were performed.
