"""Contact sheet of vehicle-shots captures: crops the showroom car region and tiles it with labels.

usage: vehicle-sheet.py OUT.jpg SHOT.jpg [SHOT.jpg ...] [--cols 2] [--crop x0,y0,x1,y1] [--width 640]
Default crop (320,170)-(1130,570) of a 1280x720 shot: where the showroom camera frames cars.
"""
import sys
from PIL import Image, ImageDraw

args = sys.argv[1:]
out = args.pop(0)
cols, width, crop = 2, 640, (320, 170, 1130, 570)
files = []
while args:
    a = args.pop(0)
    if a == "--cols":
        cols = int(args.pop(0))
    elif a == "--width":
        width = int(args.pop(0))
    elif a == "--crop":
        crop = tuple(int(v) for v in args.pop(0).split(","))
    else:
        files.append(a)
tiles = []
for f in files:
    im = Image.open(f).convert("RGB").crop(crop)
    h = int(im.height * width / im.width)
    im = im.resize((width, h), Image.LANCZOS)
    d = ImageDraw.Draw(im)
    label = f.rsplit("/", 1)[-1].replace(".jpg", "")
    d.rectangle((0, 0, 8 * len(label) + 10, 16), fill=(0, 0, 0))
    d.text((4, 2), label, fill=(255, 255, 0))
    tiles.append(im)
rows = (len(tiles) + cols - 1) // cols
th = tiles[0].height
sheet = Image.new("RGB", (cols * width, rows * th))
for i, t in enumerate(tiles):
    sheet.paste(t, ((i % cols) * width, (i // cols) * th))
sheet.save(out, quality=85)
print(out, sheet.size)
