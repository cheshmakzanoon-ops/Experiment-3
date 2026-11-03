# IP / legal asset audit and hero car (release gate G15)

Branch `studio/legal-ip-hero-car`, cut from `main` at 4b66e0e. Department: Legal/IP asset audit + hero car.
Everything below was measured on this branch; "not tested" is stated where it applies.

**This is an engineering audit, not legal advice.** It records what the repository contains, where
each asset came from according to the repository itself and an independent scan of the binaries, and
which risks remain. Items that need a decision from the owner or from counsel are collected in
section 6. Nothing here clears a trademark, a trade dress or a copyright question.

## 1. Result at a glance

| | Before (main 4b66e0e) | After (this branch, product build) |
| --- | --- | --- |
| Default circuit car APX-01 | `supplied-player.glb.gz`, a model of a real F1 car with real sponsor decal sheets (34.5 MB, 1,455,118 triangles, nodes `RB19_*`) | original authored APX-01: `apx01-shell` + A61 near/mid/far levels + the procedural cockpit (about 228 k triangles near), original violet/volt livery |
| Real-brand binary in `dist/` | yes (`models/supplied-player.glb.gz` 34.5 MB and `supplied-player-lods.bin.gz` 4.0 MB) | no (owner-only, `MOTOBOUND_SUPPLIED_PLAYER=1`) |
| `dist/` size | 166.4 MB | 127.9 MB (-38.5 MB, -23 %) |
| Initial JS (gzip, budget 4 MB) | 3.55 MB | 3.51 MB |
| Real-brand strings in the shipped JS / GLB name tables | 41 hits (sponsor decal keys, `RB19_*`, `p6-rb19-r06-r02`, "supplied-RB19", 10 commercial-game URLs ...) | 0 (`scripts/ip-guard.mjs`: clean) |
| Commercial-game URLs in the bundle (`reference-catalogue.ts`) | yes (about 100 entries, EA / PlayStation / review-site pages) | compiled out (`__REVIEW_TOOLS__`) |
| Third-party notices shipped in the build | only the art `CREDITS.txt` | `THIRD_PARTY_NOTICES.txt`: three.js MIT, Basis Apache-2.0, Saira + Saira Stencil One OFL, CC0 / CC BY attributions; linked from the credits screen |
| Legacy "APEX" visible to players | HUD wordmark, nose panel, workshop wall, tyre brand, default sponsor, `apex-*` export file names, `CREDITS.txt` heading | all renamed; storage identifiers kept (section 4.4) |

What this does **not** do: it does not make the product legally clear. Silhouette and trade-dress
similarity to real cars, look-alike fictional brand names, the real-circuit approximations, the
reference material kept in the repository, and the public deployments that already served the old
build are open (section 6).

## 2. Method

1. Enumerated every tracked and generated binary and authored asset (`git ls-files`, `public/`,
   `src/rendering/*.glb.gz`, `*.manifest.json`, `authoring/`, `reference/`, `tools/`, `playable/`,
   `screenshots/`, `docs/`) and what `vite build` copies into `dist/` (`public/` wholesale, imported
   assets, fonts).
2. Decoded every shipped GLB / gzipped GLB and read its JSON chunk (node, mesh, material, image
   names and `extras`) for brand markers (`scripts/ip-denylist.mjs`). Decompressed the zstd `.blend`
   sources of APX-01, the A61 assembly and the driver and listed their datablock names.
3. Grepped every text source under `src/`, `index.html`, `desktop/`, `package.json` for brand names
   (teams, sponsors, tyre / brake / fuel makers, motorcycle and car makers, series, commercial games)
   and read each hit to separate a string a player can see from a comment or an identifier.
4. Built the product bundle and the owner-only bundle and ran the guard on both, plus the committed
   `playable/` snapshot.
5. Read the provenance claims in `docs/ASSET_PROVENANCE.md`, the authoring scripts and the hash-pinned
   manifests, and compared them with what the binaries actually contain.

Limits: authorship ("original, authored by a script or by hand in Blender") is **self-attested** by
the repository (scripts, manifests, git history is a single squashed lineage). The scans show no brand
markers and no embedded third-party images; they cannot prove that a mesh was not modelled by looking
at a real object. Silhouettes, likenesses and trade dress are judgement calls for counsel, not greps.

## 3. Asset table: provenance, risk, action

Risk scale: **blocker** (cannot ship) · **high** · **medium** · **low** · **none**. "Shipped" means it is
in `dist/` of a product build (`npm run build`). Sizes are from the product build unless stated.

### 3.1 Shipped in the game

| Asset | Provenance (as found) | Real-brand / IP markers | Licence | Risk | Action |
| --- | --- | --- | --- | --- | --- |
| `public/models/supplied-player.glb.gz` (34.5 MB) and `supplied-player-lods.bin.gz` (4.0 MB, generated) | Owner-supplied Blender packages of a real F1 car and an F1 driver / cockpit (`sourceSHA256` pinned in `supplied-player.manifest.json`, build audit `docs/SUPPLIED_PLAYER_BUILD.json`), converted by `scripts/build-supplied-player.py`. 1,455,118 triangles, 101 materials, 56 embedded images | Nodes `RB19_BODY`, `RB19_FRONT_WING`, `RB19_MIRROR_0/1`, `RB19_DRS`; materials `Decal \| esso / rauch / hard_rock / bybit / charging_bull / hrc / mobil / infinitum / pirelli / arctic_wolf / zoom / att / cash_app / tag_heuer / oracle / honda / rokt / siemens / front_bull / redbull_wordmark / tyre_pirelli / tyre_pzero`; "Rear DRS \| BYBIT ..."; real team livery and silhouette. Runtime swapped the sheets for fictional marks, the binary, names and silhouette stayed | None granted. `docs/SUPPLIED_PLAYER.md` itself says it does not certify "commercial rights to team/sponsor marks" | **blocker** (was on by default and in `dist/`) | **Fixed in code:** owner-only. Not in `dist/`, not referenced, loader and look-dev tables tree-shaken. Kept in the repo for owner builds. **Owner/counsel:** remove from git history if the repository is ever shared (6.1), check past public deployments (6.2) |
| Code that names the supplied model (`supplied-player.ts`, `studio/supplied-lookdev.ts`, new `studio/supplied-decal-art.ts`) | Authored in this repo around the supplied binary | The decal key table (`esso`, `bybit`, `redbull_wordmark` ...) and `RB19_*` node names must match the owner's binary | Own code naming third-party identifiers | **none** in the product bundle, **medium** in a shared repo | Key table split into one clearly marked owner-only module; none of these strings is in a product bundle (`ip-guard`, `tests/ip-audit.test.ts`) |
| `src/rendering/apx01-shell.glb.gz` (1.1 MB, 41 parts, 2.3 MB raw) | Generated from this repo's procedural geometry (`scripts/apx01-seed.ts` exports `car-surfaces` / `car-floor` / `car-architecture` / `cockpitShell` ...) and authored in Blender (`scripts/apx01-author.py`, `apx01-shell.blend`, "No third-party assets"); hash-pinned | Names are generic roles (`nose`, `sidepod`, `front_paint` ...), materials `APX / paint / carbon ...`; the `.blend` datablocks list only `engine`, `nose`, `sidepod`; no images; zstd-decoded `.blend` has no brand string | Own work | **low** | None. Residual: it is a generic modern open-wheel layout (halo, front / rear wing, floor, sidepods), `finalArtApproved: false` |
| `src/rendering/a61-rival-{near,mid,far}.glb.gz` (1.7 MB total) | A61 refinement of the retained `scripts/apx01-assembly.blend` (source SHA `0f17...` asserted by `author-a61-rival.py`), **not** derived from the supplied model | Same generic names; `author-a61-rival.py` says "supplied player assets are read-only"; no images | Own work | **low** (not tainted by the supplied car) | None. Now also the player's car (see 4.1) |
| `src/rendering/apx01-driver.glb.gz` (0.2 MB) | Original Blender seated-suit geometry (`author-driver.py`, `apx01-driver.blend`), 3 meshes, 9 joints | Material `APX / woven suit`; no external texture, scan or likeness | Own work | **low** | None |
| `public/models/aurel-*.glb` (24 files, 50.6 MB): pit kits, garage, frontage, barriers, gantry, signal hardware, tyre blankets / trolleys, wheel gun, jacks, workshop, quarry, vegetation, cameras, marshal posts ... | Blender 5.2.2 exports of `scripts/aurel-*.blend` authored by `scripts/author-*.py` (several carry "deterministic exporter" generators); embedded images are packed micro-normal / ORM maps (0 to 4 per file) | Zero brand hits in node / material / image names; `author-pit-wall.py` and `author-pit-building-frontage.py` state "no stock art, logos, scans, fonts" | Own work | **low** (self-attested) | None. Aurel is a fictional venue name |
| `src/rendering/aurel-people.glb.gz`, `crew-performance.glb.gz`, `grid-mechanic.glb.gz`, `start-finish.glb.gz` + their `*.geometry.json` / `human-kit.json` tables | Blender / script authored (`author-people.py`, `author-crew-performance.py`, `author-grid-mechanic.py`, `author-start-finish.py`) | No hits; people are anonymous, no likeness | Own work | **low** | None |
| `public/models/solvane/*.glb` + `street-kit.bin` (2.2 MB), `public/models/motocross/trackside/*.glb` (12 files, 2.1 MB) | Blender recipes in `authoring/solvane/*.py`, `authoring/motocross/*.py`; manifests state "no textures, screenshots, fonts or branded logos". Some manifests list `referenceIds`: the modelling was guided by images of a commercial game | No brand hits | Own work | **low**; **medium** only for the "modelled from commercial-game reference images" angle (6.4) | Counsel to confirm that reference-guided original modelling is acceptable to the owner's risk appetite |
| Third-party skies: 13 Ultra-HDR JPEG pairs (8.5 MB) | Poly Haven HDRIs (Greg Zaal, Sergej Majboroda, Sergey Rudavin) via the Kubric public mirror, converted | n/a | CC0 1.0 | **none** (attribution not required, given anyway) | None |
| Third-party textures: `sandy-gravel-01`, `ground-lawn`, `-rock`, `-snow`, `-meadow`, `-forest-floor`, `-dry-earth` (CC0: cgbookcase, ambientCG, Poly Haven) | Pinned URLs + SHA-256 in `assets/third-party/sources.json`; manifest `third-party-manifest.json` | n/a | CC0 1.0 | **none** | None |
| `ground-asphalt`, `ground-wet-earth`, `ground-concrete` | Poly Haven asphalt via glTF-Sample-Assets "Traffic Cone" (hinndia); Amazon Lumberyard Bistro textures (NVIDIA ORCA / `mmp/pbrt-v4-scenes`) | n/a | CC BY 4.0 | **low** (attribution obligation met in game, `CREDITS.txt`, `THIRD_PARTY_NOTICES.txt`) | Keep the attribution; indicate changes (already recorded) |
| Photographic vegetation: 6 trees, 1 shrub, meadow grass (24.8 MB) | Baked leaf cards from the Laubwerk models in the `landscape` scene of `mmp/pbrt-v4-scenes` (Schliep, Kahraman, Dapper), "modified: simplified and baked" | n/a | recorded as CC BY 4.0; the upstream README says only "licensed under a CC-BY license" without a version | **medium** | **Owner:** confirm the licence version and that Laubwerk's own terms for these plant models allow commercial redistribution as baked game art; replace with own vegetation if not confirmable |
| Fonts: Saira Variable (6 `saira-*.woff2` files, `@fontsource-variable/saira` 5.3.0) and Saira Stencil One (`src/ui/fonts/`) | Omnibus-Type, via npm / Google Fonts | n/a | SIL OFL 1.1 | **low**. `docs/ASSET_PROVENANCE.md` wrongly said no font files ship | **Fixed:** copyright lines and the OFL text in `THIRD_PARTY_NOTICES.txt`; provenance doc corrected. Fonts must not be sold alone or renamed |
| three.js 0.180.0 (+ examples add-ons) | npm | n/a | MIT | **low** | **Fixed:** MIT text shipped in `THIRD_PARTY_NOTICES.txt` |
| `public/assets/basis/basis_transcoder.{js,wasm}` | Copied byte-for-byte from `three/examples/jsm/libs/basis` (Binomial LLC) | n/a | Apache-2.0 | **low** | **Fixed:** full Apache-2.0 text and attribution shipped |
| Audio | No sample files exist; engines, tyres, wind, rain, thunder and UI sounds are synthesised in Web Audio (`src/audio/`) | n/a | Own work | **none** | Trailer / store music, if any, still needs a written licence (`LEGAL_CHECKLIST.md`) |
| `public/icon.svg`, `desktop/build/icon.png` | Placeholder "A" glyph from the former name | n/a | Own work | **low** | Replace with the final MOTOBOUND mark before the store build |
| Vehicle / venue / team / driver names (catalogue, sponsors) | Codes such as `GT-8F`, `SC-7`, `GP-R1`; sponsors in `BRANDS` (`VOLTEX`, `NORDFIN`, `KESTREL TIME`, `HALCYON AIR`, `ORBITEL`, `MERIDIAN OIL`, `AUREL BANK`, `VANTA`, `NORTHLINE`, `OBSIDIAN`, `MOTOBOUND`, `SLICK 18`); invented drivers | `validate:content` rejects a protected-name list. **No trademark or domain search has been run** for any invented name; some codes echo real models (`RS-5`, `SBK-1000`, `GP-R1`, `XT-1`) | n/a | **medium** (unknown collisions) | **Owner/counsel:** clearance search for MOTOBOUND and the fictional sponsor names; consider renaming `SBK-1000`, `RS-5` |
| Circuit layouts | 21 venues (6 in wave 1, 15 in wave 2) are "approximations of famous real-world circuits from public geometry" under original names (`docs/ASSET_PROVENANCE.md`) | Names, logos and signage are original; corner sequence follows the real circuits | none | **low / medium** | **Counsel** (6.5) |
| `playable/` is not shipped; see 3.2 | | | | | |

### 3.2 In the repository, not shipped in the game

| Item | What it is | Risk | Action |
| --- | --- | --- | --- |
| `reference/MotoGP26/MotoGP26_PS5_100_Reference_Images.zip` (36 MB, 107 files) | 100 official publisher images of a commercial game, with a README, built by `tools/reference_pack/build_motogp26_reference_pack.py` | **high if the repository leaves the studio** (copyrighted third-party artwork, redistributed). Not in `dist/` | **Owner decision (6.3):** move to a private store outside the shipping repository and purge it from history |
| `tools/build_fh6_reference_pack.py`, `tools/reference_pack/*`, `.github/workflows/build-{fh6,motogp26,motocross}-reference-pack.yml` | Scrape official media of commercial games (forza.net and others) into developer reference zips | **medium** (terms of use of those sites; produces the artwork above) | Remove from the shipping repository with the zip; keep reference gathering private |
| `src/ui/reference-catalogue.ts` and the `docs/production/*REFERENCE*` documents | URLs, titles and paraphrased observations of ~100 commercial-game frames and reviews | was **medium** in the bundle | **Fixed for the bundle** (compiled out). The documents stay in the repo (6.3) |
| `docs/session-artifacts/2026-10-15-scratchpad/` (133 MB: 410 png, 212 jpg, scripts, logs, `asset-scout/` with downloaded KhronosGroup sample assets and their licences) | Scratch dump of an earlier session; origin of the screenshots not recorded | **medium** (unknown third-party images, sample assets with mixed licences) | **Owner:** triage, or delete before the repository is shared |
| `playable/` (3.7 MB) | Committed snapshot of an old web build (legacy name, reference catalogue strings, no supplied model) | **low / medium** (stale; guard finds the commercial-game URLs in it) | Delete or regenerate (the Pages workflow builds from source, nothing reads this folder) |
| `screenshots/`, `docs/studio/reports/*-screens`, `docs/production/*-evidence` | Renders of this game (skies, vehicles, weather, UI); some older evidence directories contain comparison sheets | **low** (own renders; not exhaustively opened) | Spot-check before publishing the repository |
| `scripts/*.blend`, `authoring/**/*.blend` (zstd) | Original Blender sources of the assets above. The supplied sources (`RB19_*.blend`, the cockpit package) are **not** in the repository; only their SHA-256 are | **low** | None |
| `docs/SUPPLIED_PLAYER*.md`, `docs/SUPPLIED_PLAYER_BUILD.json`, `docs/A*/P0_*` docs | Describe the owner-only model; the build JSON still lists the source's own node names | **low** | Docs generalised (4.3); the JSON is an owner artefact, listed for the history decision |
| `.github/workflows/deploy-playable-pages.yml` and the CI `publish` job | Build `dist/` on every push to `main` and publish it to GitHub Pages / a release artifact | **was blocker-adjacent**: until this branch the published build contained the supplied model | **Counsel/owner (6.2):** check the Pages deployment history and the `apex-formula-release` artifacts (30-day retention). CI e2e needs a QA build (4.6) |
| `desktop/` Electron shell | Packages `../dist`; Electron (MIT) and Chromium licences are added by electron-builder; `steamworks.js` is MIT; the Steamworks SDK redistributables are under Valve's agreement; `desktop/package.json` is `UNLICENSED` | **low** | Keep `LICENSE` and `LICENSES.chromium.html` in the depot; no Steamworks binary or app id is committed |

## 4. What was changed

### 4.1 APX-01 is an original hero car (the blocker)

Investigation first: the renderer already builds every car, including car zero, as a `FormulaCar`;
car zero merely swapped its geometry for the supplied asset when that was loaded (`car.ts`
`suppliedAsset.take`). The same `FormulaCar` is what the game rendered for every opponent from the
original `apx01-shell` + A61 assets, so the original car already had a complete, tested rig (steering,
suspension, spin, pit service, damage, brake lights, mirrors, cockpit camera, driver arms from the
vehicle-art audit). The two procedural options were therefore not needed: the original authored
assembly is the better starting point (about 228 k triangles near, 41 mechanical roles) than the
procedural open-wheel catalogue builder (`vehicle-bodies/open-wheel.ts`, which builds the HF-67 /
HF-76 / HF-86 / JF-2 class cars and is a lower-detail, different-era layout; see the vehicle-art
report D6).

Changes:

- `src/rendering/renderer.ts`: the supplied model is loaded only behind a build flag; a product
  build loads the A61 levels for the player too (`rivalLevels` in the showroom as well), so the menu
  showroom, the grid and every camera show the original car.
- `src/rendering/car.ts`: car zero uses the authored A61 levels when no supplied asset is given;
  `setLivery` now also repaints the painted wheel covers (they kept the team-0 colour while the body
  followed the player's livery); the nose identity reads the team title (`VOLTEX / 07`), no legacy name.
- Hero livery (original, no real team uses it): electric violet `#5b2bd6`, indigo-black belly,
  volt accent `#d8ff3c`, metallic finish, `VOLTEX` title sponsor with fictional partners.
  `LIVERIES[0]`, `SCHEME_DETAILS[0]`, `DEFAULT_LIVERY`, `PLAYER_CREW_COLOUR` (the crew kit followed the
  supplied car's navy), preset `copper` -> `voltage`.
- Tyre brand `APEX CORSA` -> `MOTOBOUND` everywhere it is drawn (tyres, GP shells, wall prints, padding).

### 4.2 The supplied model is excluded from product builds

- `vite.config.ts`: `MOTOBOUND_SUPPLIED_PLAYER=1` selects an owner build. Otherwise: `__SUPPLIED_PLAYER__`
  is false, the plugin `owner-only-assets` removes `models/supplied-player*.gz` from the output after
  Vite copies `public/` and drops the orphan chunk Rollup leaves behind for a tree-shaken `import()`, and
  the owner-only modules are marked side-effect free so the dead branches take them (and every real name
  they carry) out of the bundle.
- `src/build-flags.d.ts`, `OWNER_BUILD` constants in `renderer.ts` and `car.ts`; the loader is a dynamic
  import behind the flag.
- `src/rendering/studio/supplied-decal-art.ts`: the real decal-sheet key table, moved out of the shared
  `brand-atlas.ts` into an owner-only module with a header saying so.
- `scripts/build-player-lods.mjs --owner-only` in `prebuild` / `predev`: a product build no longer
  generates the 4 MB LOD index it will not use (`pretest` still generates it for the unit tests).
- `package.json`: `check:bundle` = budget + `scripts/ip-guard.mjs`; `check:ip`; `notices`.
- Verified both ways: product build has no `supplied-player*` file or chunk; `MOTOBOUND_SUPPLIED_PLAYER=1`
  build contains both binaries and the chunk (checked in `/tmp` builds, section 7).

### 4.3 Real-brand names in shipped text, docs, credits

`RB19` / `R06` wording in `docs/SUPPLIED_PLAYER*.md`, `P0_COCKPIT_FRAMING`, `A12`, `A33`, `A34`,
`RENDER_BUDGET_CONTINUATION`, `TRACK_INFRASTRUCTURE_ASSET_PACK` generalised; supplied manifest revision
`RB19-R06-player-1` -> `owner-supplied-player-1`; cockpit framing revision, tyre-blanket manifest text,
GP texture / revision labels (`MotoGP ...` -> `GP ...`) and two error strings renamed;
`ASSET_PROVENANCE.md` corrected (fonts, G15); credits screen links `THIRD_PARTY_NOTICES.txt`;
`CREDITS.txt` heading (generator, file and manifest hash updated together).
The node names inside the owner binary cannot be renamed without breaking its pinned hash; they are
confined to the owner build.

### 4.4 Release findings fixed

- **Notices:** `public/THIRD_PARTY_NOTICES.txt`, generated by `scripts/third-party-notices.mjs`, checked
  for staleness by `tests/ip-audit.test.ts`.
- **Reference catalogue stripped from production:** `reference-catalogue.ts` keeps its data behind
  `__REVIEW_TOOLS__` (injected false by `vite.config.ts` unless `MOTOBOUND_REVIEW_TOOLS=1`); verified
  absent from the bundle by the guard. Review e2e specs skip with a stated reason in a product build.
- **Legacy "APEX":** export file names `apex-*` -> `motobound-*` (photo, telemetry CSV, setup JSON,
  team briefing, session video, review and evidence JSON; the evidence validator accepts both prefixes
  so existing saved evidence still loads), HUD wordmark `MB`, workshop wall lettering, default sponsor.
  **Kept, not visible:** IndexedDB `apex-formula` and `apex-replay-cache`, localStorage keys
  (`apex.observer.v1`, `apex-reference-acceptance-v1`), the career lock name, the `apex-verified-session`
  record format, worker and shader-cache labels, `__APEX_SOURCE_*` build constants. Renaming the stores
  orphans existing saves; a copy-on-first-run migration is about a day with tests and is not trivial
  enough to do blind. Documented in `LEGAL_CHECKLIST.md`.
- Pre-existing red found on the way: `tests/studio-look-contracts.test.ts` P19 already failed on `main`
  because the wildcard-name validator (a deny list) spells `red bull`; the test now exempts deny lists
  and the owner-only key table, with the reason in the test.

### 4.5 Tests: ported, not deleted

| Test | Change and reason |
| --- | --- |
| `tests/hero-car-original.test.ts` (new) | Pins what a player now sees: `FormulaCar(0)` without a supplied asset uses the A61 levels, has the procedural cockpit, follows the livery on body and covers |
| `tests/ip-audit.test.ts` (new, 54 cases) | Every shipped GLB names no real brand; brand tables fictional; vite config contract; notices current and linked |
| `tests/brand-atlas.test.ts` | Imports the decal table from its new owner-only module; `APEX CORSA` -> `MOTOBOUND` |
| `tests/paint-livery.test.ts`, `tyre-wheels`, `trackside-branding`, `studio-look-contracts`, `supplied-lookdev`, `photo-reference` | Pinned values updated for the renamed brand, the hero team colour and the default sponsor `VOLTEX` |
| `tests/supplied-player*.test.ts`, `supplied-*` | Unchanged: they still test the owner-only asset directly; `vitest.config.ts` defines the flags true so owner-only code stays covered |
| `e2e/application.spec.ts`, `24-coupled-driver`, `53-a61-rival` | Dual-mode: owner build keeps the supplied assertions, product build asserts the original car (no supplied rig, no request for the binary, A61 on car 0) |
| `e2e/39-supplied-player`, `41-player-render-budget`, `p0-cockpit-framing` | Owner-build only (they frame or measure the supplied model); skip with a stated reason otherwise |
| `e2e/07, 08, 09, 14, 15` (review tools) | Skip unless the build has `MOTOBOUND_REVIEW_TOOLS=1` |
| `e2e/61-original-hero-car.spec.ts` (new) | Product-build check that the player's car is the authored one and the owner binary is never requested |

### 4.6 What the CI still needs (not changed here)

`ci.yml` builds `dist` once and uses it both for the e2e shards and for the release / Pages artifacts.
The e2e specs listed above now need a QA build (`MOTOBOUND_REVIEW_TOOLS=1`, and `MOTOBOUND_SUPPLIED_PLAYER=1`
for the owner specs) that must never be published. The release artifact must stay the product build.
That is a two-build change to the pipeline, owned by Release Engineering, and was not attempted without a
way to run CI. Until then the review and owner specs skip in CI rather than run.

## 5. Visual quality of the replacement

See section 8 (captures and the honest comparison); written after the captures.

## 6. Decisions for the owner / counsel (not resolved by code)

1. **History.** `supplied-player.glb.gz` (36 MB), the supplied-player docs and the reference zip are in
   git history. Removing the files from the working tree does not remove them from clones. If the
   repository is ever shared, made public or given to contractors, decide on a history rewrite.
   Forks, CI caches and downloaded artifacts hold copies too.
2. **Past public exposure.** `deploy-playable-pages.yml` published `npm run build` of `main` to GitHub
   Pages on every push and CI kept `apex-formula-release` artifacts for 30 days, both containing the real
   F1 car and sponsor-sheet names. Whether Pages was enabled for this repository and what was served is
   not knowable from the code. Counsel to decide on takedown / cache purge and whether any notice is due.
3. **Reference material in the repository.** The MotoGP 26 image zip, the Forza Horizon and MotoGP
   reference-pack builders and workflows, and ~100 reference observation documents derived from
   commercial-game images. Decide whether the repository is a distribution vehicle for them.
4. **Reference-guided modelling.** Cars, bikes and venues were authored while looking at images of
   commercial games (e.g. GP bodywork proportions "observed in" game references; Solvane manifests list
   `referenceIds`). Original geometry, but the silhouette of real GP bikes is in the loop. Counsel to
   decide whether that is acceptable and whether to keep the reference tables.
5. **Real-circuit approximations** (21 venues) and **look-alike vehicle names** (`RS-5`, `SBK-1000`,
   `GP-R1`, `XT-1`). Counsel opinion; consider renaming the two with the closest echo.
6. **Name clearance.** MOTOBOUND and the fictional sponsor / tyre brand / driver names have not been
   searched (`LEGAL_CHECKLIST.md`). `VANTA`, `ORBITEL`, `NORTHLINE`, `KESTREL TIME`, `OBSIDIAN` are
   plausible existing company names.
7. **Vegetation licence version** (Laubwerk via `pbrt-v4-scenes`): confirm or replace (3.1).
8. **Owner build discipline.** Anyone holding `MOTOBOUND_SUPPLIED_PLAYER=1` can produce a build with the
   real car. It must never be uploaded to Steam, a CDN, GitHub Pages or sent to press. The guard refuses
   to certify such a build (`--owner-build` only prints a warning).
9. **Steam AI-content disclosure** (code, and possibly art scripts, were written with AI assistance): the
   producer must collect the answer from every department (`LEGAL_CHECKLIST.md` section 4).
10. **Persisted-storage names** (`apex-*`): keep, or schedule a migration (4.4).

## 7. Verification actually run

(Filled in at the end of the work; commands and results.)

## 8. Visual comparison (hero car)

(Filled in after captures.)
