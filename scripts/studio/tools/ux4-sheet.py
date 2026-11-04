"""Contact sheets of screen captures, labelled, JPEG.

usage: ux4-sheet.py OUT.jpg [--cols 2] [--tile 960] IMG.jpg [IMG.jpg ...]
Each tile is scaled to --tile px wide (aspect kept) and labelled with the file name stem, so a sheet of
the same screen at four viewports or four screens at one viewport reads at a glance.
"""
import sys
from PIL import Image, ImageDraw

args = sys.argv[1:]
out = args.pop(0)
cols, tile = 2, 960
files = []
while args:
    a = args.pop(0)
    if a == "--cols":
        cols = int(args.pop(0))
    elif a == "--tile":
        tile = int(args.pop(0))
    else:
        files.append(a)
tiles = []
for f in files:
    im = Image.open(f).convert("RGB")
    h = int(im.height * tile / im.width)
    im = im.resize((tile, h), Image.LANCZOS)
    d = ImageDraw.Draw(im)
    label = f.rsplit("/", 1)[-1].rsplit(".", 1)[0]
    d.rectangle((0, 0, 7 * len(label) + 10, 16), fill=(0, 0, 0))
    d.text((4, 2), label, fill=(255, 220, 80))
    tiles.append(im)
rows = (len(tiles) + cols - 1) // cols
row_h = [max(t.height for t in tiles[r * cols : (r + 1) * cols]) for r in range(rows)]
sheet = Image.new("RGB", (cols * tile, sum(row_h)), (24, 24, 24))
y = 0
for r in range(rows):
    for c, t in enumerate(tiles[r * cols : (r + 1) * cols]):
        sheet.paste(t, (c * tile, y))
    y += row_h[r]
sheet.save(out, quality=82)
print(out, sheet.size)
