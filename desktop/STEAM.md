# Steamworks setup

Everything Steam-related is optional and **fails closed**: without the `steamworks.js` package,
without a running Steam client, with `MOTOBOUND_STEAM=0` / `--steam=0`, or on any API error, the
game runs normally and the Steam calls are no-ops (`desktop/src/steam.cjs`, unit-tested in
`tests/desktop-shell.test.ts`). It never throws and never blocks start-up.

**No real app id is committed.** Steam supplies the id when it launches the game; developers
use their own. The placeholder `480` below is Valve's public "Spacewar" test app and appears
only in these development notes, never in code, config or build output.

## What is wired

| feature | where | status |
| --- | --- | --- |
| Achievements (54 defined) | `src/steam/achievements.ts` (data + pure engine), `src/steam/runtime.ts` (persist + unlock) | engine unit-tested; **Steam side not run here (no client)** |
| Rich presence (10 statuses, names not ids) | `src/steam/presence.ts` + `src/steam/runtime.ts` -> `desktop/main.cjs` `steam:presence`; localisation file `docs/studio/store/RICH_PRESENCE.vdf` | tokens and keys unit-tested; **not run against Steam** |
| Leaderboards (time trial per circuit x machine, Wildcard best lap) | `src/steam/leaderboards.ts` (pure), `src/steam/leaderboard-runtime.ts`, `desktop/src/steam.cjs` `makeLeaderboards`, local fallback screen `src/ui/records-board.ts` | pipeline unit-tested with fakes; **cannot send to Steam with steamworks.js 0.4.0 (it has no leaderboard API), see "Leaderboards" below** |
| Steam Cloud | auto-cloud on `userData/saves/` (below) | configuration only; not run against Steam |
| Overlay | `electronEnableSteamOverlay()` when Steam initialised | not run against Steam |
| Steam Input / Deck | no native Steam Input; Steam's default controller template (gamepad) | see `docs/studio/store/STEAM_DECK_CHECKLIST.md` |

## Development against a real Steam client

1. Install the Steam client and sign in. In `desktop/`: `npm install` (pulls the optional
   `steamworks.js`, ~9 MB of native libraries; if it fails to install the game still runs).
2. Use your own app id, or Valve's test id 480 (shared by every developer; achievements you set
   there are not yours): `MOTOBOUND_STEAM_APPID=480 npm start`. As an alternative create an
   **untracked** `steam_appid.txt` containing the id next to the executable (the repository's
   `.gitignore` for the packaged `release/` folder keeps it out; never commit it).
3. The log (`userData/logs/main.log`) states the outcome: `steam: connected as <persona>` or the
   reason it is off. `MOTOBOUND_STEAM=0` forces it off.

## Steamworks partner site checklist

1. **Achievements.** The `id` of every entry in `ACHIEVEMENTS` is the *API Name* (lower snake
   case). Create all 54 (`docs/studio/store/ACHIEVEMENTS.md` lists id, name, description,
   hidden flag). Each needs two 256x256 icons (unlocked colour, locked grey); the art brief is in
   `CAPSULE_AND_ART_BRIEF.md`. Names and descriptions are English only today.
2. **Stats and achievements -> "Allow stats and achievements to be set from the client"** is not
   needed; steamworks.js uses the client API. Publish the stats configuration.
3. **Rich presence.** Upload the localisation file `docs/studio/store/RICH_PRESENCE.vdf`
   (Steamworks -> Community -> Rich Presence -> Localization; it is generated from
   `src/steam/presence.ts` by `npm run export:presence`, and `tests/steam-presence.test.ts` fails
   if the committed copy is stale). English text per status:

   | token | text | keys it uses |
   | --- | --- | --- |
   | `#Status_Menu` | In the paddock | |
   | `#Status_Loading` | Loading a session | |
   | `#Status_Racing` | `%discipline%` at `%venue%` in the `%vehicle%` | discipline, venue, vehicle |
   | `#Status_TimeTrial` | Chasing a lap at `%venue%` in the `%vehicle%` | venue, vehicle |
   | `#Status_Wildcard` | Wildcard Series: `%event%` | event |
   | `#Status_Paused` / `#Status_Results` / `#Status_Replay` | Paused at / Reading the results from / Watching a replay from `%venue%` | venue |
   | `#Status_Photo` | In photo mode | |
   | `#Status_Festival` | Roaming the Solvane coast in the `%vehicle%` | vehicle |

   The game sets `steam_display` to `#Status_<status>` and publishes the plain keys `status`,
   `venue`, `vehicle`, `weather`, `discipline` and `event` as **names** ("Aurel Grand Circuit",
   "APX-01 Formula", "Fog", "GP bike racing", "The Descent In The Cloud"; unknown ids pass
   through), each at most 80 characters. A `%key%` the game did not set renders as an empty word
   in Steam; a test pins that every key a status uses is always set. Translations: add a language
   block to the same file; the keys do not change. The demo and the game share the file (upload it
   to each app). Not run against a real client.
4. **Steam Cloud** (Steamworks -> Application -> Steam Cloud). Prefer **Auto-Cloud** (no code):
   - Quota: 100 MB and 10 files is comfortable. `saves.json` holds settings, career, team and
     festival progress (a few KB to a few hundred KB). `ghosts.json` grows with every stored
     time-trial ghost: a 2-minute lap at 30 Hz x 11 floats is about 160 KB raw (the recorder's own
     comment says 50 KB, which is wrong by its own constants) and about 210 KB once base64-encoded
     in the JSON, so 100 ghosts is roughly 21 MB. If that is too much to upload on every save,
     leave `ghosts.json` out of the Cloud rules; nothing else depends on it.
   - Add one root-path rule per platform:

     | Root | Subdirectory | Pattern | Platforms |
     | --- | --- | --- | --- |
     | `WinAppDataRoaming` | `MOTOBOUND/saves` | `*.json` | Windows |
     | `WinAppDataRoaming` | `MOTOBOUND/saves` | `*.json.bak` | Windows |
     | `LinuxXdgConfigHome` | `MOTOBOUND/saves` | `*.json` and `*.json.bak` | Linux (also Steam Deck) |
     | `MacAppSupport` | `MOTOBOUND/saves` | `*.json` and `*.json.bak` | macOS |

   - Do **not** sync `*.tmp` or `saves.corrupt-*.json`, `logs/`, `window-state.json` or the
     Chromium profile folders: window placement is per machine, and IndexedDB is a database
     that must not be file-synced.
   - How it works: the game writes `saves.json`/`ghosts.json` atomically after each save.
     Steam downloads a newer remote copy before launch (and uploads on exit). At start-up the
     renderer compares the file's revision with the revision stored in IndexedDB
     (`src/storage/desktop-mirror.ts`): newer file -> restored into IndexedDB; newer IndexedDB ->
     the file is re-seeded. Two machines that both progressed offline produce a Steam Cloud
     conflict dialog (file level, "keep local / keep cloud"); there is no field-level merge.
   - **Verify with a real client before launch:** play on machine A, exit, start on machine B
     (empty profile), confirm the career arrives; then repeat with B ahead of A.
   - Folder names depend on `productName` (`MOTOBOUND`). Changing it moves `userData`; change
     the rules with it.
5. **Launch options.** Windows: executable `MOTOBOUND.exe`. Linux: `motobound` (the
   `linux-unpacked` folder). On Linux add the launch argument `--no-sandbox` unless you have
   verified that Chromium's user-namespace sandbox works inside the Steam Linux Runtime
   container (the shell also adds it itself when `SteamGameId` is present). Optional extra
   launch entries: `--windowed`, `--borderless`.
6. **Depots.** Upload the **unpacked** folders (`win-unpacked`, `linux-unpacked`, the macOS
   `.app`) with `steamcmd`, not the NSIS installer or AppImage. Redistributables: none required;
   `steam_api64.dll` / `libsteam_api.so` / `libsteam_api.dylib` already ship inside
   `node_modules/steamworks.js/dist/<platform>` (unpacked from the asar).
7. **Do not** ship a `steam_appid.txt` in the depot; Steam provides the id.

## Leaderboards

**What exists.** Two families of board, both "lowest time wins", both **per physics version** (a
physics change starts fresh boards, exactly like the local records, `recordCategory`):

| family | name | score | when it is sent |
| --- | --- | --- | --- |
| time trial | `tt.<circuit>.<machine>.p<physics>` e.g. `tt.alpine-pass.apx01.p21` | best valid lap, integer milliseconds | every valid, player-driven time-trial lap that beats the stored best, plus the local boards' bests once at start |
| Wildcard | `wc.<event>.p<physics>` e.g. `wc.descent-in-the-cloud.p21` | best valid lap of a started, classified, player-driven run, ms | after the career settles the run (never an AI-driven or unclassified one) |

Each score carries three small detail ints (assist, compound, weather as stable codes,
`encodeDetails`). The player's best per board is kept in the **outbox** (save-store key
`steam-leaderboards`, mirrored and Steam-Cloud synced like the other saves); a board is sent when
Steam has not been told its best, retried up to three times per launch and again at the next
launch. Everything is optional and fail-closed: in a browser or a shell without the calls the
runtime is inert and writes nothing; with a shell but no Steam, or a Steam binding with no
leaderboard API, scores wait in the outbox and the game is unchanged.

**Local fallback (all builds).** Paddock -> **RECORDS** lists the local top ten per circuit and
machine (with a GHOST mark where the personal best is saved as a ghost) and the Wildcard best
lap, medal and finish per event. In the desktop build each board also shows `ON STEAM` or
`QUEUED`, and the top line says whether Steam is taking scores. In the web build this is the whole
leaderboard experience (no account, no network).

**The binding gap (important, verified).** `steamworks.js` 0.4.0 is the latest release (npm
`dist-tags.latest`) and its `client.d.ts` exposes achievements, stats, cloud, rich presence,
callbacks, lobbies, workshop and input, but **no leaderboard calls** (`FindOrCreateLeaderboard`,
`UploadLeaderboardScore`, `DownloadLeaderboardEntries` are absent). So this repository's Steam
upload **cannot reach Steam today**: `desktop/src/steam.cjs` `makeLeaderboards` detects that
(`client.leaderboard.findOrCreate` / `.uploadScore` missing) and reports "unavailable" with the
reason, which the RECORDS screen shows. The adapter is written against the call shape below and is
unit-tested with a fake client, **never run against Steam**:

```
client.leaderboard.findOrCreate(name, sortMethod, displayType) -> Promise<handle>
client.leaderboard.uploadScore(handle, score, method, details?) -> Promise<{ scoreChanged, globalRank }>
   sortMethod 1 (ascending), displayType 3 (time in milliseconds), method 1 (keep best),
   details: up to 8 ints (the SDK enum values of ISteamUserStats)
```

Ways to close the gap (an owner decision; none is done here): (a) add the three
`ISteamUserStats` leaderboard calls to a `steamworks.js` fork (it is a small Rust crate over
`steamworks-rs`, which wraps them) and depend on the fork; (b) switch the shell's Steam layer to
a Node FFI binding that exposes leaderboards (the candidate to evaluate is the community
`steamworks-ffi-node`; it was **not** installed or vetted here); (c) keep the leaderboards local
and use Steam achievements, stats and the Steam Cloud ghost files only. Option (a) or (b) needs a
real client and an app id to verify.

**Steamworks dashboard setup (once the binding exists).**

1. App Admin -> **Stats & Achievements** is not needed for leaderboards. Leaderboards are created
   by the game on first use (`FindOrCreateLeaderboard`), so there is nothing to pre-create; the
   names above are the contract. To pre-create the Wildcard boards in the partner site
   (Community -> **Leaderboards**) for review: one board per event in
   `src/career/wildcard-series.ts`, name `wc.<event id>.p<SIMULATION_VERSION>`.
2. Create/accept each board with **sort ascending** (lowest first), display type **Time
   (milliseconds)**, and leave **"only trusted writes" OFF**: the client submits scores, so a
   trusted-writes-only board would refuse every upload.
3. A physics bump (`SIMULATION_VERSION`, `src/core/session-identity.ts`) creates new `.p<n>`
   boards by itself; archive the old ones in the dashboard when convenient.
4. **Trust.** Client-submitted lap times are not verified and a determined player can submit any
   time. The game rejects laps outside 3 s to 30 min and AI-driven laps, nothing more. The
   verified-session record format in `src/net/records.ts` (a server re-simulates the input
   journal) is the path to trusted boards; it is a prototype, not wired to Steam.
5. **Privacy.** The page sends board name, score and three ints; Steam attaches the player's
   identity. No other personal data leaves the machine.

## The demo app (Next Fest)

A Steam demo is its own app with its own app id (Steamworks -> Add new app -> Demo for the game).
It is built from this repository with `npm run build:demo` and packaged by the demo scripts (see
`desktop/README.md`); its content slice is `src/release/demo.ts` (3 circuits, 2 formula cars, 1 GP
bike, 1 motocross bike, 5 Wildcard events, the first licence, a 15 minute coast visit).

- **Depots/launch options:** upload `desktop/release-demo/win-unpacked`, `linux-unpacked` and the
  macOS `.app` (not the installer); Windows executable `MOTOBOUND Demo.exe`, Linux
  `motobound-demo`. Steam provides the app id at launch; do not ship `steam_appid.txt`.
- **WISHLIST button:** package with `MOTOBOUND_STORE_APPID=<the FULL game's app id>` so the FULL
  GAME plates open `https://store.steampowered.com/app/<id>/` (with `utm_source=motobound-demo`
  and a per-plate `utm_campaign`). Without it the button tells the player the page is not live.
- **Steam Cloud (demo):** same auto-cloud rules as above with the root path `MOTOBOUND Demo/saves`
  instead of `MOTOBOUND/saves`. Demo progress is not carried into the game.
- **Achievements:** the shell forwards the game's 54 unlocks to whatever app it runs under. Steam
  documents restrictions on what a demo app may use; check the current Steamworks documentation
  before relying on demo achievements (unverified here), and if they are not allowed leave the
  achievement set empty in the demo's dashboard (unknown ids are ignored by the shell).
- **Rich presence and leaderboards:** same tokens; leaderboards follow the section above.

## Known limits

- The in-process-GPU switch that `electronEnableSteamOverlay()` adds can change GPU behaviour
  and is only applied when Steam actually initialised. If it causes problems set
  `MOTOBOUND_STEAM_OVERLAY=0` (the overlay then will not render over the game).
- `steamworks.js` 0.4.0 is a small community binding. It exposes achievements, rich presence,
  cloud files, input and callbacks; there is no Steam Input action-set integration here, so
  the game depends on Steam's default gamepad/keyboard templates.
- If the game is started directly (not through Steam) with no `steam_appid.txt`, Steam features
  are simply off. There is no DRM and no `SteamAPI_RestartAppIfNecessary`; add it with the real
  app id if you want "must launch via Steam".
