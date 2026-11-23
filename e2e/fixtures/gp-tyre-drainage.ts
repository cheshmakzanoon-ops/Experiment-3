import * as T from 'three';
import { installGpTyreFinish } from '../../src/rendering/gp-tyre-finish.ts';
import { chainShaderHook, injectAfter } from '../../src/rendering/studio/shader-hooks.ts';

/** Each tile presents a small tangent plane of the mould to one camera pixel.
 * Comparing wet and slick roughness isolates channel coverage in the production material. */
export function measureGpDrainage(renderer: T.WebGLRenderer) {
  const pitches = [0.04, 0.25, 0.5, 1, 2.75];
  const samples = 64, tile = 8, width = samples * tile, height = pitches.length * 2 * tile;
  const positions: number[] = [], bind: number[] = [], indices: number[] = [];
  const across = 0.36, sweep = across * 0.85 + Math.sin(across * Math.PI) * 0.16;
  for (let row = 0; row < height / tile; row++) {
    const underside = row >= pitches.length, pitch = pitches[row % pitches.length];
    for (let col = 0; col < samples; col++) {
      const phase = (col + 0.5) / samples;
      const angle = Math.PI * 2 * ((phase - sweep) / 40 + (underside ? 0.5 : 0));
      const cy = Math.cos(angle), sz = Math.sin(angle), first = positions.length / 3;
      for (const [u, v] of [[0, 0], [tile, 0], [tile, tile], [0, tile]]) {
        positions.push(col * tile + u, row * tile + v, 0);
        const tangent = (u - tile / 2 - 0.5) * pitch * Math.PI * 2 / 40;
        bind.push(across * 0.1, 0.32 * (cy - sz * tangent), 0.32 * (sz + cy * tangent), 0.1);
      }
      indices.push(first, first + 1, first + 2, first, first + 2, first + 3);
    }
  }
  const geometry = new T.BufferGeometry();
  geometry.setIndex(indices);
  geometry.setAttribute('position', new T.Float32BufferAttribute(positions, 3));
  geometry.setAttribute('gpTyreBind', new T.Float32BufferAttribute(bind, 4));
  geometry.computeVertexNormals();
  const material = new T.MeshStandardMaterial(), finish = installGpTyreFinish(material);
  chainShaderHook(material, 'read-tyre-roughness-v1', shader => {
    injectAfter(shader, 'dithering_fragment', `
      float packedRoughness=floor(gpTyreRoughness*65535.+.5);
      gl_FragColor=vec4(floor(packedRoughness/256.)/255.,mod(packedRoughness,256.)/255.,0.,1.);
    `, 'fragment');
  });
  const target = new T.WebGLRenderTarget(width, height);
  const previous = renderer.getRenderTarget();
  const camera = new T.OrthographicCamera(0, width, height, 0, 0.01, 2);
  camera.position.z = 1;
  const scene = new T.Scene();
  scene.add(new T.Mesh(geometry, material));
  const read = (compound: number) => {
    finish.update({ compound, rearSurfaceTemp: 80, rearWear: 0, rearWater: 0, speed: 0 });
    renderer.render(scene, camera);
    const bytes = new Uint8Array(width * height * 4);
    renderer.readRenderTargetPixels(target, 0, 0, width, height, bytes);
    return bytes;
  };
  try {
    renderer.setRenderTarget(target);
    const slick = read(1), wet = read(4);
    return pitches.map((pitch, row) => {
      let maxCoverageError = 0, maxSeamError = 0, meanCoverage = 0;
      for (let col = 0; col < samples; col++) {
        const coverage = (r: number) => {
          const i = 4 * ((r * tile + tile / 2) * width + col * tile + tile / 2);
          return ((wet[i] - slick[i]) * 256 + wet[i + 1] - slick[i + 1]) / (65535 * 0.12);
        };
        const top = coverage(row), underside = coverage(row + pitches.length);
        let count = 0;
        for (let i = 0; i < 4096; i++) {
          const q = (col + 0.5) / samples + ((i + 0.5) / 4096 - 0.5) * pitch;
          if (Math.abs(q - Math.floor(q) - 0.5) < 0.048) count++;
        }
        meanCoverage += top / samples;
        maxCoverageError = Math.max(maxCoverageError, Math.abs(top - count / 4096), Math.abs(underside - count / 4096));
        maxSeamError = Math.max(maxSeamError, Math.abs(top - underside));
      }
      return { pitch, meanCoverage, maxCoverageError, maxSeamError };
    });
  } finally {
    renderer.setRenderTarget(previous);
    geometry.dispose();
    material.dispose();
    target.dispose();
  }
}
