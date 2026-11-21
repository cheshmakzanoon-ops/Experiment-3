import * as T from 'three';
import { Random } from '../../core/math.ts';
import type { Track } from '../../simulation/track.ts';
import { terrainSurface } from '../terrain-surface.ts';
import { terrainFor } from '../terrain.ts';
import { valueNoise } from '../terrain-profile.ts';
import { onMxDetail } from './mx-quality.ts';
import { disposeOffroadResources } from './owned-resources.ts';

/** Opaque crowns at 0.7–1.7 km. The narrow layered conifers and off-centre
 * deciduous crowns retain their silhouette from either side of a ridge.
 * Their trunks, lower shade and upper leaves share a single material. */
function ridgeTree(conifer: boolean) {
  const rings = conifer
    ? [
        [0, 0.035],
        [0.32, 0.035],
        [0.24, 0.81],
        [0.51, 0.47],
        [0.44, 0.73],
        [0.68, 0.36],
        [0.64, 0.49],
        [0.86, 0.17],
        [0.83, 0.22],
      ]
    : [
        [0, 0.045],
        [0.3, 0.055],
        [0.33, 0.51],
        [0.46, 0.86],
        [0.64, 1],
        [0.83, 0.84],
        [0.94, 0.48],
      ];
  const sides = conifer ? 7 : 8,
    pos: number[] = [],
    colours: number[] = [],
    ix: number[] = [];
  const bark = new T.Color(0x474337),
    low = new T.Color(conifer ? 0x34483f : 0x454f39);
  const high = new T.Color(conifer ? 0x617367 : 0x79835e),
    tint = new T.Color();
  for (let r = 0; r < rings.length; r++) {
    const [y, radius] = rings[r];
    for (let i = 0; i < sides; i++) {
      const a = (2 * Math.PI * i) / sides + (conifer ? (r % 2) * 0.13 : r * 0.17);
      const asym = 1 + 0.08 * Math.sin(3 * a + 0.84 * r) + 0.045 * Math.cos(2 * a - 0.8);
      const limb = !conifer && r > 1 ? 0.13 * Math.sin(y * 4.2) : 0;
      pos.push(
        radius * Math.cos(a) * asym + limb,
        y + (r > 1 ? 0.018 * Math.sin(3 * a + r) : 0),
        radius * Math.sin(a) * asym,
      );
      if (r < 2) tint.copy(bark);
      else tint.copy(low).lerp(high, 0.12 + 0.59 * y + 0.13 * Math.sin(2 * a + r));
      colours.push(tint.r, tint.g, tint.b);
      if (r > 0) {
        const prev = (r - 1) * sides + i,
          next = (r - 1) * sides + ((i + 1) % sides);
        ix.push(prev, prev + sides, next, next, prev + sides, next + sides);
      }
    }
  }
  const top = pos.length / 3;
  pos.push(conifer ? 0.025 : -0.09, 1, 0.025);
  colours.push(high.r, high.g, high.b);
  const last = (rings.length - 1) * sides;
  for (let i = 0; i < sides; i++) ix.push(last + i, top, last + ((i + 1) % sides));
  if (!conifer) {
    // Lateral scaffold limbs break the single round crown on the skyline.
    // The two asymmetric leaf masses meet the main crown along their backs.
    for (const [azimuth, spread, mid, breadth] of [[0.45, 0.64, 0.57, 0.55], [3.31, 0.77, 0.65, 0.48]]) {
      const base = pos.length / 3;
      const dx = Math.cos(azimuth), dz = Math.sin(azimuth);
      pos.push(dx * 0.39, mid - 0.19, dz * 0.39);
      colours.push(low.r, low.g, low.b);
      for (const ring of [0, 1]) {
        for (let j = 0; j < 5; j++) {
          const a = azimuth + (j + ring * 0.41) * Math.PI * 2 / 5;
          const r = breadth * (ring ? 0.82 : 1) * (1 + 0.1 * Math.sin(3 * a));
          pos.push(dx * spread + r * Math.cos(a), mid + 0.14 * ring + 0.022 * Math.sin(2 * a), dz * spread + r * Math.sin(a));
          tint.copy(low).lerp(high, 0.23 + ring * 0.43 + 0.08 * Math.cos(a));
          colours.push(tint.r, tint.g, tint.b);
        }
      }
      pos.push(dx * (spread + 0.06), mid + 0.25, dz * (spread + 0.06));
      colours.push(high.r, high.g, high.b);
      for (let j = 0; j < 5; j++) {
        const k = base + 1 + j, n = base + 1 + (j + 1) % 5;
        ix.push(base, k, n, k, k + 5, n, n, k + 5, n + 5, k + 5, base + 11, n + 5);
      }
    }
  }
  const geometry = new T.BufferGeometry();
  geometry.setAttribute('position', new T.Float32BufferAttribute(pos, 3));
  geometry.setAttribute('color', new T.Float32BufferAttribute(colours, 3));
  geometry.setIndex(ix);
  geometry.computeVertexNormals();
  return geometry;
}

export class MxRidgeWoodland {
  readonly root = new T.Group();
  private readonly release: () => void;
  constructor(track: Track) {
    this.root.name = 'Valley Ridge distant woodland';
    const ground = terrainSurface(terrainFor(track)),
      shapes = [ridgeTree(false), ridgeTree(true)];
    const material = new T.MeshLambertMaterial({
      vertexColors: true,
      name: 'Distant woodland canopy',
    });
    const cx = track.points.reduce((s, p) => s + p.x, 0) / track.points.length;
    const cz = track.points.reduce((s, p) => s + p.z, 0) / track.points.length;
    const stamp = new T.Object3D(),
      tint = new T.Color(),
      batches: T.InstancedMesh[] = [];
    for (let ridge = 0; ridge < 2; ridge++) {
      const random = new Random(51721 + ridge * 73),
        transforms: T.Matrix4[][] = [[], []],
        grades: T.Color[][] = [[], []];
      // A copse follows the grade for tens of metres. Gaps between copses
      // leave the skyline open and expose the ground on the windward faces.
      for (let cluster = 0; cluster < 113; cluster++) {
        // Relatively prime stride keeps a thin graphics preset spread across the whole hillside.
        const station = (((cluster * 53) % 113) - 56) * 19 + random.next() * 12;
        const depth = (random.next() - 0.5) * 112;
        if (valueNoise(station / 133 + ridge * 3, depth / 104 + 3) < 0.32) continue;
        const n = 2 + Math.floor(random.next() * 4);
        for (let i = 0; i < n; i++) {
          const along = station + (random.next() - 0.5) * 33;
          const across = depth + (random.next() - 0.5) * 30;
          let x: number, z: number;
          if (ridge === 0) {
            const crest = 810 + 56 * Math.sin(along / 225) + across;
            x = 0.91 * along - 0.415 * crest;
            z = 0.415 * along + 0.91 * crest;
          } else {
            z = along + 0.57 * across;
            x = (-1240 - 115 * Math.sin(along / 440) - 0.57 * along) / 0.82 + 0.82 * across;
          }
          x += cx;
          z += cz;
          const pine = random.next() < (ridge === 0 ? 0.42 : 0.72),
            type = pine ? 1 : 0;
          const h = (pine ? 16 : 12) + random.next() * 11,
            w = h * (pine ? 0.19 + random.next() * 0.08 : 0.28 + random.next() * 0.14);
          stamp.position.set(x, ground.height(x, z) - 1.2, z);
          stamp.rotation.y = random.next() * 2 * Math.PI;
          stamp.scale.set(w, h, w * (0.89 + 0.2 * random.next()));
          stamp.updateMatrix();
          transforms[type].push(stamp.matrix.clone());
          const age = 0.79 + 0.24 * random.next();
          grades[type].push(
            tint.setRGB(age, age * (0.96 + 0.06 * random.next()), age * 0.94).clone(),
          );
        }
      }
      for (let type = 0; type < 2; type++) {
        const instances = transforms[type],
          mesh = new T.InstancedMesh(shapes[type], material, instances.length);
        mesh.name = (ridge === 0 ? 'Near ridge ' : 'Far ridge ') + (type ? 'spruce' : 'hardwoods');
        for (let i = 0; i < instances.length; i++) {
          mesh.setMatrixAt(i, instances[i]);
          mesh.setColorAt(i, grades[type][i]);
        }
        mesh.computeBoundingSphere();
        mesh.userData.fullCount = mesh.count;
        batches.push(mesh);
        this.root.add(mesh);
      }
    }
    this.release = onMxDetail((high) => {
      for (const batch of batches)
        batch.count = high ? batch.userData.fullCount : Math.ceil(batch.userData.fullCount * 0.42);
    });
  }
  dispose() {
    this.release();
    disposeOffroadResources([this.root]);
  }
}
