import { describe, it, expect } from 'vitest';
import * as T from 'three';
import {
  acquireGpCrowdAtlas,
  GP_FAN_VIEWS,
  releaseGpCrowdAtlas,
} from '../src/rendering/gp-crowd-atlas.ts';
import { ShadowProxies } from '../src/rendering/shadow-proxies.ts';
import { CrowdCluster } from '../src/rendering/crowd.ts';
describe('GP far spectator sculpts', () => {
  it('bakes every authored silhouette, garment and unit normal into adjacent, padded views', () => {
    const texture = acquireGpCrowdAtlas(),
      second = acquireGpCrowdAtlas();
    const image = texture.image,
      data = image.data as Uint8Array,
      top = image.width * image.height * 2;
    expect(texture).toBe(second);
    let freed = 0;
    texture.addEventListener('dispose', () => freed++);
    try {
      for (let row = 0; row < 16; row++)
        for (let view = 0; view < GP_FAN_VIEWS; view++) {
          let area = 0,
            skin = 0,
            shirt = 0,
            denim = 0;
          for (let y = 0; y < 64; y++)
            for (let x = 0; x < 32; x++) {
              const i = 4 * ((row * 64 + y) * image.width + view * 32 + x);
              expect(data[i + 3]).toBe(data[top + i + 3]);
              if (!data[i + 3]) continue;
              area++;
              expect(x > 0 && x < 31 && y > 0 && y < 63).toBe(true);
              const n = Math.hypot(
                data[i] / 127.5 - 1,
                data[i + 1] / 127.5 - 1,
                data[i + 2] / 127.5 - 1,
              );
              if (Math.abs(n - 1) > 0.015) throw new Error('Non-unit spectator normal');
              if (data[top + i] > 200) shirt++;
              if (data[top + i + 1] > 200) skin++;
              if (data[top + i + 2] > 200) denim++;
            }
          expect(area).toBeGreaterThan(200);
          expect(skin).toBeGreaterThan(3);
          expect(shirt).toBeGreaterThan(20);
          expect(denim).toBeGreaterThan(10);
        }
    } finally {
      releaseGpCrowdAtlas();
      expect(freed).toBe(0);
      releaseGpCrowdAtlas();
      expect(freed).toBe(1);
    }
  });
  it('draws two triangles per GP fan at a distance while retaining the geometric head of a magnified fan', () => {
    const count = 120,
      seats = Array.from({ length: count }, (_, i) =>
        new T.Matrix4().makeTranslation(0, 0, (i - count / 2) * 0.65),
      );
    const material = new T.MeshStandardMaterial();
    const block = new CrowdCluster(
      seats,
      seats.map(() => new T.Color()),
      42,
      material,
      undefined,
      1,
    );
    try {
      const camera = new T.Vector3(0, 1, 408),
        visible = (gp: boolean, fov = 58) => {
          block.update(0, camera, 0, undefined, fov, 16 / 9, gp, 1080);
          return block.levels
            .filter((o) => o.visible)
            .map((o) => (o.geometry.index!.count / 3) * o.count);
        };
      expect(visible(true)).toEqual([2 * count]);
      expect(visible(false)[0]).toBeGreaterThan(600 * count);
      expect(visible(true, 12)[0]).toBeGreaterThan(1200 * count);
      const shadows = new ShadowProxies();
      shadows.shadowSubstitutes = () => block.shadowSubstitutes();
      for (const metres of [20,52,100,230,408]) {
        camera.set(0,1,metres);
        visible(true);
        const before = block.levels.map(o=>[o.visible,o.castShadow]);
        const ranges = block.lodRanges.map(r=>r.clone());
        shadows.withCasters(() => {
          const cast = block.levels.map((o,i) => o.visible && o.castShadow ? block.lodRanges[i] : null);
          for(let rank=.015;rank<1;rank+=.03125) {
            const expected=ranges.slice(0,3).some(r=>rank>=r.x && rank<r.y);
            expect(cast.filter(r=>r && rank>=r.x && rank<r.y)).toHaveLength(expected?1:0);
          }
          if(metres===20 || metres===100) expect(cast[2]).toBeTruthy();
        });
        expect(block.levels.map(o=>[o.visible,o.castShadow])).toEqual(before);
        expect(block.lodRanges).toEqual(ranges);
      }
      visible(false);
      expect(block.shadowSubstitutes()).toHaveLength(1);
    } finally {
      for (const level of block.levels) {
        level.geometry.dispose();
        (level.material as T.Material).dispose();
        level.customDepthMaterial?.dispose();
        level.customDistanceMaterial?.dispose();
        level.dispose();
      }
      material.dispose();
    }
  });
});
