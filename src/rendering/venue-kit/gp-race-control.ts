import * as T from 'three';
import { clamp } from '../../core/math.ts';
import { isGpCourse } from '../../simulation/gp-corner-shape.ts';
import { trackPoint, type Track } from '../../simulation/track.ts';
import { box, canvasTexture, mergeStatic, mesh, rod } from '../geometry.ts';
import type { PaddockMaterials } from '../paddock-detail.ts';
import { installCircuitFinish } from '../circuit-finish.ts';
import { tagWeatherSurface } from '../weather-presentation.ts';

type Point = readonly [number, number];
interface GpControlStyle {
  readonly accent: number;
  readonly silhouette: 'stepped' | 'coastal' | 'folded' | 'shaded';
  readonly height: number;
  readonly width: number;
  readonly depth: number;
}

/** Original architecture informed by REF032/062/077: an observation level is
 * visibly supported, glazing sits behind roof/shade edges, and long pit-row
 * sightlines end in a recognisable control building. No copied circuit logo. */
export const GP_CONTROL_STYLES: Readonly<Record<string, GpControlStyle>> = Object.freeze({
  'poggio-alto': {
    accent: 0x934d3c,
    silhouette: 'stepped',
    height: 17.1,
    width: 12.5,
    depth: 11.8,
  },
  'cape-wrenna': {
    accent: 0x557b8e,
    silhouette: 'coastal',
    height: 15.9,
    width: 13.3,
    depth: 12.4,
  },
  haarveld: { accent: 0x405f88, silhouette: 'folded', height: 18.2, width: 12.1, depth: 11.4 },
  montejaral: { accent: 0xa37a48, silhouette: 'shaded', height: 16.3, width: 13.4, depth: 12.3 },
});

export interface GpRaceControlSite {
  readonly s: number;
  readonly x: number;
  readonly y: number;
  readonly z: number;
  readonly yaw: number;
}

/** Reuse the existing tower station, centre and 14 x 14 m footprint. The
 * datum now follows the same banked garage frontage rather than hovering
 * 0.6 m above the ground. Negative local X always faces the active pit lane. */
export function gpRaceControlSite(track: Track): GpRaceControlSite | null {
  if (!isGpCourse(track)) return null;
  const pit = track.pit,
    spacing = Math.max(9, pit.boxSpacing),
    centre = pit.firstBox + 5.5 * pit.boxSpacing,
    s = centre + (12 * spacing + 6) / 2 + 10,
    p = track.at(s, trackPoint()),
    front = pit.offset + 6.5,
    lateral = pit.side * (front + 7);
  return {
    s,
    x: p.x + p.nx * lateral,
    y: p.y + p.bank * clamp(pit.side * front, -12, 12) + 0.02,
    z: p.z + p.nz * lateral,
    yaw: Math.atan2(p.tx, p.tz) + (pit.side > 0 ? 0 : Math.PI),
  };
}

function chamfered(width: number, depth: number, bevel: number): Point[] {
  const x = width / 2,
    z = depth / 2;
  return [
    [-x + bevel, -z],
    [x - bevel, -z],
    [x, -z + bevel],
    [x, z - bevel],
    [x - bevel, z],
    [-x + bevel, z],
    [-x, z - bevel],
    [-x, -z + bevel],
  ];
}

function contour(style: GpControlStyle, width = style.width, depth = style.depth): Point[] {
  if (style.silhouette === 'coastal')
    return Array.from({ length: 24 }, (_, i) => {
      const a = (i / 24) * Math.PI * 2;
      return [(Math.cos(a) * width) / 2, (Math.sin(a) * depth) / 2] as Point;
    });
  return chamfered(width, depth, style.silhouette === 'folded' ? 2.05 : 0.55);
}

/** Closed architectural plate; generated in metres, including underside and
 * edge faces. Roofs therefore shade the window ribbon in a low riding view. */
function plate(
  root: T.Group,
  material: T.Material,
  points: readonly Point[],
  y: number,
  height: number,
) {
  const shape = new T.Shape();
  points.forEach(([x, z], i) => (i ? shape.lineTo(x, -z) : shape.moveTo(x, -z)));
  shape.closePath();
  const geometry = new T.ExtrudeGeometry(shape, { depth: height, bevelEnabled: false, steps: 1 });
  geometry.rotateX(-Math.PI / 2);
  return mesh(root, geometry, material, 0, y, 0);
}

/** Flat panels follow a polygonal window ribbon. Its corners remain actual
 * geometry, while the coastal profile has enough facets for a curved pod. */
function ribbon(
  root: T.Group,
  material: T.Material,
  points: readonly Point[],
  y: number,
  height: number,
  frames?: T.Material,
) {
  for (let i = 0; i < points.length; i++) {
    const a = points[i],
      b = points[(i + 1) % points.length],
      dx = b[0] - a[0],
      dz = b[1] - a[1],
      length = Math.hypot(dx, dz),
      pane = box(
        root,
        material,
        (a[0] + b[0]) / 2,
        y + height / 2,
        (a[1] + b[1]) / 2,
        length,
        height,
        0.065,
      );
    pane.rotation.y = -Math.atan2(dz, dx);
    if (!frames) continue;
    const bays = Math.max(1, Math.ceil(length / 1.65));
    for (let bay = 0; bay < bays; bay++) {
      const t = bay / bays;
      box(root, frames, a[0] + dx * t, y + height / 2, a[1] + dz * t, 0.085, height + 0.12, 0.085);
    }
  }
}

/** One small static atlas carries both pit-facing and approaching-rider
 * lettering. No live numbers are invented and no per-frame canvas is drawn. */
function identityMaterial(track: Track, accent: number) {
  const map = canvasTexture(1024, 256, (c) => {
    c.fillStyle = '#d4d6cc';
    c.fillRect(0, 0, 1024, 256);
    c.fillStyle = '#' + accent.toString(16).padStart(6, '0');
    c.fillRect(0, 0, 24, 256);
    c.fillRect(1000, 0, 24, 256);
    c.fillStyle = '#263038';
    c.textAlign = 'center';
    c.textBaseline = 'middle';
    c.font = '800 102px Arial';
    c.fillText(track.circuit.short, 512, 95, 922);
    c.font = '600 38px Arial';
    c.fillText('RACE CONTROL', 512, 197, 870);
  });
  map.name = 'GP race control venue identity';
  const material = new T.MeshStandardMaterial({ map, roughness: 0.74, metalness: 0.02 });
  material.name = 'GP control printed enamel';
  installCircuitFinish(material, 'paint');
  tagWeatherSurface(material, 'paint');
  return material;
}

export function buildGpRaceControl(track: Track, m: PaddockMaterials) {
  const site = gpRaceControlSite(track);
  if (!site) return null;
  const style = GP_CONTROL_STYLES[track.circuit.id],
    root = new T.Group(),
    accent = new T.MeshStandardMaterial({ color: style.accent, roughness: 0.64, metalness: 0.15 }),
    print = identityMaterial(track, style.accent),
    roofY = style.height,
    observation = roofY - 3.15,
    skin = contour(style, style.width - 1.15, style.depth - 1.15);
  root.name = 'GP race control · ' + track.circuit.short;
  root.userData.gpRaceControl = { ...site, silhouette: style.silhouette };
  accent.name = 'GP control formed architectural enamel';
  installCircuitFinish(accent, 'paint');
  tagWeatherSurface(accent, 'paint');
  // Broad structural base and stair/service core, with visibly embedded
  // foundations. A narrower shaft reveals the upper observation overhang.
  plate(root, m.concrete, chamfered(13.6, 13.6, 0.65), -0.48, 0.64);
  box(root, m.concrete, 1.4, (observation - 0.16) / 2, 0, 7.6, observation - 0.16, 9.6);
  box(root, m.interior, -2.46, 1.6, -2.65, 0.08, 2.9, 1.45);
  box(root, m.steel, -2.52, 1.6, -2.65, 0.07, 2.95, 0.075);
  for (const floor of [3.4, 6.65, 9.9]) {
    if (floor + 1.6 > observation) continue;
    box(root, m.glass, -2.45, floor + 0.92, 0, 0.075, 1.48, 8.35);
    for (const z of [-3.6, -1.8, 0, 1.8, 3.6])
      box(root, m.steel, -2.51, floor + 0.92, z, 0.085, 1.62, 0.07);
    box(root, m.cladding, -2.88, floor + 1.88, 0, 0.95, 0.13, 9.1);
  }

  // The observation volume is recessed under an opaque overhanging roof.
  // A dark ceiling and a slab behind the glass provide plausible reflections
  // and occlusion without transparency sorting or extra offscreen passes.
  plate(root, m.concrete, contour(style), observation - 0.3, 0.3);
  plate(root, m.interior, skin, roofY - 0.18, 0.16);
  ribbon(root, m.glass, skin, observation + 0.18, 2.76, m.steel);
  ribbon(root, accent, contour(style, style.width - 0.06, style.depth - 0.06), observation, 0.23);
  plate(root, m.cladding, contour(style), roofY, 0.24);

  if (style.silhouette === 'stepped') {
    // Tuscan control: offset stone service pier, terracotta blade and two
    // terrace levels make a stepped silhouette above the long pit gallery.
    box(root, accent, 4.65, 9.7, 4.12, 1.1, 19.4, 1.5);
    for (const y of [7, 10.2]) {
      plate(root, m.concrete, chamfered(10.7, 11.9, 0.55), y, 0.2);
      for (const z of [-5.68, 5.68]) {
        box(root, m.steel, -1.2, y + 1.04, z, 7.9, 0.065, 0.07);
        for (const x of [-4.9, -1.3, 2.3]) box(root, m.steel, x, y + 0.62, z, 0.065, 0.84, 0.065);
      }
    }
    plate(root, accent, chamfered(9.9, 10.1, 0.55), roofY + 0.36, 0.18);
  } else if (style.silhouette === 'coastal') {
    // Coastal control: a shallow oval lookout, twin raked supports and
    // tapering horizontal eyebrows instead of another rectangular office.
    for (const z of [-3.75, 3.75])
      rod(
        root,
        m.steel,
        new T.Vector3(-1.9, 5.6, z),
        new T.Vector3(-5.2, observation - 0.3, z),
        0.15,
      );
    const top = plate(root, accent, contour(style, 12.7, 11.8), roofY + 0.34, 0.16),
      positions = top.geometry.getAttribute('position');
    for (let i = 0; i < positions.count; i++)
      positions.setY(i, positions.getY(i) + 0.09 * positions.getX(i));
    top.geometry.computeVertexNormals();
    ribbon(root, m.cladding, contour(style, 12.6, 11.7), observation + 2.16, 0.16);
    box(root, accent, 4.6, 8.2, 0, 0.7, 16.4, 3.4);
  } else if (style.silhouette === 'folded') {
    // Heath control: angular glazed lantern and a folded roof with exposed
    // diagonal support members, echoing this venue's sawtooth pit roof.
    const roof = plate(root, accent, contour(style, 12.6, 11.9), roofY + 0.28, 0.16),
      positions = roof.geometry.getAttribute('position');
    for (let i = 0; i < positions.count; i++)
      positions.setY(i, positions.getY(i) + Math.abs(positions.getZ(i)) * 0.2);
    roof.geometry.computeVertexNormals();
    for (const z of [-4.9, 4.9]) {
      rod(
        root,
        m.steel,
        new T.Vector3(-2.1, 8.1, z),
        new T.Vector3(-5.15, observation - 0.25, z),
        0.11,
      );
      box(root, accent, 3.6, 10.1, z, 0.62, 20.2, 0.34);
    }
    for (const y of [6.6, 10.05]) plate(root, m.cladding, chamfered(10.3, 10.6, 1.6), y, 0.2);
  } else {
    // Sierra control: deep pale solar visor and a rhythm of slim vertical
    // screens around the glazing, with an ochre service spine at the rear.
    box(root, accent, 4.5, 8.9, 0, 1.25, 17.8, 8.6);
    for (const z of [-4.85, -3.2, -1.6, 0, 1.6, 3.2, 4.85])
      box(root, m.cladding, -6.02, observation + 1.7, z, 0.65, 3.1, 0.12);
    for (const z of [-5.64, 5.64])
      for (const x of [-4.5, -2.2, 0, 2.2, 4.5])
        box(root, m.cladding, x, observation + 1.7, z, 0.13, 3.1, 0.64);
    plate(root, accent, contour(style, 11.5, 10.4), roofY + 0.44, 0.16);
    for (const y of [6.45, 9.6]) box(root, m.cladding, -3.25, y, 0, 2.3, 0.16, 10.8);
  }

  // A real double-sided structural sign cabinet at the upper level. The
  // two printed faces point toward the pit lane and arriving traffic; they
  // do not appear backwards through a transparent plane from behind.
  const signY = observation - 1.8;
  box(root, accent, -2.75, signY, 0, 0.5, 1.78, 8.7);
  const pitFace = mesh(root, new T.PlaneGeometry(8.5, 1.65), print, -3.01, signY, 0);
  pitFace.rotation.y = -Math.PI / 2;
  // The left-pit frame reverses local travel, so its approach face belongs
  // on the other physical end of the building.
  const end = -track.pit.side;
  box(root, accent, 1, signY, end * 5.02, 8.6, 1.78, 0.42);
  const approach = mesh(root, new T.PlaneGeometry(8.4, 1.65), print, 1, signY, end * 5.24);
  approach.rotation.y = end < 0 ? Math.PI : 0;

  // Reuse a bounded material set and the ordinary static/frustum batching.
  // All created resources remain attached for the standard scene disposer.
  mergeStatic(root);
  root.position.set(site.x, site.y, site.z);
  root.rotation.y = site.yaw;
  return root;
}
