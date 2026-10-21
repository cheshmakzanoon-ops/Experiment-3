import * as T from 'three';
import { canvasTexture } from './geometry.ts';
import { liveryScheme } from './car-livery.ts';
import { drawWordmark, fitHeight, type WordmarkStyle } from './studio/brand-atlas.ts';
import { tagWeatherSurface } from './weather-presentation.ts';
import type { BikeMaterials } from './bike.ts';

/** One 2048x1024 painted atlas per entrant, projected onto the R3 shell.
 * Rows 0-511: the right flank (front at the left) and the left flank (front
 * at the right), each viewed from outside so wordmarks read correctly on both
 * sides. Rows 512-1023: the plan view (front at the left, +X at the bottom).
 * Every shape is authored in chassis metres, so a stripe placed on the nose
 * lands on the nose of both flanks and the top. Original artwork only: the
 * typography and partner marks come from the project's own brand atlas. */
export const ATLAS = Object.freeze({
  width: 2048,
  height: 1024,
  zFront: 1.0,
  zRear: -0.9,
  yTop: 0.46,
  yBottom: -0.48,
  halfWidth: 0.4,
});
const LENGTH = ATLAS.zFront - ATLAS.zRear,
  HEIGHT = ATLAS.yTop - ATLAS.yBottom;

export type Projection = 'side' | 'top';

/** Canvas pixel for a chassis point on a flank (side = +1 right, -1 left). */
export function sidePixel(side: number, z: number, y: number): [number, number] {
  const along = (ATLAS.zFront - z) / LENGTH;
  return [side > 0 ? along * 1024 : 1024 + (1 - along) * 1024, ((ATLAS.yTop - y) / HEIGHT) * 512];
}
/** Canvas pixel for a chassis point seen from above. */
export function topPixel(z: number, x: number): [number, number] {
  return [
    ((ATLAS.zFront - z) / LENGTH) * 2048,
    512 + ((x + ATLAS.halfWidth) / (2 * ATLAS.halfWidth)) * 512,
  ];
}
/** Texture coordinate of a shell vertex (CanvasTexture keeps flipY). */
export function atlasUv(projection: Projection, x: number, y: number, z: number): [number, number] {
  const [px, py] = projection === 'top' ? topPixel(z, x) : sidePixel(Math.sign(x) || 1, z, y);
  // Keep each region's samples inside its own half so mip filtering at the
  // flank seam never borrows the opposite side's artwork.
  const clampX =
    projection === 'top'
      ? px
      : x >= 0
        ? Math.min(1020, Math.max(4, px))
        : Math.min(2044, Math.max(1028, px));
  const clampY =
    projection === 'top' ? Math.min(1020, Math.max(516, py)) : Math.min(508, Math.max(4, py));
  return [clampX / ATLAS.width, 1 - clampY / ATLAS.height];
}

type Point = readonly [z: number, y: number];
function paintAtlas(entrant: number) {
  const scheme = liveryScheme(entrant),
    number = String((entrant % 98) + 2),
    primary = new T.Color(scheme.primary),
    light = primary.r * 0.2126 + primary.g * 0.7152 + primary.b * 0.0722 > 0.42,
    ink = '#f1f2ee',
    keel = '#14181b',
    contrast = light ? '#15191c' : ink;
  return canvasTexture(ATLAS.width, ATLAS.height, (c) => {
    c.fillStyle = scheme.primary;
    c.fillRect(0, 0, ATLAS.width, ATLAS.height);
    const sideShape = (side: number, points: readonly Point[], colour: string) => {
      c.beginPath();
      points.forEach(([z, y], i) => {
        const [px, py] = sidePixel(side, z, y);
        if (i) c.lineTo(px, py);
        else c.moveTo(px, py);
      });
      c.closePath();
      c.fillStyle = colour;
      c.fill();
    };
    const topShape = (points: readonly (readonly [z: number, x: number])[], colour: string) => {
      c.beginPath();
      points.forEach(([z, x], i) => {
        const [px, py] = topPixel(z, x);
        if (i) c.lineTo(px, py);
        else c.moveTo(px, py);
      });
      c.closePath();
      c.fillStyle = colour;
      c.fill();
    };
    const word = (
      [px, py]: [number, number],
      text: string,
      width: number,
      height: number,
      colour: string,
      style: WordmarkStyle = {
        weight: 0.18,
        width: 0.9,
        tracking: 0.12,
        slant: 0.14,
        corner: 0.08,
      },
      rotate = 0,
    ) => {
      c.save();
      c.translate(px, py);
      if (rotate) c.rotate(rotate);
      c.strokeStyle = colour;
      drawWordmark(c, text, 0, 0, fitHeight(text, width, height, style), style);
      c.restore();
    };
    // Each flank is composed in chassis coordinates and mirrored by the
    // projection itself; text is placed, never mirrored.
    for (const side of [1, -1]) {
      // Dark lower keel and belly: the ground-effect pods read as one mass.
      sideShape(
        side,
        [
          [0.46, -0.2],
          [0.3, -0.2],
          [0.1, -0.23],
          [-0.12, -0.27],
          [-0.12, -0.5],
          [0.46, -0.5],
        ],
        keel,
      );
      // Long secondary-colour sweep from the beak, under the wing and along the
      // flank to the tail, the strongest line in REF_018/056/060.
      sideShape(
        side,
        [
          [1.0, 0.06],
          [0.86, 0.105],
          [0.62, 0.075],
          [0.4, -0.02],
          [0.18, -0.09],
          [-0.05, -0.12],
          [-0.05, -0.2],
          [0.16, -0.17],
          [0.38, -0.1],
          [0.6, 0.02],
          [0.84, 0.055],
          [1.0, 0.02],
        ],
        scheme.secondary,
      );
      // Thin accent pinstripes either side of the sweep.
      sideShape(
        side,
        [
          [0.98, 0.075],
          [0.86, 0.118],
          [0.62, 0.088],
          [0.4, -0.006],
          [0.18, -0.076],
          [-0.05, -0.106],
          [-0.05, -0.116],
          [0.18, -0.086],
          [0.4, -0.016],
          [0.62, 0.078],
          [0.86, 0.106],
          [0.98, 0.064],
        ],
        scheme.accent,
      );
      sideShape(
        side,
        [
          [0.36, -0.12],
          [0.14, -0.185],
          [-0.05, -0.205],
          [-0.05, -0.215],
          [0.14, -0.197],
          [0.36, -0.132],
        ],
        scheme.accent,
      );
      // Tail: secondary underside and a diagonal accent cut.
      sideShape(
        side,
        [
          [-0.2, 0.175],
          [-0.5, 0.2],
          [-0.9, 0.29],
          [-0.9, 0.12],
          [-0.2, 0.1],
        ],
        scheme.secondary,
      );
      sideShape(
        side,
        [
          [-0.56, 0.36],
          [-0.62, 0.36],
          [-0.72, 0.22],
          [-0.66, 0.22],
        ],
        scheme.accent,
      );
      // Number field on the flank behind the fork, as on the reference grid.
      sideShape(
        side,
        [
          [0.39, 0.035],
          [0.2, 0.012],
          [0.18, -0.105],
          [0.37, -0.075],
        ],
        light ? keel : ink,
      );
      const flankNumber = sidePixel(side, 0.285, -0.035);
      word(flankNumber, number, 120, 50, light ? ink : keel, {
        weight: 0.26,
        width: 1,
        slant: 0.18,
        tracking: 0.12,
        corner: 0.1,
      });
      // Partner marks sized and spaced like a works livery: one title partner
      // across the main flank, smaller technical partners on the pods, nose
      // and tail. All names are the project's fictional brands.
      word(sidePixel(side, 0.07, -0.025), scheme.title, 150, 24, contrast);
      word(sidePixel(side, 0.24, -0.3), scheme.partners[0], 130, 16, ink);
      word(sidePixel(side, 0.06, -0.37), scheme.partners[1], 140, 17, ink);
      word(sidePixel(side, 0.74, 0.17), 'MOTOBOUND', 140, 18, contrast);
      word(sidePixel(side, 0.62, 0.115), scheme.partners[1], 110, 12, contrast);
      word(sidePixel(side, -0.48, 0.24), 'MOTOBOUND', 150, 20, contrast);
      word(sidePixel(side, -0.66, 0.16), scheme.partners[0], 120, 13, ink);
      word(sidePixel(side, 0.12, -0.2), 'WORKS RACING', 150, 15, ink);
      // Machined-looking cooling gills printed as recessed dark slots.
      for (let k = 0; k < 5; k++) {
        const z = 0.05 - k * 0.028;
        sideShape(
          side,
          [
            [z, 0.08],
            [z - 0.012, 0.08],
            [z - 0.03, -0.0],
            [z - 0.018, -0.0],
          ],
          'rgba(8,10,12,0.85)',
        );
      }
    }
    // Plan view: nose number field, tank top and tail panels.
    topShape(
      [
        [1.0, 0.0],
        [0.9, 0.08],
        [0.76, 0.14],
        [0.68, 0.16],
        [0.68, -0.16],
        [0.76, -0.14],
        [0.9, -0.08],
      ],
      scheme.primary,
    );
    topShape(
      [
        [0.92, 0.0],
        [0.84, 0.065],
        [0.71, 0.105],
        [0.71, -0.105],
        [0.84, -0.065],
      ],
      light ? keel : ink,
    );
    // The nose number reads to a viewer ahead of the machine: up the slope.
    const [nx, ny] = topPixel(0.795, 0);
    c.save();
    c.translate(nx, ny);
    c.rotate(Math.PI / 2);
    c.strokeStyle = light ? ink : keel;
    const numberStyle = { weight: 0.27, width: 1, slant: 0.16, tracking: 0.12, corner: 0.1 };
    drawWordmark(c, number, 0, 0, fitHeight(number, 120, 150, numberStyle), numberStyle);
    c.restore();
    // Twin longitudinal stripes run over the tank and tail.
    for (const s of [1, -1])
      topShape(
        [
          [0.36, s * 0.03],
          [-0.9, s * 0.03],
          [-0.9, s * 0.055],
          [0.36, s * 0.055],
        ],
        scheme.accent,
      );
    topShape(
      [
        [0.4, -0.4],
        [0.4, 0.4],
        [0.62, 0.4],
        [0.62, -0.4],
      ],
      scheme.secondary,
    );
    word(topPixel(-0.7, 0), number, 110, 110, ink, undefined, Math.PI / 2);
    word(topPixel(0.13, 0), scheme.title, 120, 26, ink, undefined, Math.PI / 2);
  });
}

const cache = new WeakMap<BikeMaterials, T.MeshPhysicalMaterial>();
/** The entrant's painted livery. Owned by (and disposed with) its materials. */
export function gpR3LiveryMaterial(materials: BikeMaterials, entrant: number) {
  const known = cache.get(materials);
  if (known) return known;
  const material = new T.MeshPhysicalMaterial({
    map: paintAtlas(entrant),
    metalness: 0,
    roughness: 0.28,
    clearcoat: 1,
    clearcoatRoughness: 0.035,
    specularIntensity: 0.6,
    normalMap: materials.paint.normalMap,
    normalScale: new T.Vector2(0.03, 0.03),
    name: 'GP-R3 painted livery (deep clear coat)',
  });
  material.map!.anisotropy = 16;
  // The atlas spans the whole machine (about 0.9 mm per texel at full size),
  // so it may keep up to four times the preset's generated-canvas limit.
  material.map!.userData.textureBudgetScale = 4;
  tagWeatherSurface(material, 'paint');
  materials.list.push(material);
  cache.set(materials, material);
  return material;
}
