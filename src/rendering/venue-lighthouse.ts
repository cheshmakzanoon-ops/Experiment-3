import * as T from 'three';
import { Track, trackPoint } from '../simulation/track.ts';
import { terrainFor } from './terrain.ts';
import type { LandmarkSite, VenueLandmark } from './venue-landmark.ts';

/** Original Vellamar landmark: a tapered masonry lighthouse on the headland
 * beyond Turn 1, visible from the coast straight and the Belvedere descent.
 * Dimensions are generic coastal-lighthouse proportions, not a copied building. */
export const LIGHTHOUSE = Object.freeze({
  baseRadius: 4.2,
  topRadius: 2.7,
  towerHeight: 24,
  galleryRadius: 3.6,
  lanternRadius: 1.9,
  lanternHeight: 3.2,
  plinthRadius: 9,
});

/** Search the headland west of Turn 1 for a clear, dry, near-level site. */
export function lighthouseSite(track: Track): LandmarkSite {
  const terrain = terrainFor(track),
    near = trackPoint();
  const candidates: [number, number][] = [];
  for (const dx of [0, -20, 20, -40, 40, -60])
    for (const dz of [0, -15, 15, -30, 30]) candidates.push([-850 + dx, -470 + dz]);
  for (const [x, z] of candidates) {
    const l = track.nearest(x, z, near);
    const margin = Math.abs(l) - track.boundary(near.s, l < 0 ? -1 : 1);
    if (margin < 40) continue;
    let low = Infinity,
      high = -Infinity;
    for (let a = 0; a < 16; a++)
      for (const r of [0, LIGHTHOUSE.plinthRadius * 0.5, LIGHTHOUSE.plinthRadius]) {
        const h = terrain.height(
          x + Math.cos((a * Math.PI) / 8) * r,
          z + Math.sin((a * Math.PI) / 8) * r,
        );
        low = Math.min(low, h);
        high = Math.max(high, h);
      }
    if (terrain.seaLevel !== null && low < terrain.seaLevel + 1.5) continue;
    if (high - low > 4) continue;
    return {
      x,
      z,
      s: near.s,
      yaw: 0,
      deckY: high + 0.05,
      bottomY: low - 1.2,
      radius: LIGHTHOUSE.plinthRadius + 1,
      clearance: margin,
    };
  }
  throw new Error('No dry, clear headland site for the Vellamar lighthouse');
}

export function buildLighthouse(track: Track, site = lighthouseSite(track)): VenueLandmark {
  const structure = new T.Group();
  structure.name = 'Vellamar lighthouse / headland landmark';
  structure.position.set(site.x, site.deckY, site.z);
  const stone = new T.MeshStandardMaterial({ color: 0xd9d3c4, roughness: 0.86 });
  const band = new T.MeshStandardMaterial({ color: 0x8e2a22, roughness: 0.7 });
  const iron = new T.MeshStandardMaterial({ color: 0x23292b, metalness: 0.7, roughness: 0.42 });
  const glass = new T.MeshPhysicalMaterial({
    color: 0x9fb8c0,
    roughness: 0.08,
    metalness: 0,
    transmission: 0,
    transparent: true,
    opacity: 0.55,
  });
  const L = LIGHTHOUSE;
  // Plinth reaches below the lowest sampled ground so no edge floats.
  const plinthDepth = site.deckY - site.bottomY;
  const plinth = new T.Mesh(
    new T.CylinderGeometry(L.plinthRadius, L.plinthRadius + 0.6, plinthDepth + 0.6, 40),
    stone,
  );
  plinth.position.y = 0.3 - plinthDepth / 2;
  const tower = new T.Mesh(
    new T.CylinderGeometry(L.topRadius, L.baseRadius, L.towerHeight, 40, 6),
    stone,
  );
  tower.position.y = L.towerHeight / 2 + 0.6;
  const stripes: T.Mesh[] = [];
  for (const h of [0.3, 0.62]) {
    const y = h * L.towerHeight + 0.6,
      r = L.baseRadius + (L.topRadius - L.baseRadius) * h;
    const stripe = new T.Mesh(new T.CylinderGeometry(r - 0.2, r + 0.02, 2.4, 40), band);
    stripe.scale.setScalar(1.004);
    stripe.position.y = y;
    stripes.push(stripe);
  }
  const top = L.towerHeight + 0.6;
  const gallery = new T.Mesh(new T.CylinderGeometry(L.galleryRadius, L.galleryRadius, 0.35, 40), iron);
  gallery.position.y = top + 0.18;
  const rail = new T.Mesh(new T.TorusGeometry(L.galleryRadius - 0.05, 0.05, 6, 48), iron);
  rail.rotation.x = Math.PI / 2;
  rail.position.y = top + 1.25;
  const lanternGlass = new T.Mesh(
    new T.CylinderGeometry(L.lanternRadius, L.lanternRadius, L.lanternHeight, 24, 1, true),
    glass,
  );
  lanternGlass.position.y = top + 0.35 + L.lanternHeight / 2;
  const roof = new T.Mesh(new T.ConeGeometry(L.lanternRadius + 0.35, 1.8, 24), iron);
  roof.position.y = top + 0.35 + L.lanternHeight + 0.9;
  const door = new T.Mesh(new T.BoxGeometry(1.2, 2.3, 0.4), iron);
  door.position.set(0, 1.75, L.baseRadius - 0.1);
  structure.add(plinth, tower, ...stripes, gallery, rail, lanternGlass, roof, door);
  structure.traverse((o) => {
    if (o instanceof T.Mesh) {
      o.castShadow = o !== lanternGlass;
      o.receiveShadow = true;
    }
  });
  // The lamp: dim by day, emissive at night (VenueLighting drives intensity).
  const lampMaterial = new T.MeshStandardMaterial({
    color: 0xfff1d0,
    emissive: 0xffe2a8,
    emissiveIntensity: 0.015,
    roughness: 0.3,
  });
  lampMaterial.name = 'Vellamar lighthouse lamp';
  const display = new T.Mesh(new T.SphereGeometry(0.9, 24, 16), lampMaterial);
  display.name = 'Original lighthouse lamp / night landmark';
  display.position.set(site.x, site.deckY + lanternGlass.position.y, site.z);
  return { site, display, structure, solids: [plinth, tower] };
}
