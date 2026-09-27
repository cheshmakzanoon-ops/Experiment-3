# Supplied player integration: verified handoff

Date: 2026-09-27 UTC.

## Published source

- Main integration: `9d602edd30dfde54073f1b958e9fabbf70ff3b2d`.
- Verified surface/ride-height correction: `cf9c2aac7f0f0ce7585d22a552d1d56fdcc83753`.
- Runtime GLB SHA-256: `013a47f059bf34a0a28bd31ae8f407f07ed6e2b55755753aed9a942c895e132b`.
- Compressed asset SHA-256: `269b4d94c07602582070f1f48bc2e3a778f62d2e1cfcc26b021f52f79ad5ef3a`.
- `public/models/supplied-player.glb.gz`: 36,134,058 bytes, actual binary, not an LFS pointer.

The first validation run was 36346119118. Visual inspection of its retained
Chromium captures found two issues beyond the original numerical assertions:
scalar height textures interpreted as RGB normals, and a source/physics
suspension-datum mismatch. The correction and regression assertions were then
validated again, rather than treating the first passing tests as visual approval.

## Final validation

GitHub Actions run: https://github.com/cheshmakzanoon-ops/Experiment-3/actions/runs/36347168575

The runner checked out the publication workflow's main commit, verified the
SHA-256 of a five-file correction payload, checked each original file hash before
applying it, and tested the resulting source. It then fast-forwarded main to the
correction commit above. No forced ref update or unrelated file replacement was
used. The temporary publication/toolchain workflows are removed in this handoff;
the existing normal CI and permanent regression tests remain.

| Check | Result |
| --- | --- |
| ESLint | Passed |
| Unit suite | 1,219 passed in 121 test files |
| TypeScript and production Vite build | Passed |
| Actual GLB studio test | 1 passed; seven captured poses/views |
| Normal application tests | 3 passed; eight full-resolution game captures |
| Playwright retries / flaky / skipped | 0 / 0 / 0 |
| Studio WebGL error | 0 |
| Studio source simulation frames mutated | No |
| Source grayscale height-map bindings restored | 10 |

The actual exported 58-joint skeleton was exercised through neutral steering,
both locks, pause and rewind. Wrist positions remain fixed in the wheel's frame
within the 25 mm regression tolerance; the measured drift in the dedicated CPU
audit was below 0.000001 m. The browser fixture also verifies that chassis-frame
wheel hubs equal the simulation's hardpoint height minus its recorded absolute
suspension length, and that camera sockets receive the datum translation once.

The normal application test enters practice through the normal UI, applies
keyboard countersteering, cycles cockpit/pod/trackside/chase views, and seeks the
recorded replay forward and backward while checking the frozen worker frame.
Missing required AI-driver or supplied-player assets produce explicit load
errors, not a silent legacy-car fallback. The tests do not modify simulation
frames or substitute a synthetic driver for the supplied rig.

## Retained evidence

The final run contains these artifacts (GitHub retention: seven days):

- `supplied-player-corrected-studio`, artifact 10940497743: seven captures and
  actual-model fit/rig measurements. Archive SHA-256:
  `96ea360cc8177538f08461e2e917d57b9841c8e795ed13e61a5abcd857b2b935`.
- `supplied-player-corrected-validation`, artifact 10941540665: normal-game
  screenshots, recordings, diagnostic JSON, full check log and published commit.
  Archive SHA-256:
  `75c9c1bcf20d129d19b8122d9b567af455ec3a26b6ce1a7bd0d05827d44a5dfa`.

The corrected studio exterior/POV and normal-game cockpit/chase captures were
visually inspected. Blender previews were not substituted for Chromium evidence.
The editable combined Blender file and downloadable evidence were also returned
with the implementation handoff rather than adding extra source archives to Git.

## Reproduce

```sh
npm ci
npm run check
npx playwright install --with-deps chromium
npx playwright test e2e/39-supplied-player.spec.ts e2e/24-coupled-driver.spec.ts
```

This records the focused player-integration validation, not a claim that every
browser test, long endurance scenario or physical-hardware performance gate has
passed. No fixed FPS, final-art certification or separate hosted-site deployment
is claimed. See `SUPPLIED_PLAYER.md` for controls, provenance and remaining scope.
