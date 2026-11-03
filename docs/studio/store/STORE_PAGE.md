# Store page kit: MOTOBOUND

Working copy for the Steamworks store page. **Every claim below is limited to what the current
build contains**; items that depend on unfinished studio gates are marked **[after G#]** and
must be removed or kept out of the page until that gate is closed. Numbers that are not
measurements are labelled *assumption*.

## Short description (Steam allows 300 characters)

> Race circuit cars, GP bikes, motocross and supercross on 46 circuit layouts, then leave the
> track for an open-world coast festival. Changing weather, replays, a livery editor, licence
> tests and a career. Offline, single-player, built to be driven with a pad or a wheel.

(292 characters. Add "A Wildcard series pairs the wrong machine with the right track." only
**[after G6]**.)

## Long description

**About**

MOTOBOUND is a motorsport sandbox for people who like their racing varied. You start in the
paddock, pick a machine and a venue, and drive: single-seater and GT cars, GP motorcycles, and
dirt bikes on motocross and supercross courses, with real tyre, suspension and aerodynamic
models behind every one of them. Between races you build a career, a team and a livery, or
leave the circuits altogether and roam a coastal festival region full of races, speed traps,
drift zones and jumps.

**Four disciplines, one garage**

Circuit cars from entry formula to hypercars and GT, touring cars, prototypes, karts, rally and
rallycross cars, a trophy truck and road cars; GP and road motorcycles with lean angle,
trail-braking and brake fade; and motocross and supercross bikes with long-travel suspension,
deformable soil and real jumps. 57 machines in total, each with its own handling, setup and
sound.

**46 circuit layouts**

Street circuits, an airfield, mountain and desert roads, docklands, a night terminal, a salt
flat, forest rings, a speed bowl, a hillside motocross course, a floodlit supercross arena, a
rallycross track and a gravel stage. Layouts are original designs and approximations drawn from
public geometry; no real venue names are used.

**Weather and light**

Clear, dry-to-rain and heavy-rain sessions change grip, spray, braking and the line you must
take. **[after G6: six or more weather states and time of day.]**

**The festival**

Step out of the paddock into the Solvane Coast: a road network with a harbour town, an
airfield, a mountain pass and coastal highways. Join races against rivals, chase speed-trap and
speed-zone targets, score drift zones, land jumps and bank skill chains, discover new places,
and photograph it all in photo mode.

**Career, team and licences**

Earn licences with medal-graded tests (braking, cornering, wet control, lean, jump landing),
enter championships, buy and tune machines, and run your team from the Team HQ.

**For the obsessive**

Instant replay and a 30-second flashback, telemetry with export, time-trial ghost laps with
local leaderboards, a livery and decal editor, per-vehicle setups, wheel and pedal calibration,
gamepad rumble channels, colour-blind, high-contrast, reduced-motion and caption
options.

**Offline by design.** No account, no always-online requirement, no microtransactions, no ads.
Steam achievements (54) and Steam Cloud saves are supported **[after the Steam checks in
`desktop/STEAM.md` pass on a real client]**.

## Six feature bullets (for the "Key features" block)

1. **Four disciplines on one engine**: circuit cars, GP motorcycles, motocross and supercross.
2. **57 machines and 46 circuit layouts**, from karts and hypercars to dirt bikes and a trophy truck.
3. **Dry, damp and soaked**: weather that changes grip, braking and the racing line.
4. **An open-world festival** with races, speed traps, drift zones, jumps and a photo mode.
5. **Career, licences and a team** to build over many hours, plus a livery editor.
6. **Tools that reward practice**: replay, flashback, telemetry, ghost laps and 54 achievements.

## Tags (Steam allows 20; ordered by importance)

Tick these now: **Racing, Driving, Simulation, Motorbike, Open World, Singleplayer, Offroad,
Controller, Physics, Sports, 3D, Atmospheric, Sandbox, Automobile Sim** (and *Photo Mode* if the editor offers that tag).

Hold back until true: *Realistic* (qualifier needed), *Arcade* (only if playtests show the
assist mode plays that way), *Moddable* (only if a mod path ships; see `LAUNCH_PLAN.md`).
Never tick: *Great Soundtrack* (no soundtrack ships), *Co-op* / *Multiplayer* (single-player).
Check the live tag list in the Steamworks tag editor; names change.

Categories: Single-player; Steam Achievements and Steam Cloud **[after verification]**;
Partial Controller Support **until the menus are navigable by pad** (then Full); Family
Sharing on.

## Genre positioning (what the game honestly is)

A **sim-cade multi-discipline racer** with an indie scope: more breadth than the cheap arcade
racers, less authority and polish than the AAA simulators. The pitch is variety on one engine
and the oddball pairing of machine and venue, not simulation purity. Comparable shelf: indie
and mid-price racers with strong physics and community modes, not the big licensed series.
Do not describe it as "realistic" without a qualifier; do not compare it to licensed titles on
the page.

## System requirements

**Measured** (release engineer, packaged Linux x64 Electron 44 build, 4 shared CPU cores,
**software rendering** only; no physical GPU or Windows/macOS machine was available):

| Quantity | Measured | How |
| --- | --- | --- |
| Install size (game data) | 166.3 MiB (174,351,814 bytes, 249 files) | `desktop/web` staged without source maps |
| Install size (Linux unpacked, game + Electron) | 451.5 MiB (473,455,496 bytes); the Electron executable alone is 229 MB | `du -sb` of `linux-unpacked` |
| Download size (zip of that folder) | Linux zip 236.3 MB, Linux AppImage 243.7 MB, Windows zip 270.2 MB (built from Linux, never run) | `desktop/release/*` |
| Main JavaScript | 14.6 MB raw, 4.5 MB gzip | `dist/assets/index-*.js`, `gzip -c` (gate G7 wants <= 4 MB gz) |
| Memory at the menu | 1.42-1.45 GiB in total (browser 167 MiB, renderer 539-544 MiB, GPU process 637-659 MiB, utility 75 MiB); the GPU-process share is SwiftShader's software rasteriser and will differ on a real GPU | `app.getAppMetrics()`, all processes, working set |
| Memory in a practice session | not measured: on the loaded software-GL machine the session load stalled at 94% after the GPU process died (see the release report) | same, 5 s after the car was on track |
| Time to menu | 89 s (existing profile) to 100 s (fresh profile), packaged build, machine at load average 14-18; **not representative** of a GPU | software GL |
| Simulation cost | not measured (needs a running session) | physics step in the worker (`H.STEP_MS`), CPU only |
| Frame rate | not measurable | SwiftShader on shared CPUs gives single digits and says nothing about a GPU |

**Requirements text for the page** (the measured RAM includes the software rasteriser's
buffers, so the GPU-process share will be lower on real hardware: *assumption*; confirm on
three real machines before publishing):

- **Minimum:** 64-bit Windows 10 / SteamOS or Ubuntu 22.04-class Linux / macOS 12; 4-core CPU
  (*assumption: the simulation runs in a worker thread beside the render thread*); 8 GB RAM;
  a GPU with WebGL 2 / Vulkan 1.1 or DirectX 11 class support and 2 GB VRAM (*assumption*);
  4 GB of storage; a gamepad or keyboard.
- **Recommended:** 6+ cores, 16 GB RAM, a GPU in the class of a mid-range card from the last
  five years with 4 GB VRAM (*assumption*), SSD, a gamepad or wheel.
- Steam Deck: **unverified** (`STEAM_DECK_CHECKLIST.md`).

WebGL 2 is a real requirement (three.js r180's renderer is WebGL 2 only); the GPU class is not
yet measured (gate G8). Replace the assumptions with measurements from a minimum-spec GPU before
launch.

## Price recommendation (net-revenue arithmetic)

Source of the target and the 30% cut: [`RELEASE_GATES.md`](../RELEASE_GATES.md). Net US$5,000 per
month at a 30% Steam share needs gross revenue of 5,000 / 0.70 = **US$7,143 per month**.
Taxes (VAT/sales tax) are handled by Steam before the split and are ignored here.

Units per month needed to reach that gross, by list price:

| List price | Net per unit at list | Units/month at list price | Units/month if the average realised price is 75% of list (*assumption*: regional pricing and discounts) |
| --- | --- | --- | --- |
| US$9.99 | 6.99 | 715 | 953 |
| US$14.99 | 10.49 | 477 | 636 |
| US$19.99 | 13.99 | 357 | 476 |
| US$24.99 | 17.49 | 286 | 381 |

(Add refunds on top: at an *assumed* 8% refund rate, gross units must be about 1/(1-0.08) =
1.09 times these. The gate G14 target is < 10%.) A one-time Steam Direct fee (US$100 per app at
the time of writing) is recouped after US$1,000 of revenue; it is negligible against the target.

**Recommendation (an opinion, not a forecast):** launch at **US$14.99** with a 10% launch
discount for the first two weeks (US$13.49). Reasons: the product has not yet passed the
first-launch, front-end, Deck or performance gates (G3, G5, G7, G8), so the risk that matters
most is a poor first two hours and the refund window; a lower price makes the score easier to
earn and lowers the refund incentive, and the score (G14: >= 80% positive) drives discovery
more than the margin. Steam's regular sale windows will push the realised price below list in
any case, which is why the realised-price column is the one to plan on.

Raise to **US$19.99** only after (a) the Wildcard series and six weather states have shipped,
(b) at least 50 reviews are >= 80% positive, and (c) a content update has actually changed the
page (a price rise after launch with no new content costs goodwill). At US$19.99 the realised
need is about 476 units a month; at US$14.99 it is about 636. The plan to reach either figure
is in `LAUNCH_PLAN.md` and is unproven.

**Alternative to weigh:** Steam Early Access at US$12.99 while G12-G14 are open. It turns the
"not finished" problem into an honest label and a community loop, at the cost of a second
"launch" later and the Early Access stigma some players hold. This is a producer decision, not
an engineering one.

## Not for the page until true

- "Full controller support" (gap: menu navigation).
- "Steam Deck Verified".
- Any Wildcard, weather-count, or "live" claims listed above as **[after G#]**.
- Review scores, sales or wishlist numbers: none exist.
- Languages other than English.
