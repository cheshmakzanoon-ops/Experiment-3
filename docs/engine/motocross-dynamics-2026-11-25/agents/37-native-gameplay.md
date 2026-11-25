# Assignment 37 — production build and native motocross journey

## Result and owned scope

The direct **product/full Vite build passed**, including its existing IP guard. The unchanged production browser journey then passed **1/1**, with both MX450/Valley Ridge and MX250/Arena Nord completing their menu, eight-rider gate, manual controls, AI demonstration, camera, pause, and return-to-paddock paths. There were no unexpected, flaky, or skipped tests, no reported browser/page errors, and no retries.

This assignment changed no production code, tests, model definitions, assets, terrain, environments, or vehicle specifications. Its only authored repository file is this report; intermediate commands, manifests, logs, and extracted browser receipts are under `test-results/a37-native-gameplay/`. No git commit, branch, index, or publication operation was performed. No npm pretest/prebuild model-generation hook ran.

## Execution and provenance

The repository HEAD was `f3b39eb8e1b02fc0677086819fc384b6ceacefc2` with the coordinated task source edits present. This was **working-tree acceptance before the task commit**, not a claim that the original HEAD contains those edits. The product correctly records `commit: null`, source fingerprint `8ca5571bf1d9a5297793bf6f16b439311491ef8efdfb2ce06aa85f1ffcc459bf`, `variant: product`, and `edition: full` in `BUILD_IDENTITY.json`.

| Command | UTC interval, 2026-11-25 | Elapsed | Exit |
| --- | --- | ---: | ---: |
| `node_modules/.bin/vite build` | 18:49:17–18:49:40 | 22.823 s | 0 |
| Existing Playwright motocross gameplay journey | 18:49:56–18:55:21 | 325.434 s | 0 |

Vite transformed 1,106 modules. The build printed the existing large-chunk advisory; it did not fail. Its IP guard scanned 75 shipped text files and GLB name tables successfully. Product output comprises 266 files totaling 135,946,271 bytes. These timings describe this shared software-rendering environment, not a throughput or frame-rate benchmark.

Before and after each command, the receipt runner hashed all files under `src/`, `public/`, and `e2e/`, plus package, TypeScript, Vite, Playwright, entry HTML, and selected browser/build-support inputs: **1,733 files**. Every recorded input remained unchanged throughout both commands. The lazy-data plugin and IP-guard scripts were additionally checked byte-for-byte against the integrated HEAD; neither had changed.

| Identity | SHA-256 |
| --- | --- |
| All 1,733 captured inputs | `d7df45045b4230d912dc5935c071be1fcbdcaa102392cc7e9d2e68dd25084255` |
| All 1,126 source files | `61f63607079283c6f5abb82dcc06a7166f4a1fad306b84aa1e4f6be08a4da9b9` |
| All 266 built files, before/after journey | `799c6ed606c6cefbba716e7aa58cf3a10855d978d6880651057f5f2d0c44c3d6` |
| Motocross adapter | `e04318b7e4c6075d42a6c65cc04664a19e5425e20e50f49a1b1ad4f37084ea17` |
| Unchanged gameplay spec | `2a3ba790d17211402c41a212e0f98dd8e8225bf4956ff9d1ef0e06fdb7099be1` |
| Unchanged motocross Playwright config | `0102ddaa005afe284d49d3a49e4ac6bcd57e2f889fa40d6c1ce90400bff60734` |

The manifest aggregate is SHA-256 of each Python-path-sorted `path + NUL + file SHA-256 + newline` entry. This ordering differs from assignment 35's manifest ordering; an independent per-file comparison confirmed **all 1,126 source hashes match assignment 35's accepted extended run**. The differing aggregate strings do not represent a source change. Final publication must compare these actual inputs/fingerprint with the committed tree; the build is not retrospectively relabeled as having run after that commit.

## Observed application behavior

The existing test used visible production controls to select Low quality, OUTDOOR MX/MX450, and then STADIUM SX/MX250. Each venue initialized eight riders, completed its held gate GPU work, entered driving, and accepted ordinary keyboard fore/aft rider-weight and throttle input while `auto` remained false. Only afterward did it explicitly enable the game's AI demonstration for the observed flight and touchdown.

| Observation | Valley Ridge / MX450 | Arena Nord / MX250 |
| --- | ---: | ---: |
| Manual-input speed observation | 8.03781 m/s | 7.14498 m/s |
| Manual throttle observation | 1 | 1 |
| Forward / rearward body observation | +0.79743 / −0.84823 | +0.70279 / −0.79806 |
| Observed AI riding interval | 20.1000 s | 20.3917 s |
| Signed forward progress during that interval | 268.8225 m | 152.1722 m |
| Maximum recorded flight time | 1.09167 s | 0.55417 s |
| First observed touchdown normal speed | 4.14522 m/s | 4.79760 m/s |
| First observed touchdown pitch error | +0.000195 rad | −0.473974 rad |
| Advancing rendered time during riding | 11.8917 s | 17.6750 s |
| Riders with independently animated front/rear mudguards | 8 of 8 | 8 of 8 |
| Maximum safety-car phase | 0 | 0 |
| Held paused worker tick | 7,978 | 7,499 |

These are read-only diagnostics sampled by the unchanged test, not injected state. The test observed 39 distinct worker samples per AI interval. A touchdown observation proves a real recorded flight/contact event; it does not by itself assert a clean landing or a crash-free full lap. Existing dedicated player-physics scenarios and full-lap tests retain those separate responsibilities.

The journey switched from chase to cockpit through the actual camera key, waited for the requested completed presentation, paused through the visible UI, verified the worker pause acknowledgement, and checked unchanged worker ticks and presentation-frame counts while paused. Both venues returned to their selected-machine paddock. The initially held gate was explicitly required to have tick zero and completed GPU work. The additional asynchronous `ticksBeforeRelease` arrays were empty in this run; they did not sample intermediate release phases and are not presented as extra per-tick evidence.

## Pixels and graphics backend

The configured Chromium exposed WebGL2 through **ANGLE / Vulkan 1.3 / SwiftShader Device (Subzero)**. Its framebuffer readback returned `[64, 128, 191, 255]` with GL error zero. Node was v24.22.3 and Playwright 1.55.1. This is a software graphics backend, not physical hardware certification.

The unchanged capture path produced **twelve 1280×800 PNGs**: menu, gate, rearward-weight pose, chase, onboard, and pause for each venue. The test retained its nonblank, unique-image, GPU-completion, requested-pose, and pause-button pixel checks. Representative outdoor menu/gate/chase and stadium rearward-weight images were also visually inspected. Image names, dimensions, file sizes, and SHA-256 hashes are recorded in `screenshots.json`; no image or model was edited. The production HTML report retains all image attachments and the two complete diagnostic journey records.

## Reproduction and evidence

Run from the repository root:

```sh
node_modules/.bin/vite build
PLAYWRIGHT_BROWSERS_PATH=/workspace/scratch/e91efca799c8/pw-browsers \
APEX_BROWSER_BACKEND=swiftshader \
APEX_MOTOCROSS_JOURNEY_QUALITY=low \
APEX_MOTOCROSS_JOURNEY_PROGRESS=1 \
node_modules/.bin/playwright test e2e/45-motocross-gameplay.spec.ts \
  --config playwright.motocross.config.ts
```

The config started its own fresh preview on port 4197, with one worker and zero retries. The original 20-minute journey ceiling and every assertion remained unchanged. No baseline rerun was necessary because no browser regression occurred.

Key task-local receipts in `test-results/a37-native-gameplay/` are `build.log`, `journey.log`, the two `*-command.json` records, four input manifests, `dist-manifest.json`, `dist-after-journey.json`, `build-support.json`, `build-identity.json`, `browser-backend.json`, `environment.json`, `screenshots.json`, `summary.json`, and both `*-journey.json` attachments. The exact Playwright report JSON was extracted without alteration from its HTML archive into `report-json/`. All twelve images and the complete HTML report are independently preserved under `screenshots/` and `html-report/` so a later browser run can replace the standard output directories without losing this evidence.

This establishes actual production app/worker/presentation execution at Low quality for two machine/venue combinations. It does not establish High/Ultra quality, hardware FPS, perceived continuous fluidity, manual-player browser jump completion, all four machine/venue browser combinations, or real-bike calibration. No failures were hidden or acceptance limits relaxed.
