# Localization: architecture, seven first-hour translations, and the plan for the rest

Branch `studio/localization-i18n` (cut from `main` 3aa69f2). Department: Localization.

> **Every translation in this change is a model-written first draft. None has been read by a native
> speaker. They MUST get a native review before any of them is shipped or listed on Steam** (checklist
> in section 6). The checks below prove that the dictionaries are complete, consistent and drawable;
> they cannot prove that a sentence is good Polish.

## 1. Result in one screen

| Area | State |
| --- | --- |
| Architecture (`src/i18n/`) | Done: typed `t / th / ta / tx`, ICU-lite placeholders and plurals on `Intl.PluralRules`, `Intl` numbers, units and dates, detection, per-language lazy chunks. |
| Language setting | `Settings.language: 'auto' | 'en' | 'de' | 'fr' | 'es' | 'pt-BR' | 'it' | 'pl' | 'tr'` (validated; older saves and unknown codes read as `auto`). LANGUAGE dial in Settings and on the first-launch screen. `<html lang>` follows. |
| Wired surfaces | Paddock Board, first launch, pause, race briefing, loading + tips, HUD labels and race-control banners, results board, Settings (incl. SOUND MIX), career season board, Wildcard board (events by id), machine lines, achievements (toast; ids stable), toasts. Section 3 lists what is **not** wired. |
| Translations | de, fr, es, pt-BR, it, pl, tr: **1,073 strings each** (850 interface strings + 108 achievement names/descriptions + 58 Wildcard titles/pitches + 57 machine lines). |
| English unchanged | Proved: the markup of nine screens captured **before** any string was touched is byte-identical afterwards (section 7). |
| Layout | 8 languages x 7 screens x 2 viewports checked in a browser; two real overflows found and fixed in CSS (section 8). |
| Fonts | No font added. Russian, Chinese, Japanese and Korean need font files: plan in section 10. |
| Store page | Seven drafts in `docs/studio/store/localized/` (section 11). |

## 2. Architecture

```
src/i18n/
  locales.ts   Locale list, native names, matchTag / detectLocale / resolveLocale / validateLanguage (pure)
  message.ts   ICU-lite: {name}, {n, plural, one {# x} other {# y}}, =0 matches; requiredCategories(locale)
  index.ts     active language + dictionary, t/th/ta/tx(+h/a), setLocale (lazy), Intl helpers, upper()
  mark.ts      N_('text'): marks data strings for extraction; costs nothing (also safe inside the worker)
  data.ts      id-keyed helpers: wildcardTitle/Pitch, achievementName/Description, machineCharacterLine
  startup.ts   startupLocale(store): read Settings.language, load the dictionary before the UI exists
  dict/<lang>.ts  one module per language, loaded with `import()` into its own chunk
src/ui/language-control.ts   the LANGUAGE dial (first launch + Settings)
scripts/i18n-catalogue.ts    reads the English catalogue from the source with the TypeScript parser
scripts/i18n-extract.ts      the translator's worklist (--json, --stats)
scripts/i18n-check.ts        the dictionary gate (also run by tests/i18n.test.ts); --tsv <lang> makes a review sheet
```

**English text is the key.** `t('GARAGE & SETTINGS')` is that string under `en` and for anything a
dictionary lacks, so no test or e2e that runs in English can change. Data tables with stable ids use
`tx(key, english)`: `achievement.<id>.name`, `wildcard.<id>.title`, `machine.<id>`. Rewording an
English source therefore cannot orphan a translation of an achievement, and the achievement ids stay
the Steam API names. Four forms: `t` (plain text), `th` (escapes `& < >` of the message text, for HTML
templates), `ta` (also escapes `"`, for attributes), `tx`. Parameters are inserted verbatim (callers
pass numbers or already-escaped HTML). A message that falls back to English uses English plural rules.

**Data constants are marked, not translated, at load.** The locale is chosen before the UI is built but
after the modules are evaluated, so tables such as the weather catalogue, discipline specs and
loading tips keep English literals wrapped in `N_()`, and the place that shows them calls `t(value)`.
The extraction finds `t/th/ta/N_` literals (and both branches of a conditional) anywhere under `src/`.

**Numbers and time.** `fixed(value, digits)` is `toFixed` with the language's decimal mark (identical
under English), used for lap times (`1:23.456` becomes `1:23,456` in German), gaps, lengths, fuel and
the weather readout. `formatNumber / formatUnit / formatDate / formatTime / formatLapTime` wrap `Intl`.
English dates use `en-GB` to keep the existing `3 Nov 2026` look. `upper()` is `toLocaleUpperCase` for
the active language (Turkish `i` becomes `İ`). The CSS `text-transform: uppercase` follows `<html lang>`.

**Detection and override.** `navigator.languages` is walked in the player's order and the first
supported language wins (`pt-PT` and bare `pt` use the Brazilian dictionary; anything unsupported ends
in English). `Settings.language` overrides it. `main.ts` reads the saved setting from the same save
store before the application is built (`await startupLocale(saveStore)`, 1.5 s cap, never throws), so
every screen is built in the right language from the first paint. Each dictionary is a lazy chunk:
**no dictionary is in the initial JavaScript** (section 7).

**Changing language restarts the page.** The paddock board, HUD and every modal are built once from
templates; rebuilding them live would touch the renderer, the worker and a hundred listeners. So:
- Settings: APPLY & SAVE stores the setting; if the language changed and the game is at the paddock it
  reloads after the write completes, otherwise a toast says it applies at the next start.
- First launch: the dial's change is announced as `language:<code>`; `GameApp.changeLanguage` stores
  the setting, **drops the first-launch record** (it is written when the screen opens) and reloads, so
  the screen comes back in the new language. Cost: one reload, only for a player whose language was
  detected wrongly.

**Words drawn by the style sheets** (`PADDOCK`, `CHOSEN`, `SMOOTH`, `PLAYABLE`, `LOW`) are
`content: var(--t-paddock, 'PADDOCK')`: the English stays in the CSS and other languages arrive as
custom properties on `<html>`.

**Adding a string:** write `t('English text {n}', { n })` (or `N_()` for a data constant) and run
`npm run check:i18n`: it lists the languages that lack it. **Adding a language:** add the code to
`locales.ts`, a loader to `index.ts`, a `dict/<code>.ts`, and its native name; the gate, the layout
spec and `tests/i18n.test.ts` iterate `LOCALES`.

## 3. Coverage: what is and is not translated

Wired (first-hour path): `interface.ts` (paddock template, dials and options, HUD labels and dynamic
readouts, pause menu and summary, controls card, results heading, qualifying results, championship,
error screen, Settings form), `launch-board.ts`, `disciplines.ts`, `circuit-menu.ts` and
`machine-options.ts` group labels, `demo-plate.ts` (DEMO plate, wishlist, FULL GAME tags),
`first-run.ts`, `race-briefing.ts`, `loading-copy.ts`, `loading-tips.ts`, `results-board.ts`,
`presentation.ts` (graphics, accessibility, rumble, weather readout), `audio-mixer.ts`,
`audio-accessibility.ts`, `settings-guide.ts` (chrome), `career-hub.ts` (season board, wallet, garage
block, ladder, payout panel, nav), `career/next-up.ts` (the plan), `wildcard-board.ts` (chrome and all
29 events through `wildcard.<id>.*`), `f1-hud.ts` (banners, session heading), `machine-character.ts`
(57 lines), `steam/runtime.ts` (achievement toast), `main.ts` (toasts, language flow).

**Not translated** (still English; none is blocking the first hour, all are listed so nobody assumes):

- Circuit names are proper names and stay; the **51 circuit blurbs** (`catalogue.description`) and the
  machine names (`APX-01 Formula`) stay in English.
- Vehicle setup screen (`setup-screen.ts`), the quality guide's GPU reasons and preset-table values,
  graphics option value labels ("Near + far", "ACES filmic"), device calibration, telemetry views.
- Career pages other than the season board (events, licences, garage, dealership bodies; licence test
  briefings and results; event cards), Team HQ, Driving Academy, Records, Credits, Photo/Livery studio.
- Secondary HUDs: bike, off-road, motocross status, festival, compact and race-day sheets, replay bar
  chrome that was not in the main template, sector panel, radio captions, race-control event text.
- Canvas text: the result share card PNG, the minimap and the festival HUD canvases.
- `index.html` title and meta description, the desktop shell menus, Steam rich presence and the
  Steamworks-side achievement text (the dictionary keys are ready to export for it).
- Developer tools, diagnostics and test hooks, on purpose.

## 4. String counts

| Language | Dictionary entries | Interface | Achievements | Wildcard | Machine lines |
| --- | ---: | ---: | ---: | ---: | ---: |
| German (de) | 1,073 | 850 | 108 | 58 | 57 |
| French (fr) | 1,073 | 850 | 108 | 58 | 57 |
| Spanish (es) | 1,073 | 850 | 108 | 58 | 57 |
| Portuguese-Brazil (pt-BR) | 1,073 | 850 | 108 | 58 | 57 |
| Italian (it) | 1,073 | 850 | 108 | 58 | 57 |
| Polish (pl) | 1,073 | 850 | 108 | 58 | 57 |
| Turkish (tr) | 1,073 | 850 | 108 | 58 | 57 |

Source: `node --experimental-transform-types scripts/i18n-extract.ts --stats` (1,073 strings, 6,102
English words). Largest sources: `interface.ts` 243, achievements 108, `career-hub.ts` 73,
Wildcard 58+58, machine lines 57, `presentation.ts` 55.

## 5. Glossary (the terms the drafts use consistently)

Address: informal singular throughout (du, tu, tú, você, tu, Ty, sen). Labels keep the board's capitals.

| English | de | fr | es | pt-BR | it | pl | tr |
| --- | --- | --- | --- | --- | --- | --- | --- |
| pole position | Poleposition | pole position | pole position | pole position | pole position | pole position | pole pozisyonu |
| grid (the field / the start) | Feld / Startaufstellung | plateau / grille | parrilla | grid | griglia | stawka / start | grid |
| lap | Runde | tour | vuelta | volta | giro | okrążenie | tur |
| tyre | Reifen | pneu | neumático | pneu | gomma | opona | lastik |
| compound soft / medium / hard | weich / mittel / hart | tendre / medium / dur | blando / medio / duro | macio / médio / duro | morbida / media / dura | miękkie / średnie / twarde | yumuşak / orta / sert |
| full wet | voll nass | pluie extrême | lluvia extrema | chuva forte | pioggia estrema | pełny deszcz | tam ıslak |
| pit stop | Boxenstopp | arrêt aux stands | parada en boxes | parada nos boxes | pit stop | zjazd do boksu | pit stop |
| pit lane | Boxengasse | voie des stands | calle de boxes | boxes | corsia dei box | aleja serwisowa | pit koridoru |
| slipstream / tow | Windschatten | aspiration | rebufo | vácuo | scia | szpica | arkasına takılma |
| flashback | Flashback | flashback | flashback | retrocesso | flashback | flashback | geri sarma |
| chequered flag | Zielflagge | drapeau à damier | bandera a cuadros | bandeira quadriculada | bandiera a scacchi | flaga w szachownicę | damalı bayrak |
| safety car | Safety-Car | voiture de sécurité | coche de seguridad | safety car | safety car | samochód bezpieczeństwa | güvenlik aracı |
| qualifying | Qualifying | qualifications | clasificación | classificação | qualifiche | kwalifikacje | sıralama |
| free practice | Freies Training | essais libres | entrenamientos libres | treino livre | prove libere | trening swobodny | serbest antrenman |
| time trial | Zeitfahren | contre-la-montre | contrarreloj | contrarrelógio | giro a tempo | jazda na czas | zamana karşı |
| endurance | Langstrecke | endurance | resistencia | endurance | endurance | wyścig długodystansowy | dayanıklılık |
| machine (vehicle) | Fahrzeug | machine | máquina | máquina | mezzo | pojazd | araç |
| circuit (dial) | Strecke | circuit | circuito | circuito | circuito | tor | pist |
| venue | Schauplatz | site | sede | local | sede | miejsce | mekân |
| paddock | Fahrerlager | paddock | paddock | paddock | paddock | padok | pit alanı |
| licence | Lizenz | licence | licencia | licença | licenza | licencja | lisans |
| reputation | Ansehen | réputation | reputación | reputação | reputazione | reputacja | itibar |
| livery | Lackierung | livrée | pintura | pintura | livrea | malowanie | kaplama |
| Wildcard Series (series name) | Wildcard-Serie | Série Wildcard | Serie Wildcard | Série Wildcard | Serie Wildcard | Seria Wildcard | Wildcard Serisi |
| DRS, ERS, ABS, TC, MSAA, FPS | unchanged | unchanged | unchanged | unchanged | unchanged | unchanged | unchanged |

Two words the **IP guard** refused in the first build and the gate now catches at the desk (section 7):
the real-brand denylist matches ordinary words in some languages (German *sauber*, Italian *forza*,
Portuguese *fim*, Spanish and Italian *gran turismo*, and "Moto GP" in any). They were reworded
(*weich*, *spinta*, *final*, *GT*, *moto de GP*); do not reintroduce them in review.

## 6. Native-review checklist (per language, before release)

Reviewer gets `node --experimental-transform-types scripts/i18n-check.ts --tsv <lang>` (key, English,
translation) and the contact sheets in `docs/studio/reports/localization-screens/`.

1. Read every string against the English; fix meaning first, then register (informal "you" is the
   drafted choice; confirm it suits a Steam audience in that market).
2. Terminology: the glossary above, motorsport terms as the local broadcast says them. Check that
   *tyre compound*, *pit stop*, *slipstream*, *flashback* and *grid* read naturally, and that
   "machine" is the right word for car-or-bike in that language.
3. Plurals: every plural message has the branches the language needs (the gate checks presence, not
   grammar). Polish `few / many / other` forms, Turkish numerals (no plural after a number), and the
   fractional case (`other`).
4. Casing and length: labels are stencilled capitals; confirm nothing reads shouted or truncated.
   German compounds and Polish/Turkish suffixes are the layout risk (section 8).
5. Humour and wordplay in the 54 achievement names and the 29 Wildcard titles (*Rostrum Regular*,
   *Lights to Flag*, *Needle Thread*, *Sideways Savant*): the drafts adapt rather than translate; keep
   the intent, change the pun freely. Achievement ids never change.
6. The 57 machine lines are descriptive handling copy: check the engineering words (understeer, lift-off,
   squat, boost lag) against how that market's reviewers write.
7. Placeholders and units: `{n}`, `{key}`, `{name}`, `KG`, `KM/H`, `M/S`; decimal comma; `FPS`.
8. Legal: no real team, sponsor, series or game name; run `npm run check:i18n` (it runs the IP guard's
   matcher) after every edit, then `npm run build`.
9. Per language: German noun capitalisation and `ß`; French non-breaking space before `: ; ? !`
   (drafts use a plain space: decide); Spanish inverted marks; pt-BR vs pt-PT vocabulary (`pt-PT` users
   get this dictionary); Italian apostrophes; Polish `ó ł ż ź`; Turkish dotted/dotless `İ ı` (verify the
   uppercase forms with `lang="tr"`).

## 7. What was verified (commands and results)

Run from the worktree root on the final tree unless noted. Software GL, 4 shared CPUs.

| Check | Command | Result |
| --- | --- | --- |
| Typecheck | `npx tsc --noEmit` | 0 errors |
| Lint (changed files, incl. `src/i18n`, scripts, tests, e2e) | `npx eslint <changed files>` | 0 problems |
| Dictionary gate | `npm run check:i18n` | 7 languages x 1,073 entries, **0 errors, 0 warnings** (keys, placeholders, plural branches, untranslated copies, glyph coverage, capitals, IP matcher) |
| New unit tests | `npx vitest run tests/i18n.test.ts` | 28 passed (messages, plurals incl. Polish `few/many`, detection, Settings migration, lazy load of every dictionary, numbers/dates, gate catches planted defects) |
| English identity (data tables, builders) | `npx vitest run tests/i18n-english-identity.test.ts` | passed against `tests/fixtures/i18n-english-identity.json`, captured from the code **before** any string was localised |
| Related unit tests (two batches, one vitest run each, never the full suite) | batch 1: 28 files (achievements, audio-music-settings, bindings, button-actions, career*, demo-*, e2e-fixture-bundles, first-run, front-end-*, frontend-*, machine-*, results-settings, settings-transition, steam-*, team-career, wildcard-board, records-board, the two i18n files); batch 2: 30 files (f1-hud, hud-identity, presentation, race-day, season-board, marshal*, input, controller-buttons, pit service, GP cues, meeting/offroad, vehicle-catalogue*, ...); plus wildcard-series and wildcard-career-flow | batch 1 505 tests, batch 2 387 tests, all passed |
| English markup identical | `e2e/63-i18n-layout.spec.ts` "English markup is unchanged": loading, paddock, HUD, first launch, results, settings, career season board, Wildcard board (29 events), pause | **byte-identical** to `e2e/fixtures/i18n-en/*.html`, captured before the wiring (the LANGUAGE dials are `data-i18n-ui` and are excluded; path geometry is hashed) |
| Layout in every language | `e2e/63-i18n-layout.spec.ts` "every language fits" | 8 languages x 7 screens x {1280x720, 1024x600}: no horizontal overflow, nothing outside the viewport, no clipped or ellipsized text that English does not already ellipsize |
| Existing DOM e2e | `e2e/59-career-hub`, `61-first-run`, `62-results-settings`, `60-launch-board` (DOM config), final tree | 59, 61, 62: 6 of 6 pass; 60: 11 pass, **2 fail with the same numbers on `main` 3aa69f2** (checked in a throwaway worktree, since removed): `board fits 1280x720 without scrolling` and the LIGHT dial test both read menu body 648 px > 609 px in this sandbox, before and after this change |
| Build | `npm run build` (tsc + vite build, 23.6 s) | exit 0; IP guard inside the build: clean (75 shipped text files scanned) |
| Bundle budget (G7) + IP guard | `npm run check:bundle` | initial JS **10.89 MB raw, 3.49 MB gzip** (budget 4 MB: 0.51 MB headroom); the seven dictionaries are **lazy chunks of 72-77 KB raw / 27-29 KB gzip each**; `physics.worker` unchanged in kind; IP guard clean. Main was not rebuilt here, so there is no before/after number for the initial chunk: the English strings stay in the code and the core is small (size of the delta not measured) |

**The IP guard caught the first build.** The release guard scans every shipped chunk with the real-brand
denylist; it rejected 15 ordinary words in the new dictionaries (listed in section 5). They were
reworded and `i18n-check.ts` now runs the same matcher over every translation, so the next change fails
at the desk, not in the build. The guard itself was not touched.

**Source-text contract updated, with the reason:** `tests/frontend-menus.test.ts` asserted that the
source of `interface.ts` starts the paddock list with the literal `CAREER</button>`; the label now goes
through `th('CAREER')`, so the assertion matches that. Nothing was weakened or skipped.

## 8. Layout safety

`e2e/63-i18n-layout.spec.ts` mounts the production `Interface`, the real style sheets and the shipped
Saira faces (embedded as data URLs, so widths are the real ones) for paddock, first launch, results,
settings, career season board, Wildcard board and the pause menu, in each language at 1280x720 and
1024x600. For every element it reports: text clipped by its own box (an ellipsis counts), a primary
control cut vertically, text leaving the overflow box that should hold it, any control outside the
viewport, and page/dialog/paddock-body horizontal scroll. Anything English already ellipsizes (the
long venue names on a Wildcard row: proper names, not translated) is allowed in every language.

Found and fixed (CSS only, no translation was shortened):
1. **Paddock rail** (`front-end.css`): the ten index buttons were `nowrap` with an ellipsis, so even
   English "GARAGE & SETTINGS" was cut at 1280 wide and the German, French, Spanish, Portuguese,
   Italian, Polish and Turkish labels were cut too.
   They now wrap to a second line (`white-space: normal; overflow-wrap: anywhere; text-wrap: balance`)
   with the one-line height unchanged (34 / 30 px).
2. **Wildcard event titles** (`wildcard-board.css`): translated titles (up to ~60 characters) were cut
   with an ellipsis on the list rows; they now wrap (`text-wrap: balance`).

Contact sheets of English and the two languages with the most text on these screens (measured:
Spanish and Polish) are in `docs/studio/reports/localization-screens/` (163-171 KB each); the text
length of all eight is in `text-length.json` (the eight are within 2% of each other on these
screens). Not covered by this check: the live race HUD (the DOM fixture has no session), the vehicle
setup page and the results share-card canvas. HUD labels were kept short on purpose (`KM/H`, `U/MIN`,
`BRM`).

## 9. Fonts shipped, and what the seven languages need

`@fontsource-variable/saira` (`wdth.css`, `wdth-italic.css`) ships three subsets: **latin**
(U+0000-00FF, U+0131, U+2000-206F, euro, ...), **latin-ext** (U+0100-02BA, U+1E00-1EFF, ...) and
**vietnamese**, normal 99 + 67 + 27 KB and italic 116 + 77 + 30 KB woff2. Saira Stencil One ships
only **latin** (21 KB, `src/ui/fonts/`). Consequences:

- German, French, Spanish, Portuguese and Italian letters are all in *latin*. Polish `ą ć ę ł ń ś ź ż`
  and Turkish `ğ ş İ` are in *latin-ext* (`ı` is in *latin*). Nothing needs a new file.
- Stencil One has no latin-ext, so a Polish or Turkish headline set in the stencil face falls back to
  Saira Variable for those letters only (the font stack already lists it). Visible only in the stencil
  numerals/headlines; check it on the Polish contact sheet.
- `i18n-check.ts` enforces this: a letter outside Latin script or outside these ranges is an error.
  It found one real defect in the drafts: a Cyrillic look-alike `у` typed into a Polish word (in the
  dictionary and in the store text), fixed.

## 10. Plan: Russian, Chinese, Japanese, Korean (no font added in this change)

None of Saira's shipped subsets contains Cyrillic, Han, kana or Hangul, so these four languages would
render in the system fallback. Do not ship them like that; the plan:

**Russian (Cyrillic).** Add a Cyrillic-capable face under SIL OFL 1.1 and list it after Saira in
`--mb-sans` and the canvas font strings. Candidates with a sporty, condensed-friendly look: *Exo 2*,
*Oswald*, *Russo One* (display only); pick by rendering `docs/studio/reports/localization-screens`.
Use only the `cyrillic` (and `cyrillic-ext` if needed) woff2 subsets with `unicode-range`, so the file
loads only when Russian is active. Estimated 20-40 KB per face and style (**estimate; measure when
chosen**). Russian plurals need `one / few / many / other`: the core already supports them.

**Chinese (Simplified, later Traditional), Japanese, Korean.** Use Noto Sans SC / JP / KR (SIL OFL
1.1). Full CJK faces are many megabytes, so subset at build time from the text that is actually used:
`pyftsubset` (fonttools) with `--text-file` built by a new `scripts/i18n-fontset.ts` from every
codepoint in that language's dictionary, plus digits, punctuation and a safety set (about 3,500
common hanzi for SC, jōyō + kana for JP, the 2,350 KS X 1001 syllables for KR) so a late string does
not turn into tofu; output woff2, weights 400 and 700 only. **Estimate**: roughly 150-400 KB per
language and weight for a safety-set subset, a few tens of KB for the used set alone (measure first).
Desktop (Electron) loads from disk, so one file per language is fine; a web build should slice by
`unicode-range` instead (many small files, cache friendly).

**Budget against G7 (initial JS <= 4 MB gzip).** Fonts are not JavaScript, so they do not count toward
G7 at all; they count toward install and download size (the 166 MiB install, `STORE_PAGE.md`). The
four dictionaries would be lazy chunks like today's seven (each about 60-130 KB raw; section 7 has the
measured size of the current ones), so the initial JavaScript does not move. What does move the
initial chunk is code: the extra locale entries, the per-language `:lang()` CSS and the font-loading
hook, a few KB; the headroom is the gap between the measured initial size in section 7 and 4 MB.

**Licences.** Saira, Saira Stencil One and Noto are OFL 1.1. OFL permits bundling and subsetting
(a subset is a modified version) but requires the copyright notice and licence text to ship with the
font, forbids selling the font on its own, and forbids using a **Reserved Font Name** for a modified
version: read each font's `OFL.txt` header and rename the subset if it declares one. Add each face to
`THIRD_PARTY_NOTICES.txt` (`npm run notices`) and the in-game Credits screen. No font was added here, so
no notice changed.

**Engineering the four languages also need.** CSS: `letter-spacing` of 0.08-0.2em on the capitals
labels must be 0 for CJK and Cyrillic is wider (re-run the layout spec); `text-transform: uppercase`
means nothing for CJK; line breaking (`line-break: strict`, `word-break: keep-all` for Korean) and a
larger base size and line-height for Han/Hangul legibility; a `:lang(zh)` font stack. Canvas text (the
share card, minimap, festival HUD) must `await document.fonts.load('600 15px "<face>"', sample)`
before it draws. Name entry needs IME composition. The gate's glyph ranges become per-language, and a
coverage step (`pyftsubset` report or an `opentype.js` walk) must prove every dictionary codepoint is
in the shipped subset. Steam store pages exist for all four; the same model-written-draft rule applies.

## 11. Store page drafts

`docs/studio/store/localized/{de,fr,es,pt-BR,it,pl,tr}.md`: short description (267-297 characters,
under Steam's 300; measured), long description, the six feature bullets and review notes, derived from
`STORE_PAGE.md`. Same rules as the source: no sales or quality claims, the **[after G#]** markers and
the Steam/achievement caveat kept, no real brand names, numbers copied from the English page (47
layouts, 57 machines, 54 achievements: re-check them at publication). `STORE_PAGE.md`'s "Languages
other than English" line now points here and still says: do not list a language in Steamworks until a
native has reviewed both the page and the in-game dictionary.

## 12. Known gaps and unverified

- Not run: a real game boot in a non-English language (the DOM fixtures build the real `Interface`; the
  full application boot with `await startupLocale` and the restart flow were typechecked and unit
  tested for their pure parts only), the live HUD in another language, the desktop shell, Steam.
- The language restart on first launch and from Settings has no e2e (needs the full app; the e2e
  regression sweep on the other branch owns the browser time).
- Coverage gaps in section 3. Circuit blurbs (51) and the career pages beyond the season board are the
  largest remaining blocks.
- `fixed()` was applied to the strings on the wired surfaces; other `toFixed` calls in the secondary
  HUDs still print a decimal point in every language.
- The reload on language change loses nothing at the paddock, but a change made from a paused session
  waits for the next start (a toast says so).

## 13. Recommended next tasks (ranked)

1. **Native review of the seven dictionaries and store drafts** (section 6): nothing ships before it.
2. Boot the full game in each language (software GL is enough for the menus) and capture the live HUD,
   pause menu and results; add a first-launch language-change e2e to the sweep.
3. Wire the remaining first-hour-adjacent screens: Driving Academy, Records, Credits, event cards,
   the licence test briefings, the vehicle setup page, replay and photo studio chrome.
4. The 51 circuit blurbs and the career pages' bodies (about 70 + 100 strings; keep machine and venue
   names untouched).
5. Export the achievement names to the Steamworks localization sheet from the dictionary keys.
6. Decide on Russian and the CJK languages with the plan in section 10 (needs the font choice, the
   subsetting script and the layout pass; no engineering unknowns in the core).
7. Switch the secondary HUDs to `fixed()` and add the live HUD to the layout spec through a recorded
   frame.
