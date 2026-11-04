# Launch plan

Target and arithmetic come from [RELEASE_GATES.md](../RELEASE_GATES.md) (US$5,000/month net needs
roughly US$7,150 gross; about 360 paid units/month at US$19.99, about 480 at US$14.99). **Every
number below that is not a measurement is an assumption and is labelled so.** Nothing here is a
sales forecast: the repository has no wishlist, playtest or market data yet (gates G12-G14 are
open).

`L` means launch day (1.0 on Steam). Months are counted from `L`.

## 1. Positioning (what the page and every post says first)

One sentence: **"A racing game that lets you put the wrong machine on the right track."**
Cars, GP bikes, motocross and supercross, plus an open-world festival, with changing weather
and a Wildcard series of deliberately mismatched vehicle/venue events (gate G6; the claim only
goes on the page once the series ships).

Competitive frame (honest): AAA sims and arcade racers are well served; the gap this game can
claim is **breadth on one engine** (47 circuit layouts and 57 machines across four disciplines)
and **offbeat pairings**, at an indie price. It must not claim sim-grade authority it cannot
back with reviews.

## 2. Wishlist funnel

| Stage | When | Work | Evidence needed |
| --- | --- | --- | --- |
| Store page review | `L`-9 months (assumption: Valve review + two weeks "Coming soon" minimum) | Capsules, 5+ screenshots, trailer, description from `STORE_PAGE.md`, tags, system requirements, age rating answers | Packaged build screenshots on a real GPU (gate G8) |
| Page live, "Coming soon" | `L`-8 | Every public post links to the page; add a wishlist call-to-action to the end card and the in-game credits/menu | Wishlist counter from Steamworks |
| Devlogs | every 2-3 weeks from `L`-8 | Short posts built on a single shot of a mismatched pairing or a weather change (these are the shareable moments) | Page views / wishlist adds per post (Steamworks UTM links) |
| Demo | `L`-5 | Separate demo app (Steam requires its own app); 30-45 min: Aurel formula race, one GP bike venue, one motocross venue, a slice of the festival; no save carry-over promises. **Built:** `npm run build:demo` + `desktop/README.md` (3 venues, 4 machines, 5 Wildcard events, first licence, 15-minute coast; FULL GAME plates with a wishlist button; `docs/studio/reports/release-2.md`) | Demo completion funnel, crash-free rate |
| Next Fest | the Steam Next Fest nearest `L`-3 to `L`-4 (three per year; check the Steamworks calendar for dates) | Demo live, streamer keys out two weeks before, a live developer stream during the fest | Wishlists gained during the fest vs the baseline |
| Playtests | `L`-6 to `L`-2 | Steam Playtest or direct keys to >= 10 outside players (gate G12: >= 70% would recommend) | Survey results, first-hour drop-off |
| Release-date announcement | `L`-6 weeks | Fixes the date; wishlist email goes out at release | |
| Launch | `L` | Price from `STORE_PAGE.md`, launch discount if used, patch-ready build | Refund rate (< 10%), review score (>= 80%) |

Wishlist goal: gate G13 is **>= 10,000 before launch**. How that translates to units is an
**assumption**: if a fraction `c` of wishlists buys in the first month, launch-month units =
`c` x wishlists. For `c` = 10% / 15% / 20% (community rule-of-thumb, unverified for this game)
10,000 wishlists would be 1,000 / 1,500 / 2,000 units. The sustained target (about 360 units
a month at US$19.99) has to come from the long tail below, which is why updates and sales
matter more than the launch spike.

## 3. Creator and press outreach

1. **Segments** (separate pitches, because the hook differs):
   - Sim-racing and "weird racing" YouTubers/streamers: the Wildcard pairing clips.
   - Motorcycle and motocross communities: the GP/MX/SX physics and jump landing.
   - Open-world/driving-festival creators: the drift zones, speed traps, photo mode.
   - Small-game curators and Steam curators for racing/driving tags.
2. **Tiering** (assumption: reach is worth more in many small channels than in a few large
   ones for a niche racing title): hundreds of 1k-30k channels over a handful of large ones.
3. **Assets ready before the first email** (a press kit page on the studio site): trailer
   (YouTube + download), 12+ screenshots, logo, capsule art, a one-page fact sheet, a keys form.
4. **Keys:** generated in Steamworks (a Steam Keys request per batch); distribute with a
   tracking sheet (recipient, date, platform, video link, coverage). Demo keys are not needed.
5. **Pitch template:** 3 lines. What it is, the one clip that proves it, the key and the
   embargo/no-embargo. Follow up once, after a week.
6. **Disclosure:** creators must disclose free keys (platform rules, FTC); the pitch says so.
7. **Cadence:** a creator batch at demo launch, Next Fest, `L`-2 weeks, `L`, and each major
   update.
8. **Press:** one embargoed announcement at `L`-6 weeks, one release post; game-specific
   outlets only, no mass blast.

## 4. Update cadence, `L` to `L`+12 months

The principle: *something new on the page every month, a bigger content drop each quarter,
timed to Steam sale/event windows so the discount and the news land together.* Exact Steam
sale and themed-fest dates change yearly: take them from the Steamworks calendar. Scope per
drop is a plan, not a commitment, and is sized by what already exists in the codebase.

| When | Release | Content (assumption: drawn from the existing roadmap in `docs/production/`) | Page/marketing |
| --- | --- | --- | --- |
| `L` | 1.0 | Four disciplines, festival, Wildcard series (>= 12 events), >= 6 weather states, 54 achievements, controller menus, Steam Deck verified attempt | Launch trailer, 10-15% launch discount (see `STORE_PAGE.md`) |
| `L`+2 weeks | 1.0.1 | Crash/stability patch from the first 2 weeks of Steam logs; top-voted quality-of-life fixes | Patch notes; a thank-you post |
| `L`+1 month | 1.1 "Weather" | Extra weather states/time-of-day events, wet-weather achievements balance | Devlog + clips of the new weather |
| `L`+2 months | 1.1.x | Bug fixes, difficulty/assist tuning from reviews | |
| `L`+3 months | 1.2 "Wildcard II" | A second batch of mismatched events and 2-3 venues | Aim at a Steam sale window; creators batch 3 |
| `L`+4 months | 1.2.x | Accessibility and input pass (rebinding, subtitles/captions already present) | |
| `L`+5 months | 1.3 "Festival" | New festival region or event types; photo-mode filters | Photo contest on Discord/Steam |
| `L`+6 months | 1.3.x | Performance pass from collected hardware reports; Deck compatibility improvements | |
| `L`+7 months | 1.4 "Dirt" | Motocross/supercross additions (new venues, rhythm-section variants) | Aim at the next Steam sale window |
| `L`+8 months | 1.4.x | Localisation of the highest-value languages (assumption: after reviews show where players are) | |
| `L`+9 months | 1.5 "Garage" | Livery editor depth, new machines in an under-served class | Creator batch 4 |
| `L`+10 months | 1.5.x | Bug fixes; mod/Workshop feasibility spike (the content-import module exists) | |
| `L`+11 months | 1.6 "Anniversary build-up" | Quality-of-life, balance, community-requested features; preparation for an anniversary sale | Roadmap post for year two |
| `L`+12 months | 2.0 candidate | Decide from data: paid expansion vs free major update vs price change | Anniversary post and sale |

Rules for the cadence: no more than two patch days a month; every release has notes; a hotfix
beats a feature; a release is not announced as a "content drop" unless it adds something a
player can see in a trailer clip.

## 5. Community

- **Where:** Steam discussions and the Steam news hub (primary: it feeds the wishlist/follower
  emails), plus one Discord server. Do not open more channels than can be answered within a
  day.
- **Moderation:** two volunteer moderators before launch, written rules, a bug-report
  channel that pins the template (game version, platform, steps, and `userData/logs/main.log`).
- **Feedback loop:** a public roadmap list (themes only, no dates the team cannot hold),
  a monthly "what we fixed/what is next" post, an in-game link to the Discord from the menu.
- **Events:** weekly ghost-lap challenge on one venue/machine (the game already stores ghost
  laps and time-trial leaderboards locally), monthly photo contest.
- **Support:** one inbox, documented answers for the top issues (GPU drivers, controller
  mapping, where saves live: `userData/saves`, how to reset), refund-friendly tone.

## 6. Measurement (what is tracked, and the decision it feeds)

| Metric | Source | Decision |
| --- | --- | --- |
| Wishlist adds per source | Steamworks wishlist reports, UTM links | Which creator segment/devlog to repeat |
| Demo -> wishlist, demo completion | Steamworks demo stats | Is the demo too long/short/confusing |
| First-hour drop-off (playtests) | Playtest survey + session logs (opt-in) | Fix first-launch flow (gate G3: <= 90 s, <= 3 inputs) |
| Refund rate | Steamworks | Gate G14: < 10%; above it, fix the first two hours before marketing |
| Review score and text themes | Steam reviews | Gate G14: >= 80% positive; drives the update order |
| Units/month and net revenue | Steamworks sales | Compare with the `RELEASE_GATES.md` target |
| Crash-free sessions | Own log upload (opt-in) or bug reports | Stability before features |

## 7. Not in this plan (needs a human decision)

- Marketing budget, ads, a publisher: no budget data exists.
- Console ports.
- Price changes beyond the options in `STORE_PAGE.md`.
- Early Access: an alternative to a 1.0 launch while G12-G14 are unmet; see `STORE_PAGE.md`.
