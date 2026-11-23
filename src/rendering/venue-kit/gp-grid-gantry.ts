import * as T from 'three';
import { trackPoint, type Track } from '../../simulation/track.ts';
import { box, canvasTexture, mergeStatic, mesh, rod } from '../geometry.ts';
import type { BroadcastSightlines } from '../broadcast-sightlines.ts';
import { drawWordmark, fitHeight } from '../studio/brand-atlas.ts';
import { chainShaderHook, injectAfter, injectDeclarations } from '../studio/shader-hooks.ts';
import { cataloguePlantingGround } from './planting-ground.ts';
import { gpGrandstandStyle } from './gp-grandstand-architecture.ts';
import type { VenueKitMaterials } from './materials.ts';

export function gpGridPortalSurvey(track: Track) {
  const p = track.at(0, trackPoint()),
    near = trackPoint(),
    ground = cataloguePlantingGround(track);
  const piers = ([-1, 1] as const).map((side) => {
    // The pit-side wall can be well outside the racing width. Measure the
    // neighbouring stations as well to clear the entire concrete footing.
    let distance = 0;
    for (const station of [-3, 0, 3])
      distance = Math.max(distance, track.boundaryAt(track.at(station, near), side));
    const x = side * (distance + 3.2);
    let bottom = Infinity,
      top = -Infinity;
    for (const dx of [-0.8, 0.8])
      for (const dz of [-1.25, 1.25]) {
        const wx = p.x + p.nx * (x + dx) + p.tx * dz,
          wz = p.z + p.nz * (x + dx) + p.tz * dz;
        const l = track.nearest(wx, wz, near),
          y = ground(near.s, l, wx, wz) - p.y;
        bottom = Math.min(bottom, y);
        top = Math.max(top, y);
      }
    return { x, bottom: bottom - 0.24, top: top + 0.46 };
  });
  return { piers, deck: Math.max(5.72, 5.55 + Math.abs(p.bank) * p.width), startY: p.y };
}

/** Vector lettering rasterizes identically in the game and on a headless
 * capture machine with no system fonts. Each side reads in its own direction. */
function faceMaterial(track: Track) {
  const style = gpGrandstandStyle(track.circuit.id)!;
  const [title, kind] = style.label.split('  /  ');
  const texture = canvasTexture(2048, 256, (c) => {
    for (let side = 0; side < 2; side++) {
      const y = side * 128;
      c.fillStyle = side ? '#cbd0cc' : style.background;
      c.fillRect(0, y, 2048, 128);
      c.fillStyle = side ? style.background : '#dcded4';
      c.fillRect(0, y + 116, 2048, 6);
      c.fillRect(36, y + 16, 7, 89);
      for (const x of [72, 101, 130, 159]) {
        c.beginPath();
        c.moveTo(x, y + 95);
        c.lineTo(x + 18, y + 95);
        c.lineTo(x + 48, y + 36);
        c.lineTo(x + 30, y + 36);
        c.closePath();
        c.fill();
      }
      c.strokeStyle = side ? '#263034' : '#f1eee1';
      const type = { weight: 0.175, width: 1, tracking: 0.095, slant: 0.08 };
      drawWordmark(c, title, 930, y + 61, fitHeight(title, 1290, 86, type), type);
      c.fillStyle = side ? '#78837d' : '#c3bbae';
      c.fillRect(1610, y + 20, 3, 77);
      const sub = side ? 'TIMING' : kind;
      drawWordmark(c, sub, 1810, y + 62, fitHeight(sub, 300, 45, type), type);
    }
  });
  texture.name = 'GP timing bridge double-sided fascia';
  return new T.MeshStandardMaterial({
    name: 'GP timing bridge enamel',
    map: texture,
    color: 0xffffff,
    roughness: 0.49,
    metalness: 0.13,
  });
}

/** Domed red lenses have a lenticular cover over the emitter matrix. The LED
 * pattern averages out below a pixel. The five existing replay light values
 * are still the only source of emission. */
function startLens() {
  const glass = new T.MeshStandardMaterial({
    name: 'GP starting signal lens',
    color: 0x4c1012,
    metalness: 0.08,
    roughness: 0.26,
    emissive: 0xff200e,
    emissiveIntensity: 0,
  });
  chainShaderHook(glass, 'gp-grid-led-lens-v1', (shader) => {
    injectDeclarations(
      shader,
      'common',
      'attribute vec2 gpLampFace; varying vec2 vLampFace;',
      'vertex',
    );
    injectAfter(shader, 'begin_vertex', 'vLampFace=gpLampFace;', 'vertex');
    injectDeclarations(shader, 'common', 'varying vec2 vLampFace;', 'fragment');
    injectAfter(
      shader,
      'emissivemap_fragment',
      `
vec2 cell = vLampFace * 9.0;
float aa = max(length(dFdx(cell)),length(dFdy(cell)));
float bead = 1.0 - smoothstep(.22,.42,length(fract(cell)-.5));
float grille = mix(bead,.36,smoothstep(.32,.82,aa));
diffuseColor.rgb *= .68 + .42*grille;
totalEmissiveRadiance *= .75 + .72*grille;`,
      'fragment',
    );
  });
  return glass;
}

export function buildGpGridGantry(
  track: Track,
  parent: T.Group,
  sightlines: BroadcastSightlines,
  materials: Pick<VenueKitMaterials, 'steel' | 'darkSteel' | 'concrete'>,
  lamps: T.MeshStandardMaterial[],
) {
  const survey = gpGridPortalSurvey(track),
    { deck, piers } = survey,
    solid = new T.Group();
  solid.name = 'GP timing portal steel and signage';
  parent.add(solid);
  const { steel, darkSteel, concrete } = materials,
    left = piers[0].x,
    right = piers[1].x;
  const mid = (left + right) * 0.5,
    span = right - left,
    crown = deck + 1.57;
  const beam = (
    x1: number,
    y1: number,
    z1: number,
    x2: number,
    y2: number,
    z2: number,
    r: number,
  ) => rod(solid, steel, new T.Vector3(x1, y1, z1), new T.Vector3(x2, y2, z2), r);
  for (const pier of piers) {
    const { x, top, bottom } = pier;
    sightlines.add(box(solid, concrete, x, (top + bottom) * 0.5, 0, 1.55, top - bottom, 2.4));
    for (const z of [-0.77, 0.77]) {
      const post = box(solid, steel, x, (crown + top) * 0.5, z, 0.34, crown - top, 0.32);
      sightlines.add(post);
      box(solid, darkSteel, x, top + 0.047, z, 0.64, 0.094, 0.68);
      for (const dx of [-0.234, 0.234])
        for (const dz of [-0.26, 0.26])
          box(solid, steel, x + dx, top + 0.115, z + dz, 0.075, 0.053, 0.075);
    }
    for (let i = 0; i < 4; i++) {
      const y0 = T.MathUtils.lerp(top + 0.22, crown, i / 4),
        y1 = T.MathUtils.lerp(top + 0.22, crown, (i + 1) / 4);
      beam(x, y0, -0.77, x, y1, 0.77, 0.052);
      beam(x, y0, 0.77, x, y1, -0.77, 0.052);
    }
  }
  const bays = Math.ceil(span / 3.2);
  for (const z of [-0.77, 0.77]) {
    // Only the lower solid chord occludes an entire horizontal strip.
    sightlines.add(box(solid, darkSteel, mid, deck, z, span + 0.34, 0.17, 0.24));
    box(solid, steel, mid, crown, z, span + 0.34, 0.15, 0.19);
    for (let i = 0; i < bays; i++) {
      const a = left + (span * i) / bays,
        b = left + (span * (i + 1)) / bays;
      beam(a, deck, z, (a + b) * 0.5, crown, z, 0.066);
      beam((a + b) * 0.5, crown, z, b, deck, z, 0.066);
      if (z > 0) beam(a, deck, -z, a, deck, z, 0.07);
    }
  }
  const panelWidth = Math.min(21.8, span - 7);
  const print = faceMaterial(track),
    panelY = deck + 0.81;
  sightlines.add(box(solid, darkSteel, 0, panelY, 0, panelWidth + 0.15, 1.46, 1.78));
  for (const front of [true, false]) {
    const face = new T.PlaneGeometry(panelWidth, 1.32);
    if (front) face.rotateY(Math.PI);
    const uv = face.getAttribute('uv');
    for (let i = 0; i < uv.count; i++) uv.setY(i, (uv.getY(i) + (front ? 1 : 0)) * 0.5);
    const panel = mesh(solid, face, print, 0, panelY, front ? -0.9 : 0.9);
    panel.castShadow = false;
  }
  const lensY = deck - 0.68,
    faceZ = -0.98;
  const rack = box(solid, darkSteel, 0, lensY, -0.73, 2.55, 0.49, 0.33);
  sightlines.add(rack);
  for (const x of [-0.91, 0.91]) box(solid, steel, x, deck - 0.3, -0.71, 0.08, 0.6, 0.08);
  // A rain hood conceals the bright sky above each lens. The lower half
  // stays open, keeping the red signal visible from a rider's eye height.
  for (let i = 0; i < 5; i++) {
    const x = (i - 2) * 0.45;
    const ring = new T.TorusGeometry(0.167, 0.025, 6, 24);
    mesh(solid, ring, darkSteel, x, lensY, faceZ);
    const hood = new T.CylinderGeometry(0.197, 0.197, 0.3, 18, 1, true, Math.PI * 0.5, Math.PI);
    hood.rotateX(Math.PI / 2);
    mesh(solid, hood, darkSteel, x, lensY, faceZ - 0.05);
    const geometry = new T.SphereGeometry(1, 20, 8, 0, Math.PI * 2, 0, Math.PI / 2);
    const pos = geometry.getAttribute('position'),
      face = new Float32Array(pos.count * 2);
    for (let v = 0; v < pos.count; v++) {
      face[2 * v] = pos.getX(v);
      face[2 * v + 1] = pos.getZ(v);
    }
    geometry.setAttribute('gpLampFace', new T.BufferAttribute(face, 2));
    geometry.scale(0.147, 0.037, 0.147);
    geometry.rotateX(-Math.PI / 2);
    const lens = startLens(),
      lamp = mesh(parent, geometry, lens, x, lensY, faceZ - 0.012);
    lamp.name = 'GP start signal ' + (i + 1);
    lamp.castShadow = false;
    lamps.push(lens);
  }
  mergeStatic(solid);
  return survey;
}
