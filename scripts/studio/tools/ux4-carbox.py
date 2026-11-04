"""Where the showroom machine sits in a clean menu frame (menu chrome hidden), as fractions of the width.

usage: ux4-carbox.py CLEAN.jpg FREE_LEFT_PX FREE_RIGHT_PX
The scene behind the car is a studio floor and backdrop that vary mostly with the row, so each row's
background is the median of the columns outside the free strip's neighbourhood (the outer 15 percent on
each side) and the car is every pixel more than 38 levels away from it (Euclidean RGB). Prints the car's
left and right edge, its centre, and the offset of that centre from the middle of the free strip.
"""
import sys
import numpy as np
from PIL import Image

path, free_left, free_right = sys.argv[1], int(sys.argv[2]), int(sys.argv[3])
im = np.asarray(Image.open(path).convert("RGB")).astype(float)
h, w, _ = im.shape
outer = np.r_[0 : int(w * 0.15), int(w * 0.85) : w]
background = np.median(im[:, outer, :], axis=1)  # one colour per row
diff = np.linalg.norm(im - background[:, None, :], axis=2)
mask = diff > 38
# Only the middle band of rows, where the machine stands (the floor ring and the vignette are outside it).
band = np.zeros_like(mask)
band[int(h * 0.25) : int(h * 0.80), :] = True
mask &= band
cols = np.where(mask.sum(axis=0) >= 3)[0]
cols = cols[(cols > free_left - 80) & (cols < free_right + 80)]
left, right = int(cols.min()), int(cols.max())
centre = (left + right) / 2
mid = (free_left + free_right) / 2
print(
    f"car {left}..{right} px ({left / w:.3f}..{right / w:.3f}), width {right - left} "
    f"of strip {free_right - free_left}; centre {centre:.0f} vs strip middle {mid:.0f} "
    f"(offset {centre - mid:+.0f} px, {100 * (centre - mid) / w:+.1f}% of the width)"
)
