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
