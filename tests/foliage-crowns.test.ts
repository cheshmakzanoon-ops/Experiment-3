import { describe, expect, it } from 'vitest';
import * as T from 'three';
import { installFoliageAtlas, treeGeometry } from '../src/rendering/landscape.ts';

function shaderFor(material: T.Material, kind: 'standard' | 'depth' | 'distanceRGBA') {
  const shader = {
    ...T.ShaderLib[kind],
    uniforms: T.UniformsUtils.clone(T.ShaderLib[kind].uniforms),
  } as T.WebGLProgramParametersWithUniforms;
  material.onBeforeCompile(shader, {} as T.WebGLRenderer);
  return shader;
}

/** CPU mirror of the shader's foliageCrown (per-instance crown shaping). */
function crown(p: T.Vector3, c: T.Vector3, tile: number, h: readonly number[]) {
  const reach = tile === 1 ? 1.18 : tile === 3 ? 0.66 + 0.16 * h[0] : 0.92 + 0.2 * h[0];
  const centre = c.clone(),
    local = p.clone().sub(c);
  centre.y = 1.02 - (1.02 - centre.y) * reach;
  local.y *= reach;
  if (tile === 1 && centre.x * centre.x + centre.z * centre.z > 0.0001) {
    const cone = Math.min(1, Math.max(0.2, (1.02 - centre.y) / 0.98));
    centre.x *= cone;
    centre.z *= cone;
    local.x *= 0.55 + 0.45 * cone;
    local.z *= 0.55 + 0.45 * cone;
  }
  const open = new T.Vector2(h[1] - 0.5 + 0.001, h[2] - 0.5 + 0.001).normalize();
  const radial = new T.Vector2(centre.x + 0.00001, centre.z + 0.00001).normalize();
  const lobe = 1 + (tile === 1 ? 0.06 : 0.18) * radial.dot(open);
  centre.x *= lobe;
  centre.z *= lobe;
  const t = Math.min(1, Math.max(0, (centre.y - 0.15) / 0.85)),
    lean = (0.03 + 0.04 * h[0]) * t * t * (3 - 2 * t);
  centre.x += open.x * lean;
  centre.z += open.y * lean;
  const shaped = centre.add(local);
  shaped.y = Math.max(shaped.y, 0);
  return shaped;
}

describe('shaped foliage crowns', () => {
  const { leafGeometry, trunkGeometry, distantLeafGeometry } = treeGeometry();
  it('gives every card one centre, and inner clump cards a crown window and an edge mask', () => {
    for (const geometry of [leafGeometry, distantLeafGeometry]) {
      const centre = geometry.getAttribute('cardCentre'),
        mask = geometry.getAttribute('cardMask'),
        uv = geometry.getAttribute('uv'),
        position = geometry.getAttribute('position');
      expect(centre.count).toBe(position.count);
      expect(mask.count).toBe(position.count);
      let silhouette = 0,
        inner = 0;
      for (let i = 0; i < position.count; i++) {
        expect(uv.getX(i)).toBeGreaterThanOrEqual(0);
        expect(uv.getX(i)).toBeLessThanOrEqual(1);
        expect(uv.getY(i)).toBeGreaterThanOrEqual(0);
        expect(uv.getY(i)).toBeLessThanOrEqual(1);
        if (Math.hypot(centre.getX(i), centre.getZ(i)) === 0) {
          // Silhouette cards stand on the trunk axis and show the whole crown.
          silhouette++;
          expect([mask.getX(i), mask.getY(i)]).toEqual([0, 0]);
        } else {
          // A window into the crown, never the whole tile (a miniature tree),
          // masked from the card centre (0) to its edge (1).
          inner++;
          expect(Math.hypot(centre.getX(i), centre.getZ(i))).toBeGreaterThan(0.1);
          expect(Math.max(Math.abs(mask.getX(i)), Math.abs(mask.getY(i)))).toBeLessThanOrEqual(1);
        }
      }
      expect(silhouette).toBeGreaterThan(0);
      expect(inner).toBe(geometry === leafGeometry ? 12 * 9 : 0);
    }
  });
  it('keeps every shaped crown inside its culling bounds and the silhouettes distinct', () => {
    const p = new T.Vector3(),
      c = new T.Vector3();
    for (const geometry of [leafGeometry, distantLeafGeometry]) {
      const box = geometry.boundingBox!,
        position = geometry.getAttribute('position'),
        centre = geometry.getAttribute('cardCentre');
      expect(
        box.containsBox(new T.Box3().setFromBufferAttribute(position as T.BufferAttribute)),
      ).toBe(true);
      for (let tile = 0; tile < 4; tile++) {
        let lowest = Infinity;
        for (const hx of [0, 0.5, 1])
          for (let a = 0; a < 16; a++) {
            const h = [hx, 0.5 + 0.5 * Math.cos(a * 0.39), 0.5 + 0.5 * Math.sin(a * 0.39)];
            for (let i = 0; i < position.count; i++) {
              p.fromBufferAttribute(position, i);
              c.fromBufferAttribute(centre, i);
              const shaped = crown(p, c, tile, h);
              expect(box.containsPoint(shaped), `tile ${tile} ${shaped.toArray()}`).toBe(true);
              lowest = Math.min(lowest, shaped.y);
            }
          }
        if (geometry !== leafGeometry) continue;
        // Conifers carry foliage to the ground; broadleaf crowns start low on
        // the trunk; open crowns sit on a clear trunk.
        if (tile === 1) expect(lowest).toBeLessThan(0.06);
        else if (tile === 3) expect(lowest).toBeGreaterThan(0.3);
        else expect(lowest).toBeLessThan(0.27);
      }
    }
    expect(trunkGeometry.getAttribute('cardCentre')).toBeUndefined();
  });
  it('shapes colour, depth and point-shadow passes identically, with crown occlusion on colour only', () => {
    for (const [m, kind] of [
      [new T.MeshStandardMaterial({ side: T.DoubleSide, alphaTest: 0.45 }), 'standard'],
      [new T.MeshDepthMaterial({ side: T.DoubleSide, alphaTest: 0.45 }), 'depth'],
      [new T.MeshDistanceMaterial({ side: T.DoubleSide, alphaTest: 0.45 }), 'distanceRGBA'],
    ] as const) {
      installFoliageAtlas(m);
      const s = shaderFor(m, kind);
      expect(s.vertexShader).toContain(
        'transformed = foliageCrown(transformed, cardCentre, instanceMatrix)',
      );
      expect(s.vertexShader).toContain('attribute vec3 cardCentre');
      expect(s.fragmentShader).toContain(
        'diffuseColor.a *= 1. - smoothstep(.45, .85, length(vCardMask)',
      );
      expect(s.vertexShader.includes('vColor *= mix(.74')).toBe(kind === 'standard');
      expect(m.customProgramCacheKey()).toContain('four-original-planting-crowns-v3');
      m.dispose();
    }
  });
});
