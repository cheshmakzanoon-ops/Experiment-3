/** Heights refer to the same pelvis point that is recorded while the rider
 * slides, gets back to their feet and returns to the motorcycle. */
export const MX_RECOVERY = {
  slideHeight: 0.14,
  uprightHeight: 0.95,
  riseSeconds: 0.72,
  restSeconds: 1.2,
  strideLength: 1.8,
} as const;

/** Full walking/running stride while steadying a moving bike. */
export const MX_PUSH_STRIDE = 1.75;
