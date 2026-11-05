import sys
from PIL import Image, ImageChops
# compare.py out.png a.png b.png [crop x0 y0 x1 y1] [scale]
out, a, b = sys.argv[1:4]
A = Image.open(a).convert('RGB'); B = Image.open(b).convert('RGB')
if len(sys.argv) >= 8:
    box = tuple(int(v) for v in sys.argv[4:8]); A = A.crop(box); B = B.crop(box)
scale = float(sys.argv[8]) if len(sys.argv) >= 9 else 1.0
w, h = A.size
o = Image.new('RGB', (w * 2 + 6, h), (255, 255, 255)); o.paste(A, (0, 0)); o.paste(B, (w + 6, 0))
if scale != 1.0: o = o.resize((int(o.width * scale), int(o.height * scale)), Image.LANCZOS)
o.save(out)
d = ImageChops.difference(A, B).convert('L')
print('mean abs diff', sum(d.getdata()) / (w * h))
