import sys
from PIL import Image
# usage: px.py src fx,fy [fx,fy ...]  -> hex colour (3x3 median-ish avg)
im=Image.open(sys.argv[1]).convert('RGB'); W,H=im.size
for p in sys.argv[2:]:
    fx,fy=[float(v) for v in p.split(',')]
    x,y=int(fx*W),int(fy*H)
    rs=[im.getpixel((min(W-1,max(0,x+dx)),min(H-1,max(0,y+dy)))) for dx in (-1,0,1) for dy in (-1,0,1)]
    r=sum(c[0] for c in rs)//9; g=sum(c[1] for c in rs)//9; b=sum(c[2] for c in rs)//9
    print(p, '#%02x%02x%02x'%(r,g,b))
