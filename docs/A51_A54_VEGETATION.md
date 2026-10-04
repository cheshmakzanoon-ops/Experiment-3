# A51–A54 — authored Aurel vegetation integration

## Scope

Continues the retained `18b8306` application and `ea141d3` explicit authoring
increment. This revision installs the authored tree library in the production
Aurel factory; Vellamar retains its existing planting. No vehicle dynamics,
physical circuit geometry, race rules, supplied player model, cockpit mesh or
driver source is replaced.

Six original broadleaf, columnar and orchard forms have three matched geometry
tiers, packed foliage/bark maps and editable native grove/row compositions.
`scripts/aurel-vegetation.blend`, `public/models/aurel-vegetation.glb` and the
integrity manifest are the matched output of authoring run `37221137885`, which
successfully reopened the retained native source and compared its GLB export.
The runtime library is 914,188 bytes. The former one-shot source-object workflow
is removed; ordinary installs, tests and builds do not patch source or run Blender.

## Placement and presentation

`aurel-vegetation-plan.ts` preserves the established near planting, grove and
skyline generators, then checks full exported crown envelopes against the nearest
track segment, stand/service/district/landmark footprints and recovery approaches.
Two managed Orchard plots use 8.5 m along-row and 10 m across-row spacing. Rows
replace overlapping scatter instead of being added on top; combined foreground
planting retains the 650-tree cap. Rejected sites are not moved into corridors.

`aurel-vegetation.ts` loads and validates the bounded, hash-checked GLB. Paired
forms retain distinct position/normal/UV streams but share material draws through
binary per-instance selection. All three tiers are packed at load time; camera
cuts change draw ranges rather than creating new meshes or buffers. Main-camera
LOD hysteresis remains separate from reflection/inspection views. Distant groves
and the skyline remain economical. Small-leaf alpha coverage is preserved during
texture minification, without converting zero-alpha gaps to opaque card edges.

The renderer restores texture-budget source ownership before asset owners close
source bitmaps. Disposal, download cancellation, malformed assets, placement,
geometry identities and alpha coverage have focused regressions.

## Reproduction and evidence

```sh
npm ci
npm run check:stable
npx vitest run tests/aurel-vegetation.test.ts
npx playwright install --with-deps chromium
npx playwright test e2e/aurel-vegetation.spec.ts e2e/p0-cockpit-framing.spec.ts
```

The new `A51-A54 vegetation validation` workflow retains exact source, build,
matched Orchard comparison captures, lap-camera surveys, current cockpit capture,
resource identities and error/budget measurements. The comparison temporarily
substitutes the retained procedural planting in one frozen scene; it is explicitly
not a historical screenshot or a different simulation state. The normal full CI,
all browser partitions and independent wet GPU gate still authorize publication.
A focused workflow alone does not authorize a playable release.

## Acceptance boundary

This integration must pass its own checks; it does not inherit the green base
commit's results. At the initial integration commit, the authored-source
round-trip is verified, while integration tests and browser evidence are pending.
Final visual approval, a continuous human-driven lap and representative hardware
frame times remain independent open gates. Pixel differences demonstrate a
changed image, not artistic quality. Fixed cameras are not human driving and
software-rendered timings are not a consumer-GPU performance claim. These limits
must remain explicit in subsequent validation records.

## Validation continuation

The integrated `fc465daa` source passed the complete local stable check: 1,755
unit tests in 198 files, ESLint, TypeScript and the production build. Its GitHub
full-CI validation and numerical-scenario jobs also passed in run `37228343173`.
This executor reopened the retained `.blend` with pinned Blender 5.2.2 and produced
a byte-identical GLB. Local Chromium navigation was attempted and rejected with
`ERR_BLOCKED_BY_ADMINISTRATOR`; it is not recorded as a browser pass.

A subsequent focused regression exposed alpha-byte quantization at a downscaled
cutoff: input alpha bytes 254 and 255 both rounded to 115, making requested 50%
coverage become 100% at cutoff 0.45. The correction preserves the selected
histogram partition after quantization, leaves RGB and zero-alpha holes alone,
and is checked against 2,304 histogram/target/cutoff combinations. Both failing
regressions were executed before the correction and passed afterward.

Release verification now also checks the vegetation GLB's declared path, size
and SHA-256 before interacting with release APIs. Missing and same-size-corrupt
vegetation assets are covered by the branchless publisher's negative controls.
The continuation passed 18 focused tests plus lint and TypeScript locally; these
results do not substitute for its own full CI or browser/release outcomes.

The integrated `fc465daa` production surveys passed in daylight, sunset and wet
night in workflow `37228343195`, producing 20 landscape images and one normal
cockpit capture per lighting condition. Each survey measured 2,299 trees
(including 66 Orchard trees), 139 spatial/family chunks and 278 instanced meshes.
Closed camera/lens cycles preserved exact GPU memory and geometry identities,
and existing inspection/cockpit draw budgets passed without relaxed thresholds.
There were no reported page, console or WebGL errors. Sunset comparison images
were inspected: managed rows, branching and more varied silhouettes are visible;
the wider terrain still needs refinement. These captures certify the stated
structural/rendering checks on `fc465daa`, not final art or subsequent commits.

The initial day job's second Playwright invocation overwrote its HTML report: the
JSON measurements survived, but only the cockpit regression images remained in
that artifact. Sunset and night retained all 21 images. The follow-up explicitly
separates the cockpit HTML output directory and uploads both report directories;
no test or assertion is removed. Fresh day evidence must be read from that run,
not claimed to exist in the earlier overwritten report.
