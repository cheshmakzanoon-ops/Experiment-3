# Initial venue lighting preparation

## Observed defect

`VenueLighting` creates four `PointLight` slots with zero intensity and Three's default `visible = true`. `VenueLighting.update` selects the nearby sites, fills their intensities and hides every slot during daylight. Before this correction, `RacingRenderer.prepare` compiled the circuit before invoking that update; the first warmup draw then changed the visible point-light count from four to zero.

In the locked Three 0.180 renderer, `compile` collects visible lights and uses their count in the generated material program. Zero intensity does not remove a visible light from that count. The old daylight startup therefore prepared a four-point-light variant that the first real draw immediately replaced with a zero-point-light variant. This affected each applicable material program, not just the four lamp meshes.

The November 19 settings evidence for source `6325e6a` reached the ordinary paused Aurel grid just after the existing 60-second readiness assertion expired. Its recorded long tasks included 22.1 seconds and 9.45 seconds during preparation. This evidence motivated the review; it does **not** by itself attribute either duration exclusively to the incorrect light variant.

## Correction

Before the first material compilation, preparation now calls the existing venue update using the prepared followed car's position and the same light-mode mapping as `draw`:

| Prepared view | Visible venue light slots | Existing strength |
| --- | ---: | ---: |
| Daylight circuit | 0 | 1, with lamps disabled |
| Sunset circuit | Up to 4, matching available nearby sites | 0.18 |
| Night circuit | Up to 4, matching available nearby sites | 1 |
| Studio photo, including a night venue | 0 | 1, with lamps disabled |

The first draw still performs the normal weather-aware update. No mesh, material feature, quality setting, shadow caster, pit actor, camera warmup, GPU completion check, timeout or publication requirement is removed. The source frame and simulation clocks are untouched. There is no persistent new cache or render target.

## Verification and limits

Four regressions execute the actual `RacingRenderer.prepare` method with a real Aurel `VenueLighting` owner and enumerate lights using Three's visible traversal. A negative control first confirms that a newly constructed owner exposes all four zero-intensity slots. Every compilation then sees exactly the intended slot count; both camera warmups, both GPU readiness checks and pit-service preparation still execute, and the supplied frame remains unchanged.

The startup, compilation ownership, pit warmup and GPU fence suites pass **59 tests across four files**. Scoped ESLint, formatting and whitespace checks pass. Changed-source GPU/full-grid CI remains the required timing and visual evidence. No frame-rate increase, startup-time reduction or resolution of the complete browser suite is claimed from these CPU checks.
