import * as T from 'three';
import { expect, it } from 'vitest';
import { bindHarbourCloth, harbourPennant } from '../src/rendering/open-world/harbour-pennants.ts';
import { studioUniforms } from '../src/rendering/studio/studio-frame.ts';

it('pins the full upper hem to both spans of its cable and closes the tapered tip without degenerate triangles', () => {
  const g = harbourPennant(0.045, -0.03),
    p = g.getAttribute('position'),
    uv = g.getAttribute('uv');
  const index = g.index!,
    a = new T.Vector3(),
    b = new T.Vector3(),
    c = new T.Vector3();
  let hems = 0,
    tips = 0;
  for (let i = 0; i < p.count; i++) {
    if (uv.getY(i) === 0) {
      expect(p.getY(i)).toBeCloseTo(
        Math.abs(p.getX(i) / 0.32) * (p.getX(i) < 0 ? 0.045 : -0.03),
        6,
      );
      hems++;
    }
    if (uv.getY(i) === 1) {
      expect(p.getY(i)).toBeCloseTo(-0.88, 6);
      tips++;
    }
  }
  expect(hems).toBe(5);
  expect(tips).toBe(1);
  for (let i = 0; i < index.count; i += 3) {
    a.fromBufferAttribute(p, index.getX(i));
    b.fromBufferAttribute(p, index.getX(i + 1)).sub(a);
    c.fromBufferAttribute(p, index.getX(i + 2)).sub(a);
    expect(b.cross(c).z).toBeGreaterThan(0.001);
  }
  g.dispose();
});
it('shares the recorded wind, position deformation and fixed hem across colour, depth and distance passes', () => {
  for (const [material, standard] of [
    [new T.MeshStandardMaterial(), true],
    [new T.MeshDepthMaterial(), false],
    [new T.MeshDistanceMaterial(), false],
  ] as const) {
    bindHarbourCloth(material, standard);
    const shader = {
      uniforms: {},
      vertexShader: '#include <common>\n#include <beginnormal_vertex>\n#include <begin_vertex>',
      fragmentShader: '',
    } as T.WebGLProgramParametersWithUniforms;
    material.onBeforeCompile(shader, {} as T.WebGLRenderer);
    expect(shader.uniforms.studioWind).toBe(studioUniforms.studioWind);
    expect(shader.vertexShader.indexOf('uniform vec4 studioWind')).toBeLessThan(
      shader.vertexShader.indexOf('float harbourBend'),
    );
    expect(shader.vertexShader).toContain('transformed += harbourClothOffset');
    expect(shader.vertexShader.includes('objectNormal = normalize')).toBe(standard);
    material.dispose();
  }
});
