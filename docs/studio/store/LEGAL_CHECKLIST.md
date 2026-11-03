# Legal and compliance checklist

This is an engineering checklist, **not legal advice**. Items marked **Counsel** need a lawyer
or the relevant authority before release. Status: **Done (repo)**, **Open**, **Counsel**.

## 1. Documents the store page and the build need

| Document | Status | Notes |
| --- | --- | --- |
| End-user licence agreement (EULA) | **Open / Counsel** | None exists. Steam allows the standard Steam Subscriber Agreement alone; a custom EULA is optional. If one is shown in-game, it must be controller-navigable (Deck) and only shown once. Minimum content if written: licence grant, no reverse engineering of paid content, user-generated content (photos, liveries) licence, limitation of liability, governing law. |
| Privacy policy (store page link is required) | **Open / Counsel** | Facts the policy must state, true today: the game makes **no network requests** (CSP and a request allow-list in `desktop/src/protocol.cjs` enforce it in the desktop build) and has **no analytics, accounts, ads or telemetry upload**. Data stored locally only: settings, career/team/championship saves, achievements, lap bests, ghost laps, logs (`userData/logs/main.log`). Steam itself processes achievements, cloud saves and rich presence under Valve's policy. If an opt-in crash/analytics service is added later, this changes and must be re-reviewed (GDPR/UK GDPR/CCPA). |
| Store content descriptions / age ratings | **Open** | Steam asks a content survey (violence, mature themes, microtransactions, online interactions). Expected answers for the current build: no violence beyond vehicle collisions and rider falls (confirm what the crash presentation shows), no sexual content, no gambling, no in-app purchases, no multiplayer chat. Fill the survey from a full playthrough, not from memory. Some regional ratings (IARC-style questionnaire via Steam for some regions; Germany USK, Korea GRAC, Australia, Brazil) are partly handled by Steam; check the partner site for what is required per region. |
| Third-party notices screen / file shipped with the game | **Done (repo)** | The in-game **CREDITS & LICENCES** screen lists every third-party art asset and links `THIRD_PARTY_NOTICES.txt`; `public/THIRD_PARTY_NOTICES.txt` ships in every build and carries the three.js (MIT), Basis (Apache-2.0) and Saira / Saira Stencil One (OFL 1.1) texts plus the CC0 / CC BY attributions (`scripts/third-party-notices.mjs`, checked by `tests/ip-audit.test.ts`). Desktop packaging must keep Electron's `LICENSE` and `LICENSES.chromium.html`. |
| Trademark clearance of the name "MOTOBOUND" | **Counsel** | Not searched. Also search the circuit, vehicle and series names that were chosen to be original (`validate:content` rejects a list of protected real names, which is not a clearance). |
| Company/tax set-up for Steamworks | **Counsel** | Steam Direct app fee (US$100 per app at the time of writing, recoupable against sales) and the bank/tax identity forms are required; not an engineering task. |

## 2. Third-party licence list (from `docs/ASSET_PROVENANCE.md` and `package.json`)

Policy in the repository: only CC0-1.0, CC-BY-4.0, CC-BY-2.0 and MIT content may ship;
`tests/third-party-assets.test.ts` guards the manifest, hashes, brand words and a 150 MB budget.

### Art and data that ship in the game

| Content | Author / source | Licence | Obligation |
| --- | --- | --- | --- |
| 13 sky HDRIs (`kiara-5-noon`, `goegap`, `quarry-02`, `rural-landscape`, `waterbuck-trail`, `mud-road`, `kloppenheim-01/02/04`, `winter-lake-01`, `table-mountain-1`, `kiara-8-sunset`, `syferfontein-0d-clear`) | Greg Zaal, Sergej Majboroda, Sergey Rudavin (Poly Haven) | CC0 1.0 | None; credited anyway. |
| Ground textures `sandy-gravel-01` (cgbookcase), `ground-lawn`, `ground-rock`, `ground-snow` (ambientCG), `ground-meadow`, `ground-forest-floor`, `ground-dry-earth` (Poly Haven) | as listed | CC0 1.0 | None; credited anyway. |
| `ground-asphalt` | Poly Haven asphalt_02 via the glTF Sample Assets "Traffic Cone" (hinndia) | CC BY 4.0 (credited under the stricter terms) | Attribution in-game and in `CREDITS.txt`. |
| `ground-wet-earth`, `ground-concrete` | Amazon Lumberyard (Bistro) via NVIDIA ORCA / `mmp/pbrt-v4-scenes` | CC BY 4.0 | Attribution, licence link, indicate changes (shipped as 1024 px KTX2/WebP, normals converted). |
| Photographic vegetation: `tree-linden`, `tree-chestnut`, `tree-birch`, `tree-rowan`, `tree-fir`, `tree-fir-b`, `shrub-flowering`, `grass-meadow` | Jan-Walter Schliep, Burak Kahraman, Timm Dapper (Laubwerk), from the *Landscape* scene of `mmp/pbrt-v4-scenes` | CC BY 4.0 (adaptations: baked to billboard clouds) | Attribution naming the authors, the licence and the modification; shipped in-game and in `CREDITS.txt`. |
| Cars, bikes, riders, crews, buildings, terrain, barriers, circuits, interface, audio | This repository (procedural code or Blender scripts) | Own work | Circuit layouts are *approximations of real-world circuits from public geometry* (ASSET_PROVENANCE.md): **Counsel** should confirm that approximated layouts under original names are acceptable. |

### Code and fonts

| Component | Licence | Obligation | Status |
| --- | --- | --- | --- |
| three.js 0.180.0 | MIT | Keep the copyright notice with distributed copies | **Done (repo)**: `THIRD_PARTY_NOTICES.txt` (shipped, linked from the credits screen). |
| Basis Universal transcoder (`public/assets/basis`, copied from `three`) | Apache-2.0 (Binomial LLC) | Include the licence text and notices | **Done (repo)**: full Apache-2.0 text in `THIRD_PARTY_NOTICES.txt`. |
| Saira Variable font (`@fontsource-variable/saira`, files in `dist/assets/saira-*.woff2`) and Saira Stencil One | SIL Open Font License 1.1 (Omnibus-Type) | Ship the copyright notice and the OFL text with the font; the font may not be sold alone | **Done (repo)**: both copyright lines and the OFL text are in `THIRD_PARTY_NOTICES.txt`; `ASSET_PROVENANCE.md` corrected. |
| Electron 44 (Chromium 152, Node 24) | MIT + the Chromium/third-party licences | Electron's distribution already carries `LICENSE` and `LICENSES.chromium.html` in the app folder; **keep them in the depot and list Electron/Chromium in the credits** | Present in `linux-unpacked` (verified in the release report); credits mention **Open**. |
| electron-builder | MIT | Build tool only; no redistribution | n/a |
| steamworks.js 0.4.0 | MIT | Ship its licence with the module (it is inside `node_modules/steamworks.js`, in the asar-unpacked folder) | Done by the packager; confirm in the depot. |
| **Steamworks SDK redistributables** (`steam_api64.dll`, `libsteam_api.so`, `libsteam_api.dylib`, inside steamworks.js) | Valve's Steamworks SDK Access Agreement (not an open-source licence) | Distributable only for apps on Steam under that agreement; the studio must have accepted it in the partner account before shipping these files | **Counsel / Open**: do not ship the Steamworks libraries in non-Steam builds (itch.io, direct download); `npm run desktop:dist:*` currently includes them in every build. |
| Vite/TypeScript/ESLint/Vitest/Playwright/Prettier/meshoptimizer | Build/test tools (MIT/Apache-2.0) | Not distributed in the game | n/a. `meshoptimizer` output is baked into `supplied-player-lods`; MIT notice not required for generated data but harmless to list. |

Generate the full dependency list for the notice file with the lockfiles (`package-lock.json`,
`desktop/package-lock.json`); a tool such as `license-checker` can produce it, but none is
installed here and no such list has been generated.

## 3. Content hygiene before release

| Item | Status | Notes |
| --- | --- | --- |
| No licensed names, logos or liveries in shipped content | **Done (repo) / ongoing** | Enforced by `validate:content` and `forbiddenNameIn`; the Content/Art departments own new entries. |
| Licensed-product references inside the shipped JS | **Done (repo)** | `src/ui/reference-catalogue.ts` is compiled out of product builds (`__REVIEW_TOOLS__`, default off; `MOTOBOUND_REVIEW_TOOLS=1` keeps it for the e2e review specs). `scripts/ip-guard.mjs` runs inside every product `vite build` (so `npm run build` fails), in the CI `validate` job and in the release script; it fails on a commercial-game or coverage URL, a real team/sponsor/maker name (any spelling: `RB19_BODY`, `tag_heuer`, `HardRock`) or an owner-only binary in `dist/`, and refuses owner and review QA builds outright. |
| Legacy "APEX" product naming | **Done for everything a player or a file listing shows; storage identifiers kept** | `CREDITS.txt`, exported file names (`motobound-photo-*.png`, `motobound-telemetry.csv`, `motobound-setup.json`, review/evidence exports), the race-HUD wordmark (`MB`), the nose and workshop lettering, the default livery sponsor and the tyre brand (now `MOTOBOUND`) were renamed. Kept on purpose, never shown: IndexedDB `apex-formula` / `apex-replay-cache`, localStorage keys, the career lock name and the `apex-verified-session` record format. Renaming them orphans existing saves; a migration (open old DB, copy stores, keep a read fallback) is about a day plus tests and is only worth doing if the owner wants clean storage names. |
| Music and trailer audio | **Open** | No music is shipped with the game today (audio is synthesised). Any trailer track needs a written licence (original, CC0 or CC-BY with credit) stored with the trailer project. |
| Fonts, icons and capsule art | **Open** | `desktop/build/icon.png` is the placeholder rendered from `public/icon.svg` (an "A" glyph from the former name). Replace with the final brand mark. |
| Photo-mode and exported files | **Done (repo)** | Users own their screenshots; the EULA should say they may share them. |
| Real-person likenesses | **Done (repo)** | Driver names are fictional (ASSET_PROVENANCE.md). |
| Accessibility claims | **Open** | Settings contain colour-blind, high-contrast, reduced-motion and caption options; do not claim Deck Verified or full controller support until `STEAM_DECK_CHECKLIST.md` is closed. |

## 4. Steamworks questionnaires (fill from facts, not from the template)

- Age/ratings: see section 1.
- Controller support: say **partial** until menus navigate by pad.
- Languages: English interface only; do not tick languages that have no strings.
- Steam Cloud, Achievements, Rich presence: tick only after `desktop/STEAM.md` steps are done
  on a real Steam client.
- AI-generated content disclosure: Steam asks whether generative AI was used in the game or its
  store assets. The release department cannot answer for art and audio authored by other
  departments; the producer must collect that answer from each department.
- Export compliance / encryption: the game uses no custom cryptography (the save mirror uses
  SHA-256 for a checksum only).

## 5. Release-day legal gate

1. EULA decision recorded (Steam default or custom).
2. Privacy policy published and linked on the store page.
3. `CREDITS & LICENCES` updated with code and font notices; OFL text and three.js/Basis notices shipped. **Done (repo).**
4. Steamworks libraries only in Steam depots.
5. Reference-catalogue module excluded from the production bundle. **Done (repo)**, enforced by the IP guard in `npm run build`, CI `validate` and the release script.
6. Name clearance result and the circuit-approximation opinion from counsel.
7. Ratings questionnaire answers signed off from a full playthrough.


See also [../reports/ip-audit.md](../reports/ip-audit.md): the per-asset provenance and risk audit (gate G15), with the owner / counsel decision list.
