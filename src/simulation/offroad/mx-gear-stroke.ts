import { smooth } from '../../core/math.ts';

/** The return spring recentres the steel selector after every shift. The
 * left boot normally rides below the sleeve. For a downshift it clears the
 * outside end, covers the sleeve, presses it, then returns below the tip.
 * All values are sampled on the fixed simulation clock. */
export class MxGearStroke {
  angle = 0;
  cover = 0;
  clear = 0;
  private start = -Infinity;
  private direction = 0;
  private startAngle = 0;
  private startCover = 0;
  private startClear = 0;

  reset() {
    this.start = -Infinity;
    this.direction = this.angle = this.cover = this.clear = 0;
  }

  engage(direction: number, clock: number) {
    this.sample(clock);
    this.startAngle = this.angle;
    this.startCover = this.cover;
    this.startClear = this.clear;
    this.start = clock;
    this.direction = direction;
  }

  sample(clock: number) {
    const time = clock - this.start;
    if (time >= .26 || !this.direction) {
      this.angle = this.cover = this.clear = 0;
      return this;
    }
    // A second command can arrive before the boot settles. Start the stroke
    // from its measured position without changing the gear input cadence.
    const carry = 1 - smooth(0, .045, time);
    this.angle = this.startAngle * carry;
    this.cover = this.startCover * carry;
    this.clear = this.startClear * carry;
    if (this.direction > 0) {
      this.angle -= .24 * (smooth(0, .045, time) - smooth(.052, .140, time));
    } else {
      this.angle += .22 * (smooth(.078, .115, time) - smooth(.125, .175, time));
      const cover = smooth(.022, .059, time) - smooth(.203, .237, time);
      const clear = smooth(0, .030, time) - smooth(.055, .080, time)
        + smooth(.167, .194, time) - smooth(.230, .260, time);
      this.cover += (1 - this.cover) * cover;
      this.clear += (1 - this.clear) * clear;
    }
    return this;
  }
}
