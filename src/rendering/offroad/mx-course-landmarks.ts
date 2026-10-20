import * as T from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { Random } from '../../core/math.ts';
import type { OffroadCourse } from '../../simulation/offroad/course.ts';
import { TrackTerrainSurface } from '../../simulation/offroad/course-terrain.ts';
import type { JumpSurvey } from '../../simulation/offroad/profile.ts';
import { motocrossFlowSections } from '../../simulation/offroad/flow-practice.ts';
import { Track } from '../../simulation/track.ts';
import { installScannedMaps, libraryAlbedo } from '../ground/scanned-ground.ts';
import { chainShaderHook, injectAfter, injectDeclarations } from '../studio/shader-hooks.ts';
import { mxFurnitureGround } from './mx-trackside-furniture.ts';
import { planMxCourseSites, type MxCourseSite, type MxJumpGuide } from './mx-course-sites.ts';

export const MX_LANDMARK_BUDGET = Object.freeze({ draws: 16, triangles: 42000 });
type Role = 'timber' | 'metal' | 'paint' | 'rock' | 'guide';
type V3 = readonly [number, number, number];

/** Sample the SAME profile used by wheel contact. The diagram is an advance
 * reading aid: it does not invent a second jump, flight arc or target speed. */
export function mxJumpGuideProfile(course: OffroadCourse, jump: JumpSurvey) {
  const from = jump.start - 2.6,
    to = Math.max(jump.end + 2.4, jump.landing + jump.landingLength / 2);
  const samples = Array.from({ length: 65 }, (_, i) => {
    const s = from + ((to - from) * i) / 64;
    return { s, h: course.profileHeight(s) };
  });
  return {
    from,
    to,
    samples,
    takeoff: jump.takeoff,
    landingFrom: jump.landing - jump.landingLength / 2,
    landingTo: jump.landing + jump.landingLength / 2,
  };
}

function guideAtlas(course: OffroadCourse) {
  const rows = 2 ** Math.ceil(Math.log2(Math.max(1, course.jumps.length))),
    width = 1024,
    rowHeight = 256;
  if (typeof document === 'undefined') {
    const texture = new T.DataTexture(new Uint8Array([223, 219, 193, 255]), 1, 1);
    texture.needsUpdate = true;
    return { texture, rows };
  }
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = rows * rowHeight;
  const c = canvas.getContext('2d');
  if (!c) throw new Error('MX jump guides require a 2D drawing context');
  c.fillStyle = '#1d2b2b';
  c.fillRect(0, 0, canvas.width, canvas.height);
  const sections = motocrossFlowSections(course);
  for (const [index, jump] of course.jumps.entries()) {
    const y = index * rowHeight,
      profile = mxJumpGuideProfile(course, jump),
      max = Math.max(1, ...profile.samples.map((p) => p.h)),
      px = (s: number) => 360 + ((s - profile.from) / (profile.to - profile.from)) * 615,
      py = (h: number) => y + 200 - (h / max) * 100;
    const section = sections.find((section) => section.jumps.includes(jump));
    const sequence = section ? section.jumps.indexOf(jump) + 1 : 0;
    c.fillStyle = section?.id === 1 ? '#7aada6' : '#d08049';
    c.fillRect(0, y, 15, rowHeight);
    c.fillStyle = '#d4dcb8';
    c.font = '800 74px "Saira Variable", Saira, Arial, sans-serif';
    c.textBaseline = 'middle';
    c.fillText(String(index + 1).padStart(2, '0'), 37, y + 78);
    c.font = '700 25px "Saira Variable", Saira, Arial, sans-serif';
    c.fillText(
      section
        ? `FLOW ${section.id + 1}  ·  ${sequence}/${section.jumps.length}`
        : jump.kind.replace('-', ' ').toUpperCase(),
      39,
      y + 140,
      290,
    );
    if (section) {
      c.font = '700 20px "Saira Variable", Saira, Arial, sans-serif';
      c.fillText(section.name, 39, y + 174, 290);
    }
    c.fillStyle = '#f4edde';
    c.font = '800 39px "Saira Variable", Saira, Arial, sans-serif';
    c.fillText(jump.name, 362, y + 42, 610);
    c.fillStyle = '#88916e';
    c.beginPath();
    c.moveTo(px(profile.from), py(0));
    for (const point of profile.samples) c.lineTo(px(point.s), py(point.h));
    c.lineTo(px(profile.to), py(0));
    c.closePath();
    c.fill();
    c.strokeStyle = '#eee5cc';
    c.lineWidth = 5;
    c.beginPath();
    profile.samples.forEach((point, i) => {
      if (i) c.lineTo(px(point.s), py(point.h));
      else c.moveTo(px(point.s), py(point.h));
    });
    c.stroke();
    // The orange lip and pale green downslope refer to the actual survey.
    c.fillStyle = '#e7a565';
    c.beginPath();
    c.arc(px(jump.takeoff), py(course.profileHeight(jump.takeoff)), 7, 0, Math.PI * 2);
    c.fill();
    c.fillStyle = '#ccd695';
    c.fillRect(
      px(profile.landingFrom),
      y + 215,
      px(profile.landingTo) - px(profile.landingFrom),
      7,
    );
    c.font = '600 20px "Saira Variable", Saira, Arial, sans-serif';
    c.fillText(jump.forgiving ? 'ROLL OR CLEAR' : 'READ THE LANDING', 39, y + 209, 280);
  }
  const texture = new T.CanvasTexture(canvas);
  texture.colorSpace = T.SRGBColorSpace;
  texture.anisotropy = 8;
  return { texture, rows };
}

function landmarkMaterials(
  texture: T.Texture,
  hasLandmarks: boolean,
): Record<Role, T.MeshStandardMaterial> {
  const make = (name: string, roughness: number, metalness = 0) =>
    new T.MeshStandardMaterial({ name, color: 0xffffff, vertexColors: true, roughness, metalness });
  const timber = make('MX aged structural timber', 0.88);
  // Grain follows each plank's own UVs after batching, rather than a world
  // axis which would turn vertical siding into horizontal wallpaper.
  chainShaderHook(timber, 'mx-structural-timber-v1', (shader) => {
    injectDeclarations(shader, 'common', 'varying vec2 vMxTimberUv;', 'vertex');
    injectAfter(shader, 'begin_vertex', 'vMxTimberUv = uv;', 'vertex');
    injectDeclarations(shader, 'common', 'varying vec2 vMxTimberUv;', 'fragment');
    injectAfter(
      shader,
      'color_fragment',
      `float timberWave = vMxTimberUv.x * 160.0 + sin( vMxTimberUv.y * 19.0 ) * 1.2;
       float timberFilter = 1.0 - smoothstep( 0.5, 2.0, fwidth( timberWave ) );
       float timberGrain = sin( timberWave ) * sin( timberWave * 0.39 + 1.7 );
       diffuseColor.rgb *= 0.98 + timberGrain * 0.07 * timberFilter;`,
      'fragment',
    );
  });
  const rock = make('MX fractured quarry stone', 0.96);
  rock.normalScale.setScalar(0.55);
  if (hasLandmarks) installScannedMaps(rock, 'rock', libraryAlbedo(rock));
  return {
    timber,
    metal: make('MX folded zinc and galvanised supports', 0.52, 0.72),
    paint: make('MX worn painted frame and canvas', 0.78),
    rock,
    guide: new T.MeshStandardMaterial({
      name: 'MX surveyed jump profile signs',
      map: texture,
      roughness: 0.84,
      vertexColors: true,
    }),
  };
}

/** Owns a bounded set of static meshes; all primitive pieces are merged by
 * material within each landmark so separate sections can still be culled. */
class LandmarkBuilder {
  readonly buckets = new Map<Role, T.BufferGeometry[]>();
  readonly root = new T.Group();
  constructor(
    readonly name: string,
    readonly transform = new T.Matrix4(),
  ) {
    this.root.name = name;
  }
  add(role: Role, source: T.BufferGeometry, colour: number | T.Color) {
    const geometry = source.index ? source.toNonIndexed() : source;
    if (geometry !== source) source.dispose();
    const position = geometry.getAttribute('position'),
      base = colour instanceof T.Color ? colour : new T.Color(colour),
      colors = new Float32Array(position.count * 3);
    for (let i = 0; i < position.count; i++) {
      const shade = 0.975 + 0.025 * Math.sin(position.getY(i) * 1.5 + position.getX(i) * 0.4);
      colors.set([base.r * shade, base.g * shade, base.b * shade], i * 3);
    }
    geometry.setAttribute('color', new T.BufferAttribute(colors, 3));
    if (role === 'rock') {
      // Scanned maps expect metre UVs. The primitive's normalised spherical
      // UVs would stretch one small stone sample across an entire cliff.
      // Project each face on its dominant plane with outward handedness;
      // vertical faces and foundation walls retain the same physical scale.
      const normals = geometry.getAttribute('normal'),
        uv = new Float32Array(position.count * 2);
      for (let i = 0; i < position.count; i += 3) {
        const nx = normals.getX(i) + normals.getX(i + 1) + normals.getX(i + 2),
          ny = normals.getY(i) + normals.getY(i + 1) + normals.getY(i + 2),
          nz = normals.getZ(i) + normals.getZ(i + 1) + normals.getZ(i + 2),
          axis =
            Math.abs(nx) > Math.abs(ny) && Math.abs(nx) > Math.abs(nz)
              ? 'x'
              : Math.abs(ny) > Math.abs(nz)
                ? 'y'
                : 'z';
        for (let j = i; j < i + 3; j++) {
          const x = position.getX(j),
            y = position.getY(j),
            z = position.getZ(j);
          uv[j * 2] = axis === 'x' ? -Math.sign(nx) * z : axis === 'z' ? Math.sign(nz) * x : x;
          uv[j * 2 + 1] = axis === 'y' ? -Math.sign(ny) * z : y;
        }
      }
      geometry.setAttribute('uv', new T.BufferAttribute(uv, 2));
    } else if (!geometry.getAttribute('uv'))
      geometry.setAttribute('uv', new T.BufferAttribute(new Float32Array(position.count * 2), 2));
    geometry.applyMatrix4(this.transform);
    const bucket = this.buckets.get(role) ?? [];
    bucket.push(geometry);
    this.buckets.set(role, bucket);
  }
  box(role: Role, color: number | T.Color, size: V3, at: V3, rotation?: V3) {
    const geometry = new T.BoxGeometry(...size);
    if (rotation)
      geometry.applyMatrix4(new T.Matrix4().makeRotationFromEuler(new T.Euler(...rotation)));
    geometry.translate(...at);
    this.add(role, geometry, color);
  }
  rod(role: Role, color: number, a: V3, b: V3, radius: number, sides = 8) {
    const start = new T.Vector3(...a),
      end = new T.Vector3(...b),
      delta = end.clone().sub(start),
      geometry = new T.CylinderGeometry(radius, radius, delta.length(), sides);
    geometry.applyQuaternion(
      new T.Quaternion().setFromUnitVectors(new T.Vector3(0, 1, 0), delta.normalize()),
    );
    geometry.translate(...start.add(end).multiplyScalar(0.5).toArray());
    this.add(role, geometry, color);
  }
  flush(materials: Record<Role, T.Material>) {
    for (const [role, pieces] of this.buckets) {
      const geometry = mergeGeometries(pieces, false);
      pieces.forEach((g) => g.dispose());
      if (!geometry) throw new Error(`Incompatible ${this.name} ${role} geometry`);
      geometry.computeBoundingSphere();
      geometry.computeBoundingBox();
      const mesh = new T.Mesh(geometry, materials[role]);
      mesh.name = `${this.name} / ${role}`;
      mesh.castShadow = mesh.receiveShadow = true;
      this.root.add(mesh);
    }
    this.buckets.clear();
    return this.root;
  }
}

function siteTransform(site: MxCourseSite) {
  return new T.Matrix4().makeRotationY(site.yaw).setPosition(site.x, site.y, site.z);
}

function localGround(track: Track, site: MxCourseSite, x: number, z: number) {
  const worldX = site.x + Math.cos(site.yaw) * x + Math.sin(site.yaw) * z,
    worldZ = site.z - Math.sin(site.yaw) * x + Math.cos(site.yaw) * z;
  return mxFurnitureGround(track, worldX, worldZ) - site.y;
}

/** Folded roof sheets have an actual wavy silhouette and eave thickness,
 * with a crest cap covering the seam between the two roof slopes. */
function barnRoof(side: number) {
  const vertices: number[] = [],
    uv: number[] = [],
    index: number[] = [],
    across = 24,
    along = 128;
  for (let j = 0; j <= along; j++)
    for (let i = 0; i <= across; i++) {
      const x = (i / across) * 5.85,
        z = -4.3 + (j / along) * 8.6,
        rib = Math.cos((z / 0.26) * Math.PI * 2) * 0.023;
      vertices.push(side * x, 6.25 - (x / 5.85) * 2.2 + rib, z);
      uv.push(i / across, j / along);
    }
  for (let j = 0; j < along; j++)
    for (let i = 0; i < across; i++) {
      const a = j * (across + 1) + i,
        b = a + 1,
        c = a + across + 1,
        d = c + 1;
      if (side > 0) index.push(a, c, b, b, c, d);
      else index.push(a, b, c, b, d, c);
    }
  const geometry = new T.BufferGeometry();
  geometry.setAttribute('position', new T.Float32BufferAttribute(vertices, 3));
  geometry.setAttribute('uv', new T.Float32BufferAttribute(uv, 2));
  geometry.setIndex(index);
  geometry.computeVertexNormals();
  return geometry;
}

function buildBarn(track: Track, site: MxCourseSite) {
  const b = new LandmarkBuilder(site.name, siteTransform(site)),
    random = new Random(42035),
    wood = () => new T.Color(0x827060).multiplyScalar(0.82 + random.next() * 0.28),
    trim = 0xb5b09a,
    zinc = 0x778684;
  let floor = 0;
  for (const x of [-5.5, 0, 5.5])
    for (const z of [-3.8, 0, 3.8]) floor = Math.max(floor, localGround(track, site, x, z) + 0.12);
  b.box('rock', 0x7b7970, [11, 0.22, 7.6], [0, floor, 0]);
  // A level floor needs a continuous foundation on this sloping site.
  // Short plinth sections follow the ground below the slab; their bottoms
  // sit below all sampled edges so the join cannot expose a daylight gap.
  const plinth = (x: number, z: number, width: number, depth: number) => {
    let bottom = Infinity;
    for (const u of [-0.5, 0, 0.5])
      for (const v of [-0.5, 0, 0.5])
        bottom = Math.min(bottom, localGround(track, site, x + u * width, z + v * depth) - 0.12);
    const top = floor - 0.06;
    b.box('rock', 0x73746a, [width, top - bottom, depth], [x, (top + bottom) / 2, z]);
  };
  for (let i = 0; i < 22; i++) for (const z of [-3.65, 3.65]) plinth(-5.25 + i * 0.5, z, 0.5, 0.3);
  for (let i = 0; i < 14; i++) for (const x of [-5.35, 5.35]) plinth(x, -3.25 + i * 0.5, 0.3, 0.5);
  for (const x of [-5.3, -1.9, 1.9, 5.3])
    for (const z of [-3.7, 3.7]) {
      const ground = localGround(track, site, x, z) - 0.08,
        top = floor + 4.12;
      b.box('timber', 0x60584b, [0.22, top - ground, 0.24], [x, (top + ground) / 2, z]);
      b.box('rock', 0x75766c, [0.42, 0.36, 0.44], [x, ground + 0.15, z]);
    }
  // Separate front door bays leave a real, shadowed opening through the barn.
  for (let i = 0; i < 48; i++) {
    const x = -5.5 + ((i + 0.5) * 11) / 48;
    b.box('timber', wood(), [0.221, 4.0, 0.095], [x, floor + 2.05, 3.8]);
    if (Math.abs(x) > 1.9) b.box('timber', wood(), [0.221, 4.0, 0.095], [x, floor + 2.05, -3.8]);
    const gable = 2.07 * (1 - Math.abs(x) / 5.5);
    if (gable > 0.025)
      for (const z of [-3.8, 3.8])
        b.box('timber', wood(), [0.221, gable, 0.095], [x, floor + 4.05 + gable / 2, z]);
  }
  for (let i = 0; i < 32; i++)
    for (const side of [-1, 1])
      b.box(
        'timber',
        wood(),
        [0.1, 4.0, 0.228],
        [side * 5.5, floor + 2.05, -3.8 + ((i + 0.5) * 7.6) / 32],
      );
  // Sliding doors sit to either side of the opening; visible diagonal bracing.
  for (const side of [-1, 1]) {
    b.box('timber', 0x625f4f, [1.86, 3.3, 0.11], [side * 2.88, floor + 1.76, -3.94]);
    for (const y of [floor + 0.18, floor + 3.32])
      b.box('paint', trim, [1.89, 0.095, 0.04], [side * 2.88, y, -4.02]);
    b.rod(
      'paint',
      trim,
      [side * 1.97, floor + 0.2, -4.035],
      [side * 3.79, floor + 3.28, -4.035],
      0.06,
      4,
    );
    b.rod(
      'metal',
      zinc,
      [side * 1.94, floor + 3.58, -3.99],
      [side * 4.04, floor + 3.58, -3.99],
      0.04,
    );
    const roof = barnRoof(side).translate(0, floor, 0);
    b.add('metal', roof, zinc);
    b.add(
      'paint',
      new T.PlaneGeometry(Math.hypot(5.85, 2.2), 8.6)
        .rotateX(-Math.PI / 2)
        .rotateZ(-side * Math.atan2(2.2, 5.85))
        .translate(side * 2.925, floor + 5.115, 0),
      0x4f5c57,
    );
    for (const z of [-4.32, 4.32]) {
      b.rod('paint', trim, [0, floor + 6.21, z], [side * 5.85, floor + 4.0, z], 0.09, 4);
      b.rod(
        'timber',
        0x524d42,
        [0, floor + 6.04, z * 0.86],
        [side * 5.42, floor + 4.05, z * 0.86],
        0.1,
        4,
      );
    }
    b.rod(
      'metal',
      zinc,
      [side * 5.82, floor + 4.06, -4.35],
      [side * 5.82, floor + 4.06, 4.35],
      0.065,
    );
  }
  b.rod('metal', 0xa2ada2, [0, floor + 6.27, -4.4], [0, floor + 6.27, 4.4], 0.1, 10);
  for (const z of [-3.6, 0, 3.6])
    b.box('timber', 0x625847, [10.8, 0.16, 0.15], [0, floor + 4.02, z]);
  b.box('paint', 0x263c36, [3.15, 0.57, 0.12], [0, floor + 4.58, -3.94]);
  // An original painted chevron crest keeps the building identifiable from
  // behind the bike without importing a sponsor logo or a photograph.
  for (const side of [-1, 1])
    b.rod(
      'paint',
      0xddc087,
      [side * 0.66, floor + 4.5, -4.015],
      [0, floor + 4.76, -4.015],
      0.075,
      4,
    );
  return b;
}

function quarryMass(seed: number, size: V3) {
  const geometry = new T.IcosahedronGeometry(1, 3),
    position = geometry.getAttribute('position');
  for (let i = 0; i < position.count; i++) {
    const x = position.getX(i),
      y = position.getY(i),
      z = position.getZ(i),
      stratum = Math.sin((y + x * 0.25) * 17 + seed),
      fracture = Math.sin(x * 9.7 + z * 8.3 + seed) * Math.sin(y * 7.1 - z * 5.6),
      radius = 1 + 0.065 * stratum + 0.1 * fracture;
    position.setXYZ(
      i,
      x * size[0] * radius,
      (y + 1) * 0.5 * size[1] * (1 + fracture * 0.11),
      z * size[2] * radius,
    );
  }
  geometry.computeVertexNormals();
  return geometry;
}

function buildQuarry(track: Track, site: MxCourseSite) {
  const b = new LandmarkBuilder(site.name, siteTransform(site)),
    random = new Random(61041);
  for (const [x, z, width, height, depth] of [
    [-3.9, 0.1, 3.8, 4.8, 2.9],
    [0.1, 0.65, 4.4, 6.1, 3.1],
    [4.25, 0.1, 3.4, 3.9, 2.5],
  ]) {
    const y = localGround(track, site, x, z) - 0.5;
    b.add(
      'rock',
      quarryMass(x + 3, [width, height, depth])
        .rotateY(x * 0.03)
        .translate(x, y, z),
      0x82847b,
    );
  }
  for (let i = 0; i < 28; i++) {
    const x = (random.next() - 0.5) * 15,
      z = -2.8 + random.next() * 0.8,
      scale = 0.18 + random.next() * 0.4,
      y = localGround(track, site, x, z) - 0.13;
    b.add(
      'rock',
      quarryMass(i * 1.7, [scale * 1.4, scale, scale])
        .rotateY(random.next() * 5)
        .translate(x, y, z),
      new T.Color(0x88877a).multiplyScalar(0.82 + random.next() * 0.25),
    );
  }
  return b;
}

function buildDeck(track: Track, site: MxCourseSite) {
  const b = new LandmarkBuilder(site.name, siteTransform(site)),
    random = new Random(35042),
    metal = 0x87918b,
    timber = 0x897762,
    green = 0x53654a;
  let deck = 2.1;
  for (const x of [-3.6, 3.6])
    for (const z of [-1.8, 1.8]) deck = Math.max(deck, localGround(track, site, x, z) + 2.1);
  for (const x of [-3.6, 0, 3.6])
    for (const z of [-1.8, 1.8]) {
      const ground = localGround(track, site, x, z) - 0.05;
      b.box('metal', metal, [0.16, deck - ground + 1.1, 0.16], [x, (ground + deck + 1.1) / 2, z]);
      b.box('rock', 0x8c8d81, [0.55, 0.22, 0.55], [x, ground + 0.09, z]);
    }
  for (const z of [-1.8, 1.8]) {
    b.rod('metal', metal, [-3.6, 0.3, z], [0, deck - 0.18, z], 0.042);
    b.rod('metal', metal, [0, 0.3, z], [3.6, deck - 0.18, z], 0.042);
    b.box('metal', metal, [7.4, 0.23, 0.16], [0, deck - 0.17, z]);
    for (const y of [deck + 0.53, deck + 1.08]) {
      if (z < 0) b.rod('metal', metal, [-3.7, y, z], [3.7, y, z], 0.038);
      else {
        b.rod('metal', metal, [-3.7, y, z], [-0.75, y, z], 0.038);
        b.rod('metal', metal, [0.75, y, z], [3.7, y, z], 0.038);
      }
    }
  }
  for (const x of [-3.6, 3.6])
    for (const y of [deck + 0.53, deck + 1.08])
      b.rod('metal', metal, [x, y, -1.8], [x, y, 1.8], 0.038);
  for (let i = 0; i < 28; i++)
    b.box(
      'timber',
      new T.Color(timber).multiplyScalar(0.86 + random.next() * 0.2),
      [0.255, 0.095, 3.7],
      [-3.65 + i * 0.27, deck, 0],
    );
  // Back steps and rails have an actual path to the deck, rather than an
  // inaccessible slab on poles. These also remain inside the reserved site.
  const ground = localGround(track, site, 0, 4.3),
    steps = Math.ceil((deck - ground) / 0.24);
  for (let i = 0; i <= steps; i++) {
    const u = i / steps,
      y = ground + (deck - ground) * u,
      z = 4.35 - u * 2.5;
    b.box('metal', metal, [1.35, 0.065, 0.28], [0, y, z]);
  }
  for (const x of [-0.71, 0.71]) {
    b.rod('metal', metal, [x, ground, 4.42], [x, deck, 1.8], 0.075, 4);
    b.rod('metal', metal, [x, ground + 0.9, 4.42], [x, deck + 0.9, 1.8], 0.035);
    for (const [z, y] of [
      [4.42, ground],
      [1.8, deck],
    ])
      b.rod('metal', metal, [x, y, z], [x, y + 0.94, z], 0.032);
  }
  const canopyHeight = (x: number, z: number) => {
    const sag = Math.sin(((x + 3.675) / 7.35) * Math.PI) * Math.cos((z / 3.8) * Math.PI) * 0.16;
    return deck + 3.1 + 0.28 * (1 - Math.abs(z) / 1.9) - sag;
  };
  // A small overlap covers interpolation between the fabric's vertices.
  for (const x of [-3.45, 3.45])
    for (const z of [-1.6, 1.6])
      b.rod('metal', metal, [x, deck, z], [x, canopyHeight(x, z) + 0.012, z], 0.045);
  const canopy = new T.PlaneGeometry(7.35, 3.8, 20, 12).rotateX(-Math.PI / 2),
    p = canopy.getAttribute('position');
  for (let i = 0; i < p.count; i++) {
    const x = p.getX(i),
      z = p.getZ(i);
    p.setY(i, canopyHeight(x, z));
  }
  canopy.computeVertexNormals();
  b.add('paint', canopy, green);
  for (const z of [-1.87, 1.87])
    b.box('paint', green, [7.35, 0.2, 0.035], [0, canopyHeight(0, z) - 0.095, z]);
  return b;
}

function addGuide(b: LandmarkBuilder, guide: MxJumpGuide, atlasRows: number, track: Track) {
  const transform = new T.Matrix4().makeRotationY(guide.yaw).setPosition(guide.x, guide.y, guide.z),
    add = (role: Role, g: T.BufferGeometry, color: number) =>
      b.add(role, g.applyMatrix4(transform), color);
  for (const x of [-0.94, 0.94]) {
    const wx = guide.x + Math.cos(guide.yaw) * x,
      wz = guide.z - Math.sin(guide.yaw) * x,
      foot = mxFurnitureGround(track, wx, wz) - guide.y - 0.08,
      top = 1.45;
    add(
      'metal',
      new T.CylinderGeometry(0.026, 0.035, top - foot, 6).translate(x, (top + foot) / 2, 0),
      0x8a9790,
    );
  }
  add('paint', new T.BoxGeometry(2.5, 0.69, 0.055).translate(0, 1.19, 0), 0x293c37);
  const face = new T.PlaneGeometry(2.46, 0.615).translate(0, 1.19, 0.032),
    uv = face.getAttribute('uv');
  for (let i = 0; i < uv.count; i++)
    uv.setY(i, (atlasRows - guide.index - 1 + 0.015 + uv.getY(i) * 0.97) / atlasRows);
  add('guide', face, 0xffffff);
}

/** Original track identities informed by archive 035/041/042/044/059. The
 * barn is an original Valley Ridge landmark, not a copy of a source venue.
 * Placement is shared with clearance tests; meshes never alter wheel contact. */
export class MxCourseLandmarks {
  readonly root = new T.Group();
  readonly plan: ReturnType<typeof planMxCourseSites>;
  readonly triangles: number;
  readonly draws: number;
  private readonly atlas: T.Texture;
  private readonly materials: Record<Role, T.MeshStandardMaterial>;
  constructor(track: Track) {
    const surface = Track.offroadOf(track);
    if (
      !(surface instanceof TrackTerrainSurface) ||
      !['motocross', 'supercross'].includes(surface.kind)
    )
      throw new Error('Course landmarks require an MX or SX track');
    this.root.name = 'MX course identities and surveyed jump guides';
    this.plan = planMxCourseSites(track);
    const atlas = guideAtlas(surface.course);
    this.atlas = atlas.texture;
    this.materials = landmarkMaterials(atlas.texture, this.plan.landmarks.length > 0);
    // The thin canopy has a visible woven underside, without adding another
    // mesh or shadow caster. Opaque sign backs remain closed solid plates.
    this.materials.paint.side = T.DoubleSide;
    for (const site of this.plan.landmarks) {
      const builder =
        site.kind === 'barn'
          ? buildBarn(track, site)
          : site.kind === 'quarry'
            ? buildQuarry(track, site)
            : buildDeck(track, site);
      const root = builder.flush(this.materials);
      root.userData.site = { ...site };
      this.root.add(root);
    }
    const guides = new LandmarkBuilder('MX advance jump profile boards');
    this.plan.guides.forEach((guide) => addGuide(guides, guide, atlas.rows, track));
    this.root.add(guides.flush(this.materials));
    let triangles = 0,
      draws = 0;
    this.root.traverse((object) => {
      if (!(object instanceof T.Mesh)) return;
      draws++;
      triangles += object.geometry.getAttribute('position').count / 3;
    });
    this.triangles = triangles;
    this.draws = draws;
    this.root.userData.landmarkBudget = { draws, triangles };
    if (draws > MX_LANDMARK_BUDGET.draws || triangles > MX_LANDMARK_BUDGET.triangles) {
      this.dispose();
      throw new Error(
        `MX course detail exceeds its static budget: ${draws} draws / ${triangles} triangles`,
      );
    }
  }
  dispose() {
    this.root.traverse((object) => {
      if (object instanceof T.Mesh) object.geometry.dispose();
    });
    Object.values(this.materials).forEach((material) => material.dispose());
    this.atlas.dispose();
    this.root.clear();
  }
}
