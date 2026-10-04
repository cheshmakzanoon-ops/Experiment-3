import * as T from 'three';
import { Track, trackPoint } from '../simulation/track.ts';
import type { TrackDetailSite } from './track-infrastructure.ts';
import { grassApronOffset } from './ground-profile.ts';
import manifest from './broadcast-cameras.manifest.json' with { type: 'json' };
export function cameraHardwareHeight(site: TrackDetailSite) {
  return Math.max(1.2, (site.cameraY ?? site.y + 3) - site.y);
}
export function cameraHardwareMatrix(site: TrackDetailSite) {
  return new T.Matrix4()
    .makeRotationY(site.yaw + (site.side > 0 ? Math.PI / 2 : -Math.PI / 2))
    .setPosition(site.x, site.y + cameraHardwareHeight(site), site.z);
}
export function cameraTowerMatrix(site: TrackDetailSite) {
  return new T.Matrix4()
    .makeRotationY(site.yaw)
    .scale(new T.Vector3(site.side, 1, 1))
    .setPosition(site.x, site.y, site.z);
}
export function conformCameraHead(template: T.BufferGeometry, site: TrackDetailSite) {
  const g = template.clone().applyMatrix4(cameraHardwareMatrix(site));
  g.computeBoundingBox();
  g.computeBoundingSphere();
  return g;
}
export function conformCameraTower(
  template: T.BufferGeometry,
  track: Track,
  site: TrackDetailSite,
  canonicalHeight: number,
) {
  const g = template.clone(),
    p = g.getAttribute('position'),
    source = template.getAttribute('position'),
    delta = cameraHardwareHeight(site) - canonicalHeight;
  const lo = manifest.heightFixedBelow,
    hi = canonicalHeight - manifest.deckBelowOptical - manifest.heightTranslateFromDeckBelow;
  for (let i = 0; i < p.count; i++)
    p.setY(i, p.getY(i) + delta * Math.max(0, Math.min(1, (p.getY(i) - lo) / (hi - lo))));
  g.applyMatrix4(cameraTowerMatrix(site));
  for (let i = 0; i < p.count; i++)
    if (source.getY(i) < 0) {
      const q = trackPoint(),
        l = track.nearest(p.getX(i), p.getZ(i), q),
        ground = q.y + q.bank * Math.max(-12, Math.min(12, l)) + grassApronOffset(track, q.s, l);
      p.setY(i, Math.min(p.getY(i), ground - 0.025));
    }
  if (site.side < 0) {
    const idx = g.index!;
    for (let i = 0; i < idx.count; i += 3) {
      const a = idx.getX(i);
      idx.setX(i, idx.getX(i + 2));
      idx.setX(i + 2, a);
    }
  }
  g.computeVertexNormals();
  g.computeBoundingBox();
  g.computeBoundingSphere();
  return g;
}
