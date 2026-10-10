import sys, colorsys
from PIL import Image, ImageStat
import numpy as np
def stats(p, crop=None):
    im = Image.open(p).convert('RGB')
    w,h = im.size
    if crop: im = im.crop((int(crop[0]*w),int(crop[1]*h),int(crop[2]*w),int(crop[3]*h)))
    a = np.asarray(im).astype(np.float32)/255.0
    lin = np.where(a<=0.04045, a/12.92, ((a+0.055)/1.055)**2.4)
    L = 0.2126*lin[...,0]+0.7152*lin[...,1]+0.0722*lin[...,2]
    Ls = 0.2126*a[...,0]+0.7152*a[...,1]+0.0722*a[...,2]
    mx = a.max(-1); mn = a.min(-1); sat = np.where(mx>0,(mx-mn)/np.maximum(mx,1e-5),0)
    # top 12% rows as sky sample
    sky = a[: max(1,int(a.shape[0]*0.12))].reshape(-1,3).mean(0)
    p5,p50,p95 = np.percentile(Ls,[5,50,95])
    return dict(meanL=Ls.mean(), p5=p5,p50=p50,p95=p95, rms=Ls.std(), sat=sat.mean(), dark=(Ls<0.06).mean(), bright=(Ls>0.92).mean(), sky='#%02x%02x%02x'%tuple(int(x*255) for x in sky))
for p in sys.argv[1:]:
    crop=(0.16,0.12,0.84,0.74) if 'baseline' in p else (0.0,0.0,1.0,1.0)
    s=stats(p,crop)
    print('%-28s meanL %.3f p5 %.3f p50 %.3f p95 %.3f rms %.3f sat %.3f dark %.3f bright %.3f topcol %s'%(p.split('/')[-1][:28],s['meanL'],s['p5'],s['p50'],s['p95'],s['rms'],s['sat'],s['dark'],s['bright'],s['sky']))
