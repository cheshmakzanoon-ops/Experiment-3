import sys
from PIL import Image
# usage: crop.py src out x0 y0 x1 y1 (fractions 0..1) scale
src,out=sys.argv[1],sys.argv[2]
x0,y0,x1,y1=[float(v) for v in sys.argv[3:7]]
scale=float(sys.argv[7]) if len(sys.argv)>7 else 2
im=Image.open(src).convert('RGB')
W,H=im.size
c=im.crop((int(x0*W),int(y0*H),int(x1*W),int(y1*H)))
c=c.resize((int(c.width*scale),int(c.height*scale)),Image.LANCZOS)
c.save(out)
print(W,H,c.size)
