# Agent 35 — Rider acceleration audit; current blend retained

Date: 2026-11-25. Assignment 35 of 60, wave 6. Reviewed after the reconciliation that superseded assignment 09's global blend.

## Decision and scope

**No production or test changes are retained.** The current local Hermite join is C1 and has a persistent acceleration corner. Two independently derived local C2 alternatives preserve its authority and slope constraints, but the measured public vehicle motion does not justify either change. Root accepted this no-change decision, and assignment 36 was informed that `rider-weight.ts` is released unchanged.

The retained artifacts are the read-only audit `scripts/bench/motocross-rider-acceleration.ts`, its output `evidence/35-rider-acceleration.json`, and this report. The audit temporarily replaces only `RiderWeight.prototype.pose` and `poseRate` in its own Node process, restoring both in `finally`. It never writes engine source. `step`, reset, physical stroke/displacement, protocol fields, non-MX paths, models, meshes, materials, assets and authored environments were not edited. The existing in-memory level test patch isolates automatic brake bracing; it does not change a venue.

## Confirmed residual

Write `a` for the automatic posture, `p` for the manual stroke, `R = 0.15`, `u = |p|/R` and `s = sign(p)`. The current blend inside the join is

```text
B(p,a) = a + p(1-sa) + a(1-sa)R g(u)
g(u)   = u(1-u)^2
```

Both neutral first derivatives are `1-a²`, so a moving manual stroke has continuous body velocity. The one-sided manual second derivatives are different:

```text
Bpp(0-,a) = -4a(1+a)/R
Bpp(0+,a) = -4a(1-a)/R
gap        = 8a²/R
```

At the real settled braking posture `a = -0.55`, the left and right values are **6.6** and **22.7333333333**, a gap of **16.1333333333**. Differentiating the production analytic `poseRate` with progressively smaller one-sided position offsets confirms that this difference persists:

| Position offset | Current C1 gap | Broad bounded C2 gap | Narrow C2 gap |
| --- | ---: | ---: | ---: |
| `1e-5` | 16.132526667 | 0.011290752 | 0.095821340 |
| `1e-7` | 16.133325267 | 0.000112932 | 0.000959914 |
| `1e-9` | 16.133333114 | 0.000000888 | 0.000009437 |

With constant automatic posture, the corresponding time-acceleration jump is `8a²/R * velocity²`. A settled full reversal of the existing critically damped physical stroke crosses neutral at approximately 0.2797245 s with speed 3.7598123 normalized units/s. Its limiting acceleration jump is therefore about **228.0638 normalized body units/s²**. The existing outer joins at `p = ±R` are also C1: their interior second derivative is `2a(1-sa)/R`, while the outer linear segment has zero second derivative. These are mathematical limitations of the current mapping, not failing claims in the existing C1 tests.

## Alternatives evaluated

### Broad integrated derivative

Keep the same expression for `B`, replacing `g` with an integral of `q`. For `H(t)=t²(3-2t)`, the piecewise derivative is

```text
0 <= u < 1/3:   t=3u;          q=(1-t)^2(1+2t-5t²/3)
1/3 <= u <5/9:  t=(9u-3)/2;    q=-H(t)/3
5/9 <= u <7/9:                 q=-1/3
7/9 <= u <=1:   t=9(1-u)/2;    q=-H(t)/3
```

`q` is C1, lies in `[-1/3,1]`, and satisfies `q(0)=1`, `q'(0)=0`, `q(1)=q'(1)=0`. Its positive area is `4/27`; its negative area is `-4/27`. Therefore `g(0)=g(1)=0` and its exact maximum remains `4/27`. Neutral, all internal joins, and both outer joins become C2. The matching analytic tangents are

```text
Bp = (1-sa)(1+sa*q)
Ba = 1-|p| + (1-2sa)R*g
bodyRate = Bp * stroke.velocity + Ba * automaticRate
```

The bounded `q` preserves nonnegative manual gain and the maximum gain `8/3`. The maximum correction from the established outer linear mapping remains exactly `8R/27 = 0.044444444444…`. This candidate preserves all requested identities and range constraints, unlike the superseded global assignment 09 candidate. However, forcing the neutral and outer curvatures to zero redistributes acceleration into steeper interior regions.

### Narrow curvature correction

The second candidate keeps the current curve except within `|p| < 0.0075` and the outer bands `0.125 < |p| < 0.15`. For `D=0.05`, `k=2`, define `w=u²(1-u/D)^3` inside the neutral band and zero outside, and `K=sa+k*a²(1+sa)`. Subtract `2K*w` from the current `g`. This matches position, slope and curvature at the band boundary and gives both neutral second derivatives the common value

```text
-4a(1-a²)(1+k*a²)/R
```

which is 16.41915 at `a=-0.55`. Near the outer join, subtract `v²(1-v/E)^3`, with `v=1-u` and `E=1/6`. This makes the outer curvature zero without changing the interior maximum. The audit differentiates both the `a`-dependent correction and its manual dependence analytically; it does not reuse an incompatible old `poseRate`.

The narrow candidate avoids the broad candidate's large peak increases, but its neutral band is narrower than one fast-stroke sample at 120 Hz. It supplies no measured benefit in those 120 Hz reversals.

## Actual public vehicle comparisons

Both MX250 and MX450 were placed on the existing level laboratory patch using `DirtBikeVehicle.place`, held braking with full manual input for five seconds, then reversed for 0.6 seconds using ordinary inputs and `DirtBikeVehicle.step`. No pose, automatic posture, suspension load or internal stroke was injected. Automatic bracing remained `-0.55`, speed remained zero, and every bike remained ridden, grounded and uncrashed. The results are identical for the two bike definitions in this parked experiment; the JSON retains all 36 runs.

The following peaks are finite differences of the **actual public analytic `riderBodyRate`**, in normalized body units/s². Direction is the initial held stroke.

| Cadence | Direction | Current C1 peak | Broad C2 peak | Narrow C2 peak |
| --- | ---: | ---: | ---: | ---: |
| 120 Hz | -1 | 208.466 | 266.427 | 208.466 |
| 120 Hz | +1 | 233.241 | 255.053 | 233.241 |
| 240 Hz | -1 | 262.125 | 348.076 | 265.026 |
| 240 Hz | +1 | 301.179 | 365.097 | 303.045 |
| 480 Hz | -1 | 278.538 | 361.242 | 275.231 |
| 480 Hz | +1 | 311.844 | 397.697 | 315.576 |

The broad candidate raises every peak by **9.35–32.79%**. Its sampled neutral acceleration-gap metric also worsens in four of these six cases; for example, at 240 Hz in the -1 direction it rises from 156.448 to 270.388. The narrow candidate leaves both 120 Hz peaks and crossing metrics unchanged to roundoff, raises three of the four higher-cadence peaks, and lowers the fourth. Its maximum peak increase is **1.20%**. C2 continuity is established asymptotically, but these sampled results do not show a consistent motion improvement.

The acceleration-gap metric compares rate secants wholly on each side of neutral and excludes the interval spanning the crossing. If `k` is the first sample across neutral, it is `abs((rate[k+1]-rate[k]-rate[k-1]+rate[k-2])/dt)`. It is a local numerical diagnostic, not a perceptual score. The audit includes every raw scalar metric and hashes of the independent physical stroke's position, velocity and displacement sequence.

## Preservation and verification

For each of the three mappings, 241,401 position/automatic pairs pass the original bounds and monotonicity requirements. Exact neutral, full authority, zero-auto and unchanged outer mapping are retained. All three retain the exact dense-grid maximum correction `8R/27`; every public brake reversal retains the existing **`<0.019`** maximum correction assertion. Neither requirement was relaxed.

The joint manual/automatic derivative is checked at 765 combinations including neutral, every candidate's internal boundary and both outer joins. Maximum central finite-difference errors are approximately `1.93e-5` for current C1, `1.47e-9` for broad C2 and `5.32e-9` for narrow C2. At offset `1e-9`, the largest candidate one-sided curvature gap over all sampled joins is below `1e-4`. Sampling pose/rate leaves physical stroke state unchanged.

Both bike definitions then launch from the actual Ridge Table via the existing approach controller and reverse manual input during 0.8 seconds of uninterrupted free flight at 240 Hz. All **192 samples** per bike remain ridden and airborne with zero contact force. Every recorded physical value is exactly identical across all mappings: `s`, `x`, `z`, `cgY`, `vy`, pitch, pitch rate, front spin and rear spin. Body poses do differ, confirming that the alternatives exercised the public presentation mapping. This is an airborne-state preservation check; it does not claim that changed grounded body bracing could never influence grounded load distribution.

Existing suites were run without edits or npm lifecycle hooks:

```sh
node node_modules/vitest/vitest.mjs run \
  tests/motocross-rider-blending.test.ts \
  tests/motocross-rider-weight.test.ts \
  tests/motocross-body-transport.test.ts \
  tests/motocross-posture-transport.test.ts \
  tests/motocross-motion-boundary.test.ts \
  tests/motocross-rider-timing.test.ts \
  tests/motocross-rider-motion.test.ts \
  tests/motocross-wheel-motion-consistency.test.ts --maxWorkers=1
```

Result: **8 files, 133 tests passed**, 24.87 s. The audit itself passes all assertions and targeted ESLint passes. Prettier formatted only the new audit script. No full-repository typecheck, npm hooks, build, browser or GPU test was run by this assignment. The first audit invocation without the transform flag stopped on the repository's TypeScript parameter properties; the successful reproduction command is:

```sh
node --experimental-transform-types scripts/bench/motocross-rider-acceleration.ts \
  > docs/engine/mx-dynamics-2026-11-25/evidence/35-rider-acceleration.json
node node_modules/eslint/bin/eslint.js scripts/bench/motocross-rider-acceleration.ts
```

This evidence concerns CPU command interpolation and sampled derivatives. It does not establish rendered perception, physical rider accelerations in SI units, or a universal impossibility of a better C2 curve. It establishes why these two tested alternatives were not shipped and explicitly leaves the current C1 acceleration corner open.

## Source identity

Checkout HEAD during the audit was `ec2c75ccf3fa6cdf81c734977edc74105cdf52e1`, with concurrent accepted ground-physics work in the shared tree. SHA-256 identities recorded by the audit:

| Source | SHA-256 |
| --- | --- |
| `src/simulation/offroad/rider-weight.ts` | `5027085c4bb2b192d89a0368d56ca9296b34ed5130e936db0741eed30304ad96` |
| `src/simulation/offroad/dirt-bike-vehicle.ts` | `7fa932378aa37f4e93a51900e3e40f3aafa16a2c87f1a65537f5799fa31fa272` |
| `src/simulation/offroad/mx-ground-physics.ts` | `68b04234548a2b037f4769d38343c26ec712a61fd9261fd6dac44641c81ca4e3` |
| `tests/motocross-rider-blending.test.ts` | `f3c42dd285ed4c00e003861533e6e95ff453502858e94f5e20bfd168120f7f2e` |
| `scripts/bench/motocross-rider-acceleration.ts` | `4771c12423901d3db8ba8dfaca81a3a08abf4514d7578240d0286e785e1a7df1` |

No commits or pushes were made by assignment 35; root owns publication.
