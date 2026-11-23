import * as T from 'three';
import { chainShaderHook, injectAfter } from '../studio/shader-hooks.ts';
import { Random } from '../../core/math.ts';

/** Coarse gravel breaks the perfectly flat silhouette at the apron. Smaller
 * grains, rake ridges and distant coverage stay on the underlying surface. */
export const GP_TRAP_STONE_LIMIT = 420;
const UP = new T.Vector3(0, 1, 0);

function washedStone() {
  // The partly buried base is deliberately open. The asymmetric shoulder
  // catches a narrow highlight; soft vertex normals round the chipped faces.
  const pos: number[] = [], colors: number[] = [], indices: number[] = [];
  const rim = [[1,.04], [.53,.82], [-.27,1], [-.9,.5], [-.93,-.4], [-.29,-.94], [.64,-.72]];
  for (let k = 0; k < 2; k++) {
    const radius = k ? .72 : 1;
    for (let i = 0; i < rim.length; i++) {
      const [x, z] = rim[i];
      pos.push(x * radius + .06 * k, k ? .36 + .09 * Math.sin(i * 2.2) : -.13, z * radius);
      const shade = k ? .94 : .63;
      colors.push(shade, shade, shade);
    }
  }
  const tip = pos.length / 3;
  pos.push(.17,.72,-.09);
  colors.push(1,1,1);
  for (let i = 0; i < rim.length; i++) {
    const j = (i + 1) % rim.length, n = rim.length;
    indices.push(i, i+n, j, j, i+n, j+n, i+n, tip, j+n);
  }
  const g = new T.BufferGeometry();
  g.setAttribute('position', new T.Float32BufferAttribute(pos, 3));
  g.setAttribute('color', new T.Float32BufferAttribute(colors, 3));
  g.setIndex(indices);
  g.computeVertexNormals();
  g.computeBoundingSphere();
  return g;
}

const STONE_PALETTE: Record<string, readonly number[]> = {
  'poggio-alto': [0xa89b85, 0xc3b196, 0x91877a, 0xa18d76],
  'cape-wrenna': [0xa5a49a, 0xb5ae9f, 0x807f79, 0xaca89b],
  haarveld: [0xa19b8a, 0xb6af9b, 0x858579, 0xa29582],
  montejaral: [0xb39a82, 0xcbad8e, 0x96846e, 0xab8b71],
};

/** One reusable grain and one light-receiving material per circuit. Sampling
 * the actual indexed bed follows its grade, banking and clipped trap ends. */
export class GpTrapAggregate {
  private readonly geometry = washedStone();
  private readonly material = new T.MeshStandardMaterial({
    name: 'GP washed trap aggregate', vertexColors: true, roughness: .91,
  });
  private readonly palette: readonly number[];
  constructor(venue: string) {
    this.palette = STONE_PALETTE[venue] ?? STONE_PALETTE['poggio-alto'];
    chainShaderHook(this.material, 'gp-trap-stone-lod-v1', (shader) => {
      injectAfter(shader, 'begin_vertex', `
float gpStoneDepth=max(.01,-(modelViewMatrix*instanceMatrix[3]).z);
float gpStoneRadius=max(length(instanceMatrix[0].xyz),length(instanceMatrix[2].xyz));
float gpStoneScreen=gpStoneRadius*projectionMatrix[1][1]/gpStoneDepth;
transformed*=smoothstep(.00030,.00145,gpStoneScreen);`, 'vertex');
    });
  }

  scatter(bed: T.BufferGeometry, seed: number) {
    const idx = bed.index, pos = bed.getAttribute('position');
    const cover = bed.getAttribute('gravelCover'), inset = bed.getAttribute('gpTrapInset');
    if (!idx || !cover || !inset || !idx.count) return null;
    const rng = new Random(seed), a = new T.Vector3(), b = new T.Vector3(), c = new T.Vector3();
    const ab = new T.Vector3(), ac = new T.Vector3(), normal = new T.Vector3();
    const area = new Float64Array(idx.count / 3);
    let total = 0;
    for (let i = 0; i < idx.count; i += 3) {
      a.fromBufferAttribute(pos, idx.getX(i));
      b.fromBufferAttribute(pos, idx.getX(i+1));
      c.fromBufferAttribute(pos, idx.getX(i+2));
      total += normal.crossVectors(ab.subVectors(b,a), ac.subVectors(c,a)).length() * .5;
      area[i/3] = total;
    }
    const budget = Math.min(GP_TRAP_STONE_LIMIT, Math.floor(total * 1.35));
    if (!budget) return null;
    const mesh = new T.InstancedMesh(this.geometry, this.material, budget);
    const pose = new T.Object3D(), tint = new T.Color();
    let used = 0, triangle = 0;
    // Stratifying triangle area also bounds startup cost on a broad escape bed.
    for (let k = 0; k < budget; k++) {
      const target = (k+rng.next()) * total / budget;
      while (triangle < area.length-1 && area[triangle] <= target) triangle++;
      const ia = idx.getX(3*triangle), ib = idx.getX(3*triangle+1), ic = idx.getX(3*triangle+2);
      const root = Math.sqrt(rng.next()), u = 1-root, v = root*rng.next(), w = 1-u-v;
      // Preserve the real paint boundary and the sparse turf transition.
      const depth = u*inset.getX(ia) + v*inset.getX(ib) + w*inset.getX(ic);
      const covered = u*cover.getX(ia) + v*cover.getX(ib) + w*cover.getX(ic);
      if (depth < .072 || covered < .85) continue;
      a.fromBufferAttribute(pos, ia);
      b.fromBufferAttribute(pos, ib);
      c.fromBufferAttribute(pos, ic);
      normal.crossVectors(ab.subVectors(b,a), ac.subVectors(c,a)).normalize();
      if (normal.y < 0) normal.negate();
      pose.position.copy(a).multiplyScalar(u).addScaledVector(b,v).addScaledVector(c,w);
      pose.quaternion.setFromUnitVectors(UP, normal);
      pose.rotateY(rng.next()*Math.PI*2);
      const size = .009 + .017*rng.next()**2;
      pose.scale.set(size * (1 + .47*rng.next()), size * (.66 + .4*rng.next()), size);
      pose.updateMatrix();
      mesh.setMatrixAt(used, pose.matrix);
      tint.setHex(this.palette[Math.floor(rng.next()*this.palette.length)]).multiplyScalar(.88+.2*rng.next());
      mesh.setColorAt(used++, tint);
    }
    mesh.count = used;
    if (!used) {
      mesh.dispose();
      return null;
    }
    mesh.name = 'GP gravel trap coarse stones';
    mesh.receiveShadow = true;
    mesh.computeBoundingBox();
    mesh.computeBoundingSphere();
    return mesh;
  }
}
