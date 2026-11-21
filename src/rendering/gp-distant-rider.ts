import * as T from 'three';
import { GP_HELMET_CENTRE, GP_VISOR_PHI, gpVisorBounds } from './gp-rider-helmet.ts';
import type { RiderColours } from './rider.ts';

/** Preserve the broad fields of the near helmet and suit after their print
 * atlases are dropped. Each triangle has one paint colour and the shell's
 * original smooth normals. No second visor surface or extra draw is needed. */
export function paintDistantGpRider(
  source: T.BufferGeometry,
  colours: RiderColours,
  helmet: boolean,
  prototype = true,
) {
  const geometry = source.toNonIndexed();
  source.dispose();
  const pos = geometry.getAttribute('position'),
    uv = geometry.getAttribute('uv');
  const paint = new Float32Array(pos.count * 3);
  const primary = new T.Color(colours.primary),
    dark = new T.Color(colours.secondary);
  const pale = new T.Color(helmet ? 0xeceeed : 0xd9ddd6);
  const visor = new T.Color(0x101e28),
    rim = new T.Color(0x24282c);
  for (let i = 0; i < pos.count; i += 3) {
    const u = (uv.getX(i) + uv.getX(i + 1) + uv.getX(i + 2)) / 3;
    const y = (pos.getY(i) + pos.getY(i + 1) + pos.getY(i + 2)) / 3;
    const phi = u * Math.PI * 2;
    let colour = primary;
    if (helmet) {
      const h = y - GP_HELMET_CENTRE[1],
        eye = gpVisorBounds(phi);
      const forward = Math.sin(phi);
      // The shell places two complete rings on the shaped visor edges.
      if (phi > GP_VISOR_PHI[0] && phi < GP_VISOR_PHI[1] && h > eye[0] && h < eye[1])
        colour = visor;
      else if (h < -0.09) colour = rim;
      else if (forward < .6 && h > .010 - .042 * forward && h < .108) {
        const inlay = .065 + .026 * Math.max(0, forward);
        if (Math.abs(h - inlay) > .010) colour = pale;
      }
    } else {
      const flank = Math.abs(Math.cos(phi));
      if (!prototype) {
        if (y < .11 || flank > .955) colour = dark;
        else if (y > .435 && y < .506 && flank < .92) colour = pale;
      } else if (y < .115 - flank * .055 || flank > .95) colour = dark;
      else if (y > .29 && flank > .52 && flank < .90 && y > .57 - flank * .25) colour = pale;
    }
    for (let j = i; j < i + 3; j++) colour.toArray(paint, j * 3);
  }
  geometry.name = source.name;
  geometry.setAttribute('color', new T.BufferAttribute(paint, 3));
  return geometry;
}
