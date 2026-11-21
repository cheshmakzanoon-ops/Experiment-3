import { Vector3 } from 'three';
import { renderWind } from '../../simulation/weather.ts';

/** Unit world X/Z direction and a bounded pressure response shared by fabric
 * and planted foliage. No accumulated phase, so a replay seek restores both. */
export class MxVenueWind {
  readonly value = new Vector3(0.89, 0.456, 0.55);
  set(x: number, z: number) {
    x = renderWind(x);
    z = renderWind(z);
    const speed = Math.hypot(x, z);
    if (speed < 0.001) this.value.set(0, 0, 0);
    else this.value.set(x / speed, z / speed, 1 - Math.exp(-speed / 5));
  }
}
