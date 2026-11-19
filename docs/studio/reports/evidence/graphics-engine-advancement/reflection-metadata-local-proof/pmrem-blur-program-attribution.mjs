// CPU-only source attribution against the installed, pinned Three build.
// No browser, graphics context or driver operation is created.
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { pathToFileURL } from 'node:url';
import assert from 'node:assert/strict';

const require = createRequire(import.meta.url);
const build = path.dirname(require.resolve('three'));
const core = pathToFileURL(path.join(build, 'three.core.js')).href;
const text = fs
  .readFileSync(path.join(build, 'three.module.js'), 'utf8')
  .replaceAll("'./three.core.js'", JSON.stringify(core));
const T = await import(
  'data:text/javascript;base64,' +
    Buffer.from(
      text + '\nexport { WebGLProgram as CPUWebGLProgram, WebGLPrograms as CPUWebGLPrograms };\n',
    ).toString('base64')
);
assert.equal(T.REVISION, '180');
const { CPUWebGLProgram: WebGLProgram, CPUWebGLPrograms: WebGLPrograms, PMREMGenerator } = T;

const sources = [];
const gl = {
  VERTEX_SHADER: 35633,
  FRAGMENT_SHADER: 35632,
  createProgram: () => ({}),
  createShader: (type) => ({ type }),
  shaderSource: (shader, source) => {
    shader.source = source;
    sources.push(shader);
  },
  compileShader: () => {},
  attachShader: () => {},
  linkProgram: () => {},
};
let compiled;
const renderer = {
  getContext: () => gl,
  getRenderTarget: () => ({ texture: { colorSpace: T.LinearSRGBColorSpace } }),
  compile: (mesh) => {
    compiled = mesh;
  },
  state: { buffers: { depth: { getReversed: () => false } } },
  shadowMap: { enabled: true, type: T.PCFShadowMap },
  outputColorSpace: T.SRGBColorSpace,
  toneMapping: T.ACESFilmicToneMapping,
};
const generator = new PMREMGenerator(renderer);
generator._setSize(256);
const unusedOutput = generator._allocateTargets();
try {
  generator._compileMaterial(generator._blurMaterial);
} finally {
  unusedOutput.dispose();
}
const emptyMaps = { get: (value) => value };
const capabilities = {
  vertexTextures: true,
  precision: 'highp',
  getMaxPrecision: (value) => value,
  logarithmicDepthBuffer: false,
};
const programs = WebGLPrograms(
  renderer,
  emptyMaps,
  emptyMaps,
  { has: () => false },
  capabilities,
  {},
  { numPlanes: 0, numIntersection: 0 },
);
const lights = Object.fromEntries(
  [
    'directional',
    'point',
    'spot',
    'spotLightMap',
    'rectArea',
    'hemi',
    'directionalShadowMap',
    'pointShadowMap',
    'spotShadowMap',
  ].map((name) => [name, []]),
);
lights.numSpotLightShadowsWithMaps = 0;
lights.numLightProbes = 0;
const params = programs.getParameters(compiled.material, lights, [], new T.Scene(), compiled);
new WebGLProgram(renderer, 'cpu-only-fragment-attribution', params, {});
for (const shader of sources) {
  let hash = 2166136261;
  for (let index = 0; index < shader.source.length; index++)
    hash = Math.imul(hash ^ shader.source.charCodeAt(index), 16777619);
  const value = (hash >>> 0).toString(16).padStart(8, '0');
  if (shader.type === 35632) assert.equal(value, '576687b0');
  console.log(
    JSON.stringify({
      shader: compiled.material.name,
      type: shader.type,
      hash: value,
      length: shader.source.length,
    }),
  );
}

generator.dispose();
