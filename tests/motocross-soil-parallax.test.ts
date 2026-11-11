import * as T from 'three';
import { afterEach, describe, expect, it } from 'vitest';
import {
  installMxSoilParallax,
  MX_RUT_CUT,
  MX_RUT_LIP,
  MX_SOIL_PARALLAX_HOOK,
} from '../src/rendering/offroad/mx-soil-parallax.ts';
import { setMxQuality } from '../src/rendering/offroad/mx-quality.ts';
import { TerrainView } from '../src/rendering/offroad/terrain-view.ts';
import { studioHookKeys, type StudioShader } from '../src/rendering/studio/shader-hooks.ts';
import { rigTrack } from '../src/simulation/offroad/jump-rig.ts';

function compile(material: T.MeshPhysicalMaterial) {
  const source = T.ShaderLib.physical,
    shader = {
      vertexShader: source.vertexShader,
      fragmentShader: source.fragmentShader,
      uniforms: T.UniformsUtils.clone(source.uniforms),
    } as StudioShader;
  material.onBeforeCompile(shader, {} as T.WebGLRenderer);
  return shader;
}
const count = (text: string, token: string) => text.split(token).length - 1;

describe('MX relief march on the prepared passages', () => {
  afterEach(() => setMxQuality('high'));

  it('chains once onto the terrain, with its march ahead of the colour chunk', () => {
    const view = new TerrainView(rigTrack('valley-ridge-mx'));
    expect(studioHookKeys(view.material)).toContain(MX_SOIL_PARALLAX_HOOK);
    expect(installMxSoilParallax(view.material)).toBe(false);
    const fragment = compile(view.material).fragmentShader;
    const march = fragment.indexOf('pomFade'),
      colour = fragment.indexOf('#include <color_fragment>');
    expect(march).toBeGreaterThan(0);
    expect(march).toBeLessThan(colour);
    // The groove shading reads the shift the march writes, after it.
    expect(fragment.indexOf('vec2 p = vMxCourse.xy + mxPomShift;')).toBeGreaterThan(colour);
    expect(fragment).toContain('reflectedLight.directDiffuse *= mxPomShadow;');
    expect(fragment).toContain('normal = normalize( normal - mxPomSlope.x * mxPomT');
    view.dispose();
  });

  it('keeps every brace and preprocessor block balanced in the compiled fragment source', () => {
    const view = new TerrainView(rigTrack('valley-ridge-mx'));
    const fragment = compile(view.material).fragmentShader;
    expect(count(fragment, '{')).toBe(count(fragment, '}'));
    expect(count(fragment, '(')).toBe(count(fragment, ')'));
    expect(count(fragment, '#ifdef MX_HIGH_DETAIL')).toBe(3);
    // Every #if/#ifdef/#ifndef closes: nothing the march adds leaks a block.
    const opens = (fragment.match(/^\s*#if(n?def)?\b/gm) ?? []).length,
      closes = (fragment.match(/^\s*#endif\b/gm) ?? []).length;
    expect(opens).toBe(closes);
    view.dispose();
  });

  it('never differentiates a parallax-shifted coordinate', () => {
    const view = new TerrainView(rigTrack('valley-ridge-mx'));
    const fragment = compile(view.material).fragmentShader;
    // Filters read the unshifted footprint; a derivative of the shifted point
    // would spike wherever the march moves its hit.
    expect(fragment).not.toMatch(/fwidth\(\s*p\b/);
    expect(fragment).not.toMatch(/fwidth\(\s*q\b/);
    expect(fragment).not.toContain('fwidth( rakePhase )');
    view.dispose();
  });

  it('follows the High/Ultra gate and bounds the cut and lip to centimetres', () => {
    const view = new TerrainView(rigTrack('valley-ridge-mx')),
      defines = () => (view.material as T.Material & { defines?: Record<string, string> }).defines;
    expect(defines()).toHaveProperty('MX_HIGH_DETAIL');
    setMxQuality('medium');
    expect(defines()).not.toHaveProperty('MX_HIGH_DETAIL');
    setMxQuality('ultra');
    expect(defines()).toHaveProperty('MX_HIGH_DETAIL');
    expect(MX_RUT_CUT).toBeGreaterThan(0.02);
    expect(MX_RUT_CUT).toBeLessThan(0.07);
    expect(MX_RUT_LIP).toBeGreaterThan(0);
    expect(MX_RUT_LIP).toBeLessThan(0.02);
    view.dispose();
  });

  it('leaves non-motocross terrain without the hook', () => {
    const rallycross = new TerrainView(rigTrack('kestrel-rx'));
    expect(studioHookKeys(rallycross.material)).not.toContain(MX_SOIL_PARALLAX_HOOK);
    rallycross.dispose();
  });
});

/** A CPU mirror of the march's geometry: tangent frame from screen
 * derivatives, the eye ray in that frame and the descent through a groove. The
 * GLSL cannot run under vitest; this pins the algebra it is written from. */
describe('relief march geometry (CPU mirror of the shader algebra)', () => {
  const camera = new T.PerspectiveCamera(56, 16 / 9, 0.1, 500);
  camera.position.set(0.4, 1.8, -5);
  camera.lookAt(0, 0, 4);
  camera.updateMatrixWorld();
  camera.updateProjectionMatrix();
  // A flat ground in course coordinates (lateral = world x, station = world z).
  const viewOf = (p: T.Vector3) => p.clone().applyMatrix4(camera.matrixWorldInverse);
  const pixelRay = (px: number, py: number, w = 960, h = 540) => {
    const ndc = new T.Vector3((px / w) * 2 - 1, 1 - (py / h) * 2, 0.5).unproject(camera);
    return ndc.sub(camera.position).normalize();
  };
  const hitGround = (px: number, py: number) => {
    const d = pixelRay(px, py),
      t = -camera.position.y / d.y;
    return camera.position.clone().addScaledVector(d, t);
  };
  const frameAt = (px: number, py: number) => {
    // Derivatives as the GPU forms them: differences between neighbouring pixels.
    const a = hitGround(px, py),
      bx = hitGround(px + 1, py),
      by = hitGround(px, py + 1);
    const P = viewOf(a),
      dPx = viewOf(bx).sub(P),
      dPy = viewOf(by).sub(P);
    const cx = [bx.x - a.x, bx.z - a.z],
      cy = [by.x - a.x, by.z - a.z];
    const det = cx[0] * cy[1] - cx[1] * cy[0];
    const Tl = dPx.clone().multiplyScalar(cy[1]).addScaledVector(dPy, -cx[1]).divideScalar(det);
    const Ts = dPy.clone().multiplyScalar(cx[0]).addScaledVector(dPx, -cy[0]).divideScalar(det);
    // The shader takes the mesh's interpolated normal, which faces the eye.
    const N = new T.Vector3().crossVectors(Tl, Ts).normalize();
    if (N.dot(P) > 0) N.negate();
    return { a, P, Tl, Ts, N };
  };

  it('recovers the course axes in view space from screen derivatives', () => {
    const { a, Tl, Ts } = frameAt(430, 380);
    const lateral = viewOf(a.clone().add(new T.Vector3(1, 0, 0))).sub(viewOf(a)),
      station = viewOf(a.clone().add(new T.Vector3(0, 0, 1))).sub(viewOf(a));
    expect(Tl.distanceTo(lateral)).toBeLessThan(0.02);
    expect(Ts.distanceTo(station)).toBeLessThan(0.02);
  });

  it('descends the eye ray to the point a world-space ray meets a groove', () => {
    // A groove whose floor is 4.5 cm below the surface, 8 cm either side of x = 1.
    const depth = 0.045,
      half = 0.08;
    const height = (x: number) => (Math.abs(x - 1) < half ? -depth : 0);
    let checked = 0,
      shifted = 0;
    for (let px = 380; px < 900; px += 3) {
      const a0 = hitGround(px, 330);
      // Pixels whose surface point lies at the groove or just beside it.
      if (a0.x < 0.82 || a0.x > 1.2) continue;
      const { a, P, Tl, Ts, N } = frameAt(px, 330);
      const frame = new T.Matrix3().set(Tl.x, Ts.x, N.x, Tl.y, Ts.y, N.y, Tl.z, Ts.z, N.z);
      const co = P.clone().negate().normalize().applyMatrix3(frame.clone().invert());
      const dir = [co.x / co.z, co.y / co.z];
      let hit = 0.012;
      for (let i = 1; i <= 400; i++) {
        const z = 0.012 - (0.057 * i) / 400;
        hit = z;
        if (z - height(a.x + z * dir[0]) <= 0) break;
      }
      // Independent: walk the eye ray through the real groove geometry.
      const ray = pixelRay(px, 330);
      let expected = new T.Vector3();
      for (let t = 0; t < 40; t += 0.0002) {
        const p = camera.position.clone().addScaledVector(ray, t);
        if (p.y <= Math.max(height(p.x), -1) && p.y <= 0.0001) {
          expected = p;
          break;
        }
      }
      expect(hit).toBeCloseTo(expected.y, 2);
      expect(a.x + hit * dir[0]).toBeCloseTo(expected.x, 2);
      expect(a.z + hit * dir[1]).toBeCloseTo(expected.z, 1);
      checked++;
      if (Math.abs(hit) > 0.01) shifted++;
    }
    expect(checked).toBeGreaterThan(8);
    expect(shifted).toBeGreaterThan(3);
  });
});
