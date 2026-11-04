# Capsule and store art brief

Sizes are the values Valve documents in the Steamworks "Store graphical assets" page as the
release engineer knows them; **re-check that page before upload** (it has changed before). All
store images need a legible title at the smallest size they are shown at, no review quotes or
awards on the main capsule, and no content that is not in the game.

## Status (marketing pass)

The art in this brief now exists as files: [`art/`](art/) (built by `scripts/studio/tools/capsule-art.mjs` from real game
frames and the original vector brand), with the identity in [`BRAND.md`](BRAND.md) and the slot-by-slot upload list in
[`ART_UPLOAD_CHECKLIST.md`](ART_UPLOAD_CHECKLIST.md). Two corrections to this brief:

* **The size table is the 2x set.** Header 920x430, small 462x174, main 1232x706 and vertical 748x896 are exactly twice
  the 1x sizes Steam also names (460x215, 231x87, 616x353, 374x448). The tool writes both, so legibility can be checked at
  the size a 1x screen shows.
* **The visual-language table below is superseded.** It predates the Paddock Board sign-off (gate G5): the identity is now
  chalk `#f1ecdf` and amber `#ffb21a` on asphalt `#121315` with paper `#e8dfc8` strips, set in Saira / Saira Stencil One
  (`ART_DIRECTION.md` section 3). Vermilion `#ed6947` is not used.
* The Wildcard series shipped, so the header's "mismatched pairing" is a real Wildcard event frame (motocross bike on the
  banked speed bowl), not a mock-up. All game frames are still software-GL captures: retake on a GPU before launch (G8).

## Required and recommended assets

| Asset | Size (px) | Format | Where it appears | Notes |
| --- | --- | --- | --- | --- |
| Header capsule | 920 x 430 | PNG/JPG | Store page top, wishlist, search | The one most people see. Logo must read at 460 px wide. |
| Small capsule | 462 x 174 | PNG/JPG | Search results, "more like this", bundles | Logo only plus one clean subject; no fine detail. |
| Main capsule | 1232 x 706 | PNG/JPG | Store front featured slot | Needed for featured placements (Next Fest, sales). |
| Vertical capsule | 748 x 896 | PNG/JPG | Store front, sale pages | Portrait composition, not a crop of the header. |
| Page background | 1438 x 810 | PNG/JPG | Behind the store page | Dark, low contrast, so text stays legible; subject on the right third. |
| Library capsule | 600 x 900 | PNG/JPG | Steam library grid | Portrait; logo in the lower third. |
| Library header | 920 x 430 | PNG/JPG | Library "recent games" | Can reuse the header capsule art. |
| Library hero | 3840 x 1240 | PNG/JPG | Top of the library game page | No text or logo (the logo is layered separately). Keep the subject centre-left; the logo sits lower left. |
| Library logo | up to 1280 x 720, transparent | PNG | Over the hero | Single-colour-safe silhouette; reads on both dark and light art. |
| Community icon | 184 x 184 | JPG | Community hub | Game mark, no wordmark. |
| Client/store icon | 256 x 256 source, ICO/ICNS from `desktop/build/icon.png` | PNG | Taskbar, desktop, Steam client list | `desktop/build/icon.png` is a **placeholder** (the legacy "A" glyph). |
| Screenshots | 1920 x 1080 minimum, 16:9 | PNG/JPG | Store gallery | At least 5 required; plan 12. Captured from the game, no composite UI. |
| Trailer | 1920 x 1080, 16:9, H.264 | MP4 | Store page autoplay | See `TRAILER_STORYBOARD.md`. |
| Achievement icons | 256 x 256, two per achievement (unlocked colour, locked grey) | JPG/PNG | Steam overlay, profile | 54 achievements in `ACHIEVEMENTS.md`; plan 9 category templates reused with an icon glyph per achievement. |
| Event/announcement art | 800 x 450 (small) and wide hero | PNG/JPG | News and event posts | Re-use shots; do not add unreleased features. |

## The project's visual language (use it, do not invent a new one)

Taken from `src/ui/style.css` and the in-game front end:

| Element | Value |
| --- | --- |
| Ground / background | Deep charcoal-teal `#11191c`; panels `#172024`; hairlines `#3c4749` |
| Text | Warm paper `#f1ebdf`; muted `#a6b1b1` |
| Accent | Vermilion `#ed6947` (one accent only, used for the active thing: the logo mark, a lap time, a CTA) |
| Focus / highlight | Soft peach `#f6b290` |
| Type | Uppercase, wide letter-spacing, bold, small labels over large calm headings; Saira Variable (the game's display and data font) is the brand face. Never mix in a second display font. |
| Layout | Calm panels on a dark field, thin rules, eyebrow labels such as `GARAGE / PREFERENCES`; generous margins |

Note the UX/UI department is reworking the front end (gate G5). Capsule art must follow whatever
identity is signed off there; the values above are today's, so re-check them before the final
art pass.

## Composition direction

The pitch is *breadth and the unexpected pairing*, so the key art must show a **contrast**, not a
generic car on a track.

1. **Header (920 x 430), the primary piece.** A single dramatic subject in the right 60%: the
   mismatched pairing the Wildcard series promises (a GT car mid-air off a motocross-style
   hillside jump, or a superbike on a gravel stage), low sun, vermilion rim light on the
   vehicle's edges, dust and spray as the only motion. The logo sits in the left 40% on a
   charcoal gradient, vertically centred, with the tagline underneath in small caps:
   `RACE THE WRONG MACHINE`. (Use the real game shot; art-direct the camera in photo mode.)
2. **Small capsule (462 x 174).** Only the logo and the silhouette of one vehicle cropped hard from
   the header; at this size nothing else survives.
3. **Main capsule (1232 x 706).** The header composition, taller: add a second layer of the
   four disciplines as four slim vertical bands along the bottom (formula car, GP bike, dirt
   bike, festival roadster) in their own lighting, separated by hairlines, each a real capture.
4. **Vertical capsule / library capsule (portrait).** Stack: logo top; a tall hero vehicle centre
   (a motocross bike at the lip of a jump is the strongest vertical subject); band of the other
   three disciplines at the base. Keep the lower third quiet in the library version so the
   Steam play button never covers the art.
5. **Library hero (3840 x 1240).** A wide, quiet panorama with no text: the Solvane Coast road at
   golden hour, the supercar small in frame, vast sky. Left third dark for the logo overlay.
6. **Page background.** The hero blurred and darkened to roughly 15% luminance; no focal point
   beneath the page text.
7. **Screenshots (12).** One per discipline (4), weather (rain, dry-to-rain, night) (3), festival
   (drift zone, jump, coast road) (3), photo mode and results/livery (2). Lead with the most
   readable HUD shot, not the prettiest, because the first screenshot is judged as gameplay.

## Do / do not

- Do capture with the packaged desktop build on a real GPU (the repository's own captures are
  software-rendered and must not be used).
- Do keep the vermilion to one element per image; the rest of the palette stays desaturated.
- Do not use a licensed livery, logo, number set or circuit signage; the game has none and the
  art must not add one.
- Do not show UI that is not shipped (menus are still changing).
- Do not use AI-generated imagery on the store page unless the producer has recorded the
  disclosure decision (Steam asks about it; see `LEGAL_CHECKLIST.md`).
- Do not put "free", "sale", prices, review quotes, or the Steam logo on the capsule.

## Delivery

One folder per asset type under `docs/studio/store/art/` (to be created by the art department),
source layered files kept outside the repository (large), exported PNGs named
`header-920x430.png`, `capsule-small-462x174.png`, and so on, plus a text file with the capture
build id, GPU and the photo-mode seeds used so a shot can be reproduced.
