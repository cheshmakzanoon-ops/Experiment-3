# MOTOBOUND — handover and roadmap

Written when development was wound down on 2026-11-05. Everything is merged to `main`; no agent branch remains.
What the game is and where it lives: [GAME_OVERVIEW.md](GAME_OVERVIEW.md). Gates: [RELEASE_GATES.md](RELEASE_GATES.md).
Studio record: [BOARD.md](BOARD.md), [reports/](reports/), store kit [store/](store/).

## 1. Honest status

**The original target — a game that can earn US$5,000/month net on Steam — is not verified and cannot be verified from
inside this repository.** Revenue depends on things this work could not measure: frame rate and load time on real
GPUs and Steam Deck, how the game feels to a human, Steam-client behaviour, external playtesters, wishlists and refund
rate. What the repository can show is the readiness of the product and its pipeline, and that is what the gates track.

Arithmetic behind the target (assumptions, not promises): Steam keeps 30 %, so net US$5,000/month needs about
US$7,150 gross — roughly 360 sales a month at US$19.99 (480 at US$14.99), *sustained*. Launch spikes decay, so it needs a
strong first impression (refund window is 2 h of play), a demo/Next Fest wishlist build-up and a content cadence
([store/LAUNCH_PLAN.md](store/LAUNCH_PLAN.md)). Racing is a crowded space between AAA sims and cheap arcade racers; a
browser-born codebase must clear the "feels like a real game" bar on a real GPU on first launch.

### What is verified (evidence in the repository or on GitHub Actions)

| Area | Evidence |
| --- | --- |
| Build / types / lint / content / IP guard | GitHub Actions on clean `ubuntu-24.04` runners: `validate` job green; IP guard clean in `vite build` and in CI; demo build + IP guard green |
| Unit + simulation tests | Full vitest on `main`: **616 files, 6,086 tests, 0 failing** (2ed0ae9). Fresh full run for the handover: see § 7. CI `unit-tests` job also passed on a clean runner (23.5 min). |
| Bundle | initial JS 3.50 MB gzip (budget 4); `dist/` 127.7 MB; no real-brand asset in the product build |
| Seeded races | 29/29 Wildcard events (recorded at physics v23), 19/19 GP-bike races, catalogue/offroad harnesses; offroad gate failure fixed (physics v24) but the fixed full gate has not yet run on CI |
| Festival (open world) | 18/18 activities complete headlessly with the production session logic, 7 weather states sampled, save/reload round trip, 7 defects fixed (`reports/qa-festival.md`) |
| Browser suite | CI on real runners (run 41915850034): 12/15 jobs passed incl. browser shards 1,2,3,4,5,8; shards 6 and 7 failed (see § 3); earlier local sweep: 75 of 133 specs run, 53 pass |
| Machines | 57-machine benchmark; five calibration fixes; character line per machine (`reports/machine-benchmark.md`) |
| Audio | offline render of 369 scenarios with numeric analysis (loudness, peaks, balance) — numbers only, nobody listened |
| UI | Paddock Board design system, WCAG-AA contrast and 11 px type-floor audits, focus rings, reduced motion, HUD scale, 8 languages layout-checked at 1280×720 and 1024×600 |

### What is NOT verified

Real-GPU frame rate and load time (G8) · Steam Deck behaviour · Windows/macOS packages ever running · the Steam client
(achievements, cloud, leaderboards, overlay) · any human playing for fun · native-speaker review of 7 translations ·
music (none exists) · every claim about "feel". Treat any sentence in the reports that does not carry evidence as
a hypothesis.

## 2. What was built in this effort (summary)

Production was run like a studio: a producer/PM (the lead session), department agents on short-lived branches, a
skeptical reviewer agent per branch, merges to `main` only after build + lint + targeted tests, branches deleted after
merge. Delivered: the Paddock Board front end and HUD identity; Wildcard Series (29 events, 5 new venues); 3 new weather
states (fog, storm, dust) then snow/ice, dawn, visibility race control; bundle 4.47 → 3.5 MB gzip; Electron shell, 54
achievements, demo edition, leaderboards pipeline, CI packaging matrix; IP audit and removal of a real-brand car from
all product builds; original APX-01 hero car, EH-3 hero pass, 47 colourways, shared driver rework, sport bike shells,
karts/trucks; GP/dirt physics fixes, GP passing in mixed fields, handling calibration; offline audio rig and mix;
8-language localisation; headless festival QA; first-launch flow, season board, results board, settings; HUD legibility;
store kit (page copy, art/capsules 16/16 sizes, teaser animatic, storyboard, launch plan, 8-language store drafts).
Per-department reports: `docs/studio/reports/*.md`.

## 3. Known problems (ranked)

**Release blockers or near-blockers**

1. **CI browser shards 6 and 7 are red** (run 41915850034). Triage was in progress when work stopped; merged so far: GP
   triangle pins corrected with CI evidence, a knee-spark resource expectation, a real CSS fix (a desktop scrollbar clipped
   the Paddock Board's right edge at ≤ 900 px wide), a motocross-note overhang tolerance (needs review: it must still fail
   a line that really leaves its note). Still open, from the shard-6 log: (a) `e2e/23-apx01-views` — clicking PHOTO /
   LIVERY now shows a loading screen and the studio opens after ~36 s on software GL because the lazy-data work makes it
   load the full circuit renderer on demand (spec waits 60 s); (b) `e2e/28-race-pit-presentation`, `32-race-clarity`,
   `53-a61-rival` stay in `loading` for the 180 s allowance on 8–12-car grids — **unknown whether this is slower than before
   the studio's changes**; baseline run for comparison: 41719338961 (main 3ae3842); (c) `aurel-quarry` 20 min timeout,
   `secondary-grandstands` GPU-fence trip (45 s, `renderer.ts waitForPreparedFrame`); (d) shard 7 not yet read.
   *First action next session: finish this triage (a clean agent brief is the "CI Keeper" prompt in § 5 Phase 0).*
2. **Hero-car quality gap.** The original APX-01 is ~6.4× lighter than the removed real-brand model; cockpit/driver are the
   weakest part. Karts and trucks are still toy-like; CR-750 is an egg not a half fairing; showroom backdrop is a black void.
3. **No real-GPU measurement.** Software-GL times (boot 60–100 s, first session 170–330 s) say nothing about hardware.
4. **Key art is weak.** The capsule layout/logo system is tidy, but every hero frame is a software-GL stand-in (blurred
   rear view of a rider on an empty road). Retake on a GPU before any Steam upload.
5. **Legal items needing the owner/counsel** (not resolvable in code): purge the removed real-brand player asset from git
   history (it is still in history and in the repo's `supplied-*` files, owner-only); check whether the public GitHub Pages
   site and past release artifacts already published it (the Pages workflow redeploys on every push to `main`); trademark /
   domain clearance of "MOTOBOUND" and the fictional sponsor/tyre/driver names; Steam's AI-content disclosure (docs say
   "hand-drawn" for logo art that an agent wrote as code — reword or get sign-off); Laubwerk vegetation licence version.

**Gameplay / content**

6. Mixed GP/superbike fields: passing works (GP faster in ~94 % of mixed races) but falls are level with `main`, not zero:
   Montejaral hairpin, Ardennes (a superbike fall that also exists on `main`), a Kansai East chicane fall. Passing needs a
   600 m straight, so tight circuits keep GP riders behind.
7. Festival: long (10+ km) wet/snow events with the 349 km/h hypercar are unreliable for the AI pilot (5 of 18 long-weather
   cells fail); drift scoring only proven with a hand-tuned slide pilot; no timeout for a player idling inside a skill challenge;
   economy oddities left alone (solo practice lap pays 9,100; failed skill challenge leaves no record).
8. `e2e/22-apx01-assembly` upright-joint check (0.06 ≠ 0) fails identically on the original repo.
9. Snow scenery/lamp shafts were seen only in stills; lightning is proven by unit test, never captured on screen.

**Polish / reach**

10. Localisation: seven model-written drafts; known errors (Turkish "field", pt-BR "Flashback", Polish plural forms, Spanish
    qualifying/classification collision); 21 English strings of the form `{n} noun` cannot take plurals (English prints "1 LAPS"
    too). Russian, Chinese, Japanese, Korean need extra font files (plan in `reports/localization.md`).
11. Audio: no music; engines of formula cars and GP bikes still sound alike; only the four nearest cars are voiced; no far
    traffic bed; snow/fog have no ambience; tyre-squeal gain saturates.
12. HUD: compact layout under 1280×680 is not lifted; default tyre colours are not tritan-safe.
13. Several paddock doors overlap in purpose (Career/Events/Championship/Wildcard/Team HQ); Events card grid not redesigned.

## 4. Decisions only the owner can make

| Decision | Why it matters | Options |
| --- | --- | --- |
| Real-brand asset in git history | legal exposure; the product build no longer ships it | rewrite history, or accept and keep it owner-only |
| Price and edition | decides the sales needed (§ 1) | US$14.99 / 19.99 base; demo free |
| Steam AI-content disclosure | store requirement | disclose generated code/art honestly |
| Music | none exists | commission a composer (brief: `reports/audio-music-brief.md`) or licensed library |
| Name clearance | trademark risk | search/clear "MOTOBOUND" and fictional brands before the store page |
| Which languages first | store reach | Latin-script languages are ready as drafts; CJK/Cyrillic need fonts |

## 5. Roadmap

Each phase has an exit test so progress is checkable. Commands are in [GAME_OVERVIEW.md](GAME_OVERVIEW.md) § 5.

### Phase 0 — green CI (1–2 days)
- Finish the browser triage (known facts in § 3.1). Classify each failing spec as REGRESSION / STALE / ENVIRONMENT against
  baseline run 41719338961; fix regressions in code with a test; lengthen a deadline only where the product's cold start is
  legitimately slower and the assertion unchanged; port stale pins with evidence; split heavy visual surveys
  (`aurel-quarry`, `secondary-grandstands`, A12/A31 families) into a nightly job. Measure cold start (PREPARE GRID → paused,
  PHOTO / LIVERY open) before vs after commit `ebc2e06` (lazy data) on one host and decide whether the photo studio should
  avoid loading circuit data it does not need.
- Watch the first CI run containing physics v24 and the 25-min `scenarios` cap; the `offroad-scenarios` job must pass.
- Re-run `scripts/wildcard-races.ts` (v24) and `scripts/open-world.ts`; commit refreshed evidence JSON.
- **Exit:** `Build and validation` fully green on `main`; `desktop-packages` Windows and macOS legs run at least once.

### Phase 1 — real hardware (1 week, needs people and machines)
- Run `scripts/studio/tools/journey.mjs` (all journeys) on a Windows PC with a discrete GPU and on a Steam Deck; record
  boot-to-menu, menu-to-driving (target ≤ 90 s, ≤ 3 inputs), frame time at Low/Medium/High, memory after two sessions.
- Fix the top frame-time hot spots found (`TextureBudget.apply`, `cloudDetailVolume` were flagged on software GL only).
- Retake all key art on a GPU: `scripts/studio/tools/art-frames.mjs`, `capsule-art.mjs` (needs banked-wall Wildcard frame,
  side-on GP lean, EH-3 coast hero without the parked traffic car); build the real trailer from `TRAILER_STORYBOARD.md`.
- Steamworks: create the app, upload depots per `desktop/STEAM.md`, test achievements/cloud/rich presence/leaderboards with a
  real client; `steamworks.js` has no leaderboard API at 0.4.0, so leaderboards stay local until that is solved.
- **Exit:** gates G3, G8, G9, G10 closed with numbers; Steam Deck checklist (`store/STEAM_DECK_CHECKLIST.md`) filled in.

### Phase 2 — content and feel (3–6 weeks)
- A listening pass on speakers and headphones against `reports/audio.md`; commission music; engine sound design for
  formula vs GP bikes; add far-traffic bed and snow/fog ambience.
- Vehicle art: hero cockpit/driver, karts, trucks, CR-750 half fairing, showroom rim light and backdrop.
- Native review of the seven translations (checklist in `reports/localization.md`); fix plural-capable strings; add fonts and
  languages by market data (Chinese and Russian first).
- Gameplay: GP mixed-field falls to zero on the five target circuits (start from `reports/qa-bikes-3.md` dead ends); festival
  long-wet-event AI; economy review; career pacing for the first 2 hours.
- Wire the GP corner photo preset and knee sparks into Photo Studio (code exists in `menu-preview.ts`, UI not wired).
- **Exit:** ≥ 10 external playtesters, ≥ 70 % would recommend (G12); no blocker in their notes.

### Phase 3 — demo, wishlists, launch (2–3 months)
- Ship the **demo edition** (`npm run build:demo`) to Steam; enter a Next Fest; follow `store/LAUNCH_PLAN.md`: creator
  outreach, update cadence for 12 months (new venues, Wildcard events, weather, seasons).
- Gate G13 ≥ 10k wishlists before launch; after launch watch G14 (refund < 10 %, reviews ≥ 80 % positive) and iterate.

### Phase 4 — post-launch (12 months)
- Seasonal Wildcard drops, new unexpected venues and pairings, snow/ice events, more festival regions, optional online
  (experimental code in `src/net/`, not a service).

## 6. Process notes worth keeping

- Merge discipline that worked: agent branch → independent skeptic review (re-run claims, hunt test weakening, trial merge) →
  PM merge with a combined check (tsc, lint, targeted tests, build, IP guard, bundle) → branch deleted.
- The skeptics caught real problems every time (rejected: IP hero-car rework, HUD legibility, weather-2 fog drift). Keep the
  step.
- CI lessons: pin runner images (`ubuntu-latest` moved to 26.04 and broke Playwright for all 29 install steps); read CI logs
  before trusting local runs; the owner's authoring workflows commit to `main` automatically (e.g. `.blend` retention), so
  `git fetch` before pushing and **do not `git pull --rebase` with local merge commits** (it flattens them).
- Container restarts killed background agents several times; committed WIP survives on disk, uncommitted does not.
- Agent tooling lives in the session, not the repo: prompts are summarised in the department reports.

## 7. Final verification record

Run on `main` at the wind-down (commit e91a744 plus this record), local 4-CPU container, 2026-11-05:

| Check | Result |
| --- | --- |
| `npx vitest run` (full suite) | **625 files, 6,179 tests, 0 failing** (45.7 min) |
| `npx tsc --noEmit` | 0 errors |
| `npm run lint` | clean |
| `npm run validate:content` | Content valid |
| `npm run check:i18n` | 0 errors, 0 warnings (7 dictionaries) |
| `npm run build` + `npm run check:bundle` | built; initial JS 3.5 MB gzip (budget 4); `dist/` 128.3 MB; IP guard clean (75 shipped text files) |
| `npm run build:demo` | built; IP guard passed |
| DOM e2e (launch board, i18n layout, design critic, HUD legibility, motorcycle presentation, career hub, first-run, results/settings, motocross practice and interface) | 38/38 passed |
| GitHub Actions on `main` (earlier run, eab1d91) | 12/15 jobs passed; browser shards 6 and 7 red (§ 3.1) — no CI run of the final commit has been read |

Not run for the record: the real-game browser specs on this host (software GL), any hardware GPU, Windows/macOS.
