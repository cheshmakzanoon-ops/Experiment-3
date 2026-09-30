"""Tile captured gameplay frames into one labelled, size-bounded JPEG.

Usage: python3 scripts/contact-sheet.py OUT.jpg COLUMNS WIDTH IMAGE[=LABEL] ...
Frames are resized, never retouched; labels are drawn in a bar below each tile.
"""
import sys
from PIL import Image, ImageDraw

out, columns, width = sys.argv[1], int(sys.argv[2]), int(sys.argv[3])
items = []
for arg in sys.argv[4:]:
    path, _, label = arg.partition('=')
    items.append((path, label or path.rsplit('/', 1)[-1]))
tiles = []
for path, label in items:
    image = Image.open(path).convert('RGB')
    height = round(image.height * width / image.width)
    tiles.append((image.resize((width, height), Image.LANCZOS), label))
bar = 18
tile_h = max(t.height for t, _ in tiles) + bar
rows = (len(tiles) + columns - 1) // columns
sheet = Image.new('RGB', (columns * width, rows * tile_h), (12, 14, 16))
draw = ImageDraw.Draw(sheet)
for i, (tile, label) in enumerate(tiles):
    x, y = (i % columns) * width, (i // columns) * tile_h
    sheet.paste(tile, (x, y))
    draw.text((x + 6, y + tile.height + 3), label, fill=(225, 228, 230))
sheet.save(out, quality=82, optimize=True)
print(out, sheet.size)
