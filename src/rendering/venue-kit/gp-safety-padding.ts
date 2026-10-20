import * as T from 'three';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';
import { clamp, mod } from '../../core/math.ts';
import { isGpCourse } from '../../simulation/gp-corner-shape.ts';
import { trackPoint } from '../../simulation/track.ts';
import { chainShaderHook, injectAfter, injectDeclarations } from '../studio/shader-hooks.ts';
import { tagWeatherSurface } from '../weather-presentation.ts';
import type { VenueKitContext } from './context.ts';
import { venuePoint } from './sweep.ts';

/** Original protective covers, in metres. REF082/094 show rounded blue/white
 * segments; the fabric seams and dimensions are authored construction choices.
 * The entire cover stays inside the former two-row tyre/belt envelope. */
export const GP_SAFETY_PADDING = Object.freeze({
  length: 2.4,
  depth: 1.16,
  height: 1.12,
  centreDepth: -0.68,
  gap: 0.035,
  buried: 0.045,
  radius: 0.16,
  blue: 0x36598a,
  white: 0xd5d5cd,
});

export interface GpPaddingSite {
  s: number;
  from: number;
  to: number;
  side: 1 | -1;
  matrix: T.Matrix4;
  colour: T.Color;
}

/** One closed, softly crowned cover shared by every instance in a venue.
 * No hidden stacks: the retained concrete supplies the backing wall. */
export function gpSafetyPaddingGeometry() {
  const pad = GP_SAFETY_PADDING,
    geometry = new RoundedBoxGeometry(pad.depth, pad.height, pad.length - pad.gap, 2, pad.radius),
    p = geometry.getAttribute('position');
  for (let i = 0; i < p.count; i++) {
    const x = p.getX(i),
      y = p.getY(i) + pad.height / 2,
      z = p.getZ(i),
      t = y / pad.height;
    // Softly drafted shoulders and a shallow sewn-crown sag. The base is
    // embedded in the same extended bank plane used by the old tyre wall.
    p.setXYZ(
      i,
      x * (1 - 0.08 * T.MathUtils.smoothstep(t, 0.55, 1)),
      y - pad.buried - 0.014 * Math.sin((z / pad.length + 0.5) * Math.PI) ** 2 * t ** 3,
      z,
    );
  }
  geometry.computeVertexNormals();
  // RoundedBoxGeometry is non-indexed; preserve a smooth sewn shell across
  // its original six face boundaries after shaping it.
  const normals = geometry.getAttribute('normal'),
    shared = new Map<string, number[]>();
  for (let i = 0; i < p.count; i++) {
    const key = [p.getX(i), p.getY(i), p.getZ(i)].map((v) => Math.round(v * 1e6)).join('/');
    const list = shared.get(key);
    if (list) list.push(i);
    else shared.set(key, [i]);
  }
  const n = new T.Vector3();
  for (const list of shared.values()) {
    n.set(0, 0, 0);
    for (const i of list) n.add(new T.Vector3().fromBufferAttribute(normals, i));
    n.normalize();
    for (const i of list) normals.setXYZ(i, n.x, n.y, n.z);
  }
  geometry.name = 'GP rounded protective cover';
  geometry.computeBoundingBox();
  geometry.computeBoundingSphere();
  return geometry;
}

/** Texture-free coated fabric. Finite-width seams and weave filter out before
 * they become subpixel stripes. Per-instance colours retain a single draw. */
export function gpSafetyPaddingMaterial() {
  const material = new T.MeshStandardMaterial({ color: 0xffffff, roughness: 0.82 });
  material.name = 'GP coated-fabric protective covers';
  chainShaderHook(material, 'gp-safety-cover-finish-v1', (shader) => {
    injectDeclarations(shader, 'common', 'varying vec3 vGpPaddingMetres;', 'vertex');
    injectAfter(shader, 'begin_vertex', 'vGpPaddingMetres = position;', 'vertex');
    injectDeclarations(
      shader,
      'common',
      `varying vec3 vGpPaddingMetres;
float gpPaddingRelief;
float gpPaddingSeam;
float gpPaddingLine(float d, float width) {
  float aa = max(fwidth(d), .00025);
  return (1. - smoothstep(width - aa, width + aa, abs(d))) * min(1., width / aa);
}`,
      'fragment',
    );
    injectAfter(
      shader,
      'color_fragment',
      `{
  vec3 p = vGpPaddingMetres;
  float footprint = max(length(dFdx(p)), length(dFdy(p)));
  float close = 1. - smoothstep(.009, .04, footprint);
  float weave = sin(p.y * 3100.) * sin(p.z * 2870.) *
    (1. - smoothstep(.00065, .0022, footprint));
  float edge = abs(p.z) - 1.055;
  float webbing = gpPaddingLine(edge, .023) * close;
  gpPaddingSeam = max(gpPaddingLine(edge - .030, .002),
    gpPaddingLine(p.y - .925, .0025)) * close;
  float stitch = gpPaddingSeam * (.65 + .35 * sin(p.y * 720.)) *
    (1. - smoothstep(.002, .006, footprint));
  float dirt = (1. - smoothstep(.04, .32, p.y)) *
    (.6 + .4 * sin(p.z * 9.2 + sin(p.y * 12.)));
  float tension = sin(p.z * 17. + p.y * 7.) *
    (1. - smoothstep(.02, .14, abs(abs(p.z) - .97))) * close;
  diffuseColor.rgb *= 1. - webbing * .15 - gpPaddingSeam * .11 - dirt * .10 + weave * .009;
  gpPaddingRelief = weave * .000025 - stitch * .0004 + tension * .0007;
}`,
      'fragment',
    );
    injectAfter(
      shader,
      'roughnessmap_fragment',
      'roughnessFactor = clamp(roughnessFactor + gpPaddingSeam * .035, .72, .94);',
      'fragment',
    );
    injectAfter(
      shader,
      'normal_fragment_maps',
      `{
  vec3 dx = dFdx(-vViewPosition), dy = dFdy(-vViewPosition);
  vec3 r1 = cross(dy, normal), r2 = cross(normal, dx);
  float determinant = dot(dx, r1);
  vec3 gradient = sign(determinant) *
    (dFdx(gpPaddingRelief) * r1 + dFdy(gpPaddingRelief) * r2);
  normal = normalize(max(abs(determinant), 1.e-10) * normal - gradient);
}`,
      'fragment',
    );
  });
  return tagWeatherSurface(material, 'fabric');
}

/** Fit short modules to the boundary chord and the existing bank plane. The
 * complete footprint, including both end faces, must clear pits and any other
 * section's corridor; this is presentation placement, not new collision. */
export function gpSafetyPaddingPlan(
  kit: VenueKitContext,
  from: number,
  to: number,
  side: 1 | -1,
): GpPaddingSite[] {
  if (!isGpCourse(kit.track) || to - from < 0.5) return [];
  if (![from, to].every(Number.isFinite) || (side !== -1 && side !== 1))
    throw new Error('Invalid GP safety padding span');
  const track = kit.track,
    pad = GP_SAFETY_PADDING,
    sites: GpPaddingSite[] = [],
    p = trackPoint(),
    normal = new T.Vector3(),
    along = new T.Vector3(),
    up = new T.Vector3();
  const centre = (s: number) =>
    venuePoint(track, s, side * (track.boundary(s, side) + pad.centreDepth), 0, p);
  // An outside hairpin and changing runoff setbacks have a longer boundary
  // than the track centreline. Space real covers by that length, otherwise
  // a nominal 2.4 m module can stretch beyond five metres around a turn.
  const samples = Math.ceil((to - from) / 0.75),
    arc = [0];
  let previous = centre(from);
  for (let i = 1; i <= samples; i++) {
    const point = centre(from + ((to - from) * i) / samples);
    arc.push(arc[i - 1] + point.distanceTo(previous));
    previous = point;
  }
  const total = arc[arc.length - 1],
    count = Math.ceil(total / pad.length);
  let sample = 1;
  const stationAt = (distance: number) => {
    while (sample < samples && arc[sample] < distance) sample++;
    const fraction = (distance - arc[sample - 1]) / Math.max(1e-9, arc[sample] - arc[sample - 1]);
    return from + ((to - from) * (sample - 1 + fraction)) / samples;
  };
  for (let i = 0; i < count; i++) {
    const a = stationAt((total * i) / count),
      b = stationAt((total * (i + 1)) / count),
      s = (a + b) / 2,
      start = centre(a),
      end = centre(b),
      middle = start.clone().add(end).multiplyScalar(0.5);
    along.copy(end).sub(start);
    const length = along.length();
    if (length < 0.2) continue;
    along.multiplyScalar(side / length);
    normal.set(along.z, 0, -along.x).normalize();
    up.crossVectors(along, normal).normalize();
    track.at(s, p);
    // At a diagonal setback transition, the boundary normal points partly
    // along the road. Narrowing the normal thickness by cos(angle) keeps the
    // cover's road-normal depth within the original tyre footprint. The
    // basis stays orthogonal: Three's instance normal transform needs no
    // custom shear correction, extra attribute or depth-material override.
    const roadCosine = Math.abs(normal.x * p.nx + normal.z * p.nz);
    if (roadCosine < 0.15) continue;
    const matrix = new T.Matrix4(),
      probe = new T.Vector3(),
      q = trackPoint(),
      depthHalf = pad.depth / 2,
      endHalf = (pad.length - pad.gap) / 2,
      rows = Math.ceil(length / 0.07);
    let depthScale = roadCosine,
      offset = 0,
      fitted = false;
    // Catalogue setbacks are piecewise-constant two-metre cells. A rigid
    // cushion crossing a cell edge must fit the intersection of both depth
    // corridors, not the interpolated chord of the visual backing wall.
    // Narrow only those transition pieces; the shared rounded mesh and its
    // orthogonal normal transform are unchanged.
    for (let fit = 0; fit < 12; fit++) {
      matrix
        .makeBasis(normal, up, along)
        .setPosition(middle.clone().addScaledVector(normal, offset))
        .scale(new T.Vector3(depthScale, 1, length / pad.length));
      let inner = Infinity,
        outer = -Infinity;
      for (let row = 0; row <= rows; row++) {
        const z = -endHalf + (2 * endHalf * row) / rows;
        for (const x of [-depthHalf, 0, depthHalf])
          for (const y of [-pad.buried, pad.height - pad.buried]) {
            probe.set(x, y, z).applyMatrix4(matrix);
            const lateral = track.nearest(probe.x, probe.z, q),
              inset = side * lateral - track.boundaryAt(q, side);
            inner = Math.min(inner, inset);
            outer = Math.max(outer, inset);
          }
      }
      if (inner >= -1.285 && outer <= -0.095) {
        fitted = true;
        break;
      }
      offset += (-0.69 - (inner + outer) / 2) * roadCosine;
      const excess = Math.max(0, outer - inner - 1.17);
      depthScale -= (excess * roadCosine) / pad.depth + 0.012;
      if (depthScale < 0.14) break;
    }
    if (!fitted) continue;
    // Cut each rigid module back to its two shared station planes. The next
    // module uses the very same plane from the opposite side, including at
    // 20/60 m chunk boundaries, so rounded ends cannot overlap on bends.
    // This only shrinks the already fitted box; it cannot add an intrusion.
    const position = new T.Vector3().setFromMatrixPosition(matrix),
      forward = along.clone().multiplyScalar(side),
      tangent = new T.Vector3();
    let lower = (-endHalf * length) / pad.length,
      upper = (endHalf * length) / pad.length;
    for (const [station, entry] of [
      [a, true],
      [b, false],
    ] as const) {
      track.at(station, q);
      tangent.set(q.tx, 0, q.tz);
      const advance = forward.dot(tangent),
        centreAlong = (position.x - q.x) * q.tx + (position.z - q.z) * q.tz,
        across = depthHalf * depthScale * Math.abs(normal.dot(tangent)),
        rise = up.dot(tangent),
        base = -pad.buried * rise,
        top = (pad.height - pad.buried) * rise;
      if (advance < 0.25) {
        lower = upper;
        break;
      }
      if (entry)
        lower = Math.max(lower, (0.018 - centreAlong + across - Math.min(base, top)) / advance);
      else upper = Math.min(upper, (-0.018 - centreAlong - across - Math.max(base, top)) / advance);
    }
    if (upper - lower < 0.3) continue;
    position.addScaledVector(forward, (lower + upper) / 2);
    matrix
      .makeBasis(normal, up, along)
      .setPosition(position)
      .scale(new T.Vector3(depthScale, 1, (upper - lower) / (pad.length - pad.gap)));
    let clear = true;
    // Vertices of a conservative box around the actual rounded shell.
    for (const z of [-pad.length / 2, 0, pad.length / 2]) {
      const station = s + side * (z / pad.length) * (b - a);
      if (
        side === track.pit.side &&
        track.isPitSection(mod(station, track.length)) &&
        Math.abs(track.pitOffset(station)) > 3
      ) {
        clear = false;
        break;
      }
      for (const x of [-pad.depth / 2, 0, pad.depth / 2]) {
        const probe = new T.Vector3(x, 0, z).applyMatrix4(matrix);
        if (kit.overOtherSection(probe.x, probe.z, station, 1)) clear = false;
      }
    }
    if (!clear) continue;
    // Stable module identity across repeated builds; no runtime random state.
    const phase = Math.floor(s / pad.length) + (side > 0 ? 1 : 0),
      colour = new T.Color(mod(phase, 4) < 2 ? pad.blue : pad.white);
    colour.multiplyScalar(clamp(0.965 + Math.sin(phase * 2.399) * 0.027, 0.93, 1));
    sites.push({ s, from: a, to: b, side, matrix, colour });
  }
  return sites;
}

// Scene-local ownership avoids reusing a disposed material or installing a
// second renderer's weather uniforms on an old globally cached material.
const resources = new WeakMap<
  VenueKitContext,
  { geometry: T.BufferGeometry; material: T.MeshStandardMaterial }
>();

export function buildGpSafetyPadding(kit: VenueKitContext, sites: readonly GpPaddingSite[]) {
  if (!sites.length) return null;
  let shared = resources.get(kit);
  if (!shared) {
    shared = { geometry: gpSafetyPaddingGeometry(), material: gpSafetyPaddingMaterial() };
    resources.set(kit, shared);
  }
  const mesh = new T.InstancedMesh(shared.geometry, shared.material, sites.length);
  mesh.name = 'GP rounded protective covers';
  for (let i = 0; i < sites.length; i++) {
    mesh.setMatrixAt(i, sites[i].matrix);
    mesh.setColorAt(i, sites[i].colour);
  }
  mesh.castShadow = mesh.receiveShadow = true;
  mesh.computeBoundingBox();
  mesh.computeBoundingSphere();
  return mesh;
}
