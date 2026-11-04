# Steamworks art upload checklist

Which file goes into which Steamworks slot. Everything lives in [`art/`](art/) and is produced by
`node scripts/studio/tools/capsule-art.mjs` from real game frames ([`art/frames/`](art/frames/),
[`screenshots/`](screenshots/)) and the original vector brand ([`brand/`](brand/), rules in
[`BRAND.md`](BRAND.md)). `art/manifest.json` records the size, SHA-256, safe-area rule and source frames of each file;
`node scripts/studio/tools/capsule-art.mjs --verify` re-reads them from disk.

**Before uploading anything:** (1) re-check Valve's "Store graphical assets" page in Steamworks: sizes and the
overlay rules have changed before, and this list is written from the producer's knowledge of that page, not from the
live page; (2) every game frame in these files is a **software-GL capture** (SwiftShader). Retake the hero frames on a
GPU first (gate G8): `node scripts/studio/tools/art-frames.mjs --url ... --force`, then rebuild. (3) The AI-content
disclosure Steam asks for (see `LEGAL_CHECKLIST.md`): no image here is AI-generated; every pixel is a game render
or hand-authored vector.

## Store page (Steamworks: App Admin > Store Presence > Graphical Assets)

| Steamworks slot | Size | File | Notes |
| --- | --- | --- | --- |
| Header Capsule | 920x430 | `art/capsule/header-920x430.png` | The one most people see. A 460x215 check of the same art: `header-460x215.png` (do not upload) |
| Small Capsule | 462x174 | `art/capsule/capsule-small-462x174.png` | Wordmark only; 231x87 check: `capsule-small-231x87.png` |
| Main Capsule | 1232x706 | `art/capsule/capsule-main-1232x706.png` | Four discipline bands; 616x353 check: `capsule-main-616x353.png` |
| Vertical Capsule | 748x896 | `art/capsule/capsule-vertical-748x896.png` | |
| Page Background | 1438x810 | `art/page/page-background-1438x810.jpg` | Optional; blurred, mean luminance about 15% |
| Screenshots (5 required, plan 12) | 1920x1080 | `screenshots/*.jpg` (10) and the unlabelled frames in `art/frames/` (see below) | Alt text per file in `screenshots/manifest.json` and `STORE_PAGE.md` |
| Trailer | 1920x1080 H.264 | **none yet** | `trailer/capsule-teaser-animatic.mp4` is an animatic from stills, **not** uploadable as the trailer. See `TRAILER_CAPTURE.md` |

## Library (Steamworks: Library Assets)

| Steamworks slot | Size | File | Notes |
| --- | --- | --- | --- |
| Library Capsule | 600x900 | `art/library/library-capsule-600x900.png` | Quiet lower third (logo on asphalt) |
| Library Header | 920x430 | `art/library/library-header-920x430.png` | Same art as the Header Capsule |
| Library Hero | 3840x1240 | `art/library/library-hero-3840x1240.jpg` | No text, no logo |
| Library Logo | 1280x720 transparent PNG | `art/library/library-logo-1280x720.png` | Position over the hero: bottom-left, size to taste. One-colour alternative: `library-logo-mono-white-1280x720.png` |

## Community and client icons

| Steamworks slot | Size | File | Notes |
| --- | --- | --- | --- |
| Community Icon | 184x184 JPG | `art/icons/community-icon-184x184.jpg` | Roundel only |
| Client Icon | 256x256 source (the slot's own size and format change; confirm on the page) | `art/icons/client-icon-256x256.png`, `art/icons/icon.ico` (16-256 px) | `icon.ico` is built with ImageMagick `convert` when it is present |
| Desktop shell icon | 256x256 | `art/icons/client-icon-256x256.png` | **Not wired yet.** `desktop/build/icon.png` is still the legacy "A" placeholder; replacing it is a Release Engineering change (copy the file, rebuild the packages). ICNS for macOS: `icon-1024x1024.png` through `iconutil` on a Mac |
| Master | 1024x1024 | `art/icons/icon-1024x1024.png` | Source for every size above |

## News, events and the press kit

| Use | Size | File |
| --- | --- | --- |
| Event / announcement art (small) | 800x450 | `art/event/event-banner-800x450.png` |
| Press kit logo | vector | `brand/motobound-lockup-*.svg`, `brand/motobound-roundel*.svg` |
| Press kit key art | any | `art/capsule/*` and `art/library/library-hero-3840x1240.jpg` |

Not made here (and not claimed): achievement icons (54, two states each; `ACHIEVEMENTS.md` plans 9 templates), a
wide event hero, localised capsules (the logo is language-neutral; the tagline is English only and would need a
translation pass per language: `localized/`).

## Screenshot slots: what is allowed

Steam wants gameplay captured from the game. The frames in `art/frames/` are the game's own renders (the photo studio
is the camera; no HUD, no composite). They are fair as store screenshots if the page also shows HUD shots first (the
first screenshot is judged as gameplay): lead with a HUD frame (`screenshots/` has the HUD-free ones; the trailer
keyframes `trailer/keyframes/t02-*`, `t04-*` are HUD frames if the capture run reached them). Capsule art is allowed to be
composed; screenshots are not.

## Final checks before pressing upload

1. `node scripts/studio/tools/capsule-art.mjs --verify` exits 0 (sizes, formats, alpha, IP text).
2. Each capsule viewed at its 1x size (`art/contact-sheet.png`, "legibility" row): logo readable, tagline readable on header and main.
3. No price, "free", "sale", review quote, award or Steam logo on any capsule (checked by reading the layouts).
4. The hero frames were retaken on a GPU and the manifest's `renderer` field no longer says software GL.
5. A second person looks at the page in the Steamworks preview at the real display sizes.
