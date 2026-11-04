# Steam store art

Generated files. Do not edit by hand: change the layout in `scripts/studio/tools/capsule-art.mjs` or the frames/brand and rebuild.

| Folder | Contents |
| --- | --- |
| `capsule/` | header, small, main and vertical capsules at the 2x sizes Steam takes (920x430, 462x174, 1232x706, 748x896) and the 1x legibility checks (460x215, 231x87, 616x353) |
| `library/` | library capsule 600x900, library header 920x430, library hero 3840x1240 (no text), library logo 1280x720 (transparent PNG, plus a one-colour version) |
| `page/` | page background 1438x810 |
| `icons/` | community icon 184x184 JPG, client icon 256x256, master 1024x1024, `icon.ico` (16-256 px) |
| `event/` | news and event banner 800x450 |
| `frames/` | the source game frames (`art-frames.mjs`) with `manifest.json` (entry, camera, build, note) |
| `manifest.json` | every output: size, format, SHA-256, Steam slot, safe-area rule, source frames, alt text |
| `contact-sheet.png` | all of it on one page, with the 1x legibility row at true pixels |

```
node scripts/studio/tools/capsule-art.mjs            # rebuild everything from frames/ and ../brand/
node scripts/studio/tools/capsule-art.mjs --verify   # re-read the files on disk: sizes, formats, alpha, IP text check
node scripts/studio/tools/art-frames.mjs --list      # the frame table and what is captured
```

The frames are software-GL captures of the real game (SwiftShader), the brand is hand-drawn SVG
([`../BRAND.md`](../BRAND.md)); no stock art, no real marks. Which file goes into which Steamworks slot:
[`../ART_UPLOAD_CHECKLIST.md`](../ART_UPLOAD_CHECKLIST.md).
