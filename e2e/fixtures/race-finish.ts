import * as T from 'three';
import { FormulaCar } from '../../src/rendering/car.ts';
import { PitCrewView } from '../../src/rendering/pit-crew.ts';
import { buildVegetation } from '../../src/rendering/landscape.ts';
import { Track } from '../../src/simulation/track.ts';
import { crewSuitFragment } from '../../src/rendering/crew-suit.ts';
import {
  F,
  H,
  W,
  HEADER,
  CAR_STRIDE,
  WHEEL_BASE,
  WHEEL_STRIDE,
  carBase,
} from '../../src/simulation/protocol.ts';
import { disposePhase27Scene } from './phase27c-resources.ts';
import { pixelDifference } from './pixel-difference.ts';

/** Controlled production-component comparisons, not an ordinary driven race.
 * Existing full-game dry/sunset/wet/day/night tests remain the integration gate. */
function studio() {
  const renderer = new T.WebGLRenderer({ antialias: false, preserveDrawingBuffer: true });
  renderer.setPixelRatio(1);
  renderer.setSize(512, 384);
  renderer.outputColorSpace = T.SRGBColorSpace;
  document.body.append(renderer.domElement);
  const scene = new T.Scene();
  scene.background = new T.Color(0);
  const camera = new T.PerspectiveCamera(40, 512 / 384, 0.05, 1000);
  const data = new Uint8Array(512 * 384 * 4);
  const capture = (name: string) => {
    renderer.render(scene, camera);
    const gl = renderer.getContext();
    gl.readPixels(0, 0, 512, 384, gl.RGBA, gl.UNSIGNED_BYTE, data);
    let hash = 2166136261,
      energy = 0,
      nonzero = 0;
    for (let i = 0; i < data.length; i += 4) {
      const value = data[i] + data[i + 1] + data[i + 2];
      energy += value;
      if (value > 3) nonzero++;
      for (let c = 0; c < 3; c++) hash = Math.imul(hash ^ data[i + c], 16777619);
    }
    return {
      name,
      hash: hash >>> 0,
      energy,
      nonzero,
      calls: renderer.info.render.calls,
      triangles: renderer.info.render.triangles,
      frontFace: gl.getParameter(gl.FRONT_FACE) as number,
      image: renderer.domElement.toDataURL('image/png'),
    };
  };
  const dispose = () => {
    disposePhase27Scene(scene);
    renderer.dispose();
    renderer.domElement.remove();
  };
  return { renderer, scene, camera, capture, pixels: () => data.slice(), dispose };
}
function frame(clock = 0) {
  const result = new Float32Array(HEADER + CAR_STRIDE);
  const o = carBase(0);
  result[H.CARS] = 1;
  result[H.TIME] = 20 + clock;
  result[o + F.QW] = 1;
  result[o + F.FRONT_HEALTH] = result[o + F.REAR_HEALTH] = 1;
  result[o + F.GEAR] = 1;
  for (let i = 0; i < 4; i++) {
    const w = o + WHEEL_BASE + i * WHEEL_STRIDE;
    result[w + W.LENGTH] = 0.3;
    result[w + W.RADIUS] = 0.335;
    result[w + W.PRESSURE] = 155;
  }
  return result;
}
export function signalGPU() {
  const { renderer, scene, camera, capture, dispose } = studio();
  const car = new FormulaCar(1);
  scene.add(car.root);
  camera.position.set(0, -0.23, -5);
  camera.lookAt(0, -0.23, -2.28);
  const state = frame();
  state[H.TIME] = 0;
  const o = carBase(0);
  const captures = [];
  try {
    for (const [distance, level] of [
      [0, 0],
      [90, 1],
      [220, 2],
    ]) {
      car.setLod(distance, 'high', false);
      for (const [label, brake] of [
        ['idle', 0],
        ['brake', 0.8],
        ['held', 0.8],
        ['rewound', 0],
      ] as const) {
        state[o + F.BRAKE] = brake;
        car.update(state, state, o, 1, 0, 0, false);
        const c = capture(`rear-signal-lod${level}-${label}`);
        captures.push({
          ...c,
          level: car.lodLevel,
          intensity: car.rainLight.emissiveIntensity,
          directChild: car.rearSignal.parent === car.root,
        });
      }
    }
    return { captures, glError: renderer.getContext().getError() };
  } finally {
    dispose();
  }
}
export function crewGPU() {
  const { renderer, scene, camera, capture, dispose } = studio();
  const crew = new PitCrewView();
  scene.background = new T.Color(0x18222b);
  scene.add(crew.root, new T.HemisphereLight(0xe3efff, 0x655343, 2));
  const key = new T.DirectionalLight(0xffead6, 3);
  key.position.set(2, 5, 4);
  scene.add(key);
  camera.position.set(5, 3.6, 6);
  camera.lookAt(0, 0.6, 0);
  const materials = crew.root.children
    .slice(0, 2)
    .map((o) => (o as T.InstancedMesh).material as T.Material);
  const hooks = materials.map((m) => ({
    callback: m.onBeforeCompile,
    key: m.customProgramCacheKey(),
  }));
  const setTailoring = (enabled: boolean) =>
    materials.forEach((m, i) => {
      m.onBeforeCompile = (s, r) => {
        hooks[i].callback.call(m, s, r);
        if (!enabled) {
          if (!s.fragmentShader.includes(crewSuitFragment))
            throw new Error('Missing production suit hook');
          s.fragmentShader = s.fragmentShader.replace(crewSuitFragment, '');
        }
      };
      m.customProgramCacheKey = () => hooks[i].key + (enabled ? '-candidate' : '-plain-control');
      m.needsUpdate = true;
    });
  const service = (clock: number) => {
    const state = frame(clock),
      o = carBase(0);
    state[o + F.Y] = 0.6;
    state[o + F.PIT_PHASE] = clock < 3.5 ? 4 : 5;
    state[o + F.PIT_CLOCK] = clock;
    state[o + F.JACK_HEIGHT] = 0.19;
    return state;
  };
  const captures = [];
  try {
    for (const [lod, distance] of [
      ['near', 8],
      ['mid', 55],
    ] as const) {
      // Hold the inspection camera; request the actual production crew LOD with
      // its normal distance selector, not a separate or simplified actor model.
      const viewer = new T.Vector3(0, 2, distance);
      crew.update(service(3), viewer);
      setTailoring(false);
      captures.push(capture(`crew-${lod}-plain-control`));
      setTailoring(true);
      captures.push(capture(`crew-${lod}-tailored`));
      captures.push(capture(`crew-${lod}-held`));
      crew.update(service(4), viewer);
      capture('unrecorded-install-pose');
      crew.update(service(3), viewer);
      captures.push(capture(`crew-${lod}-rewound`));
    }
    const before = { ...renderer.info.memory };
    for (let i = 0; i < 12; i++) {
      crew.update(service(i % 2 ? 4 : 3), new T.Vector3(0, 2, 8));
      renderer.render(scene, camera);
    }
    return {
      captures,
      before,
      after: { ...renderer.info.memory },
      actors: crew.activeActors,
      glError: renderer.getContext().getError(),
    };
  } finally {
    crew.dispose();
    dispose();
  }
}
export function canopyGPU() {
  const { renderer, scene, camera, capture, pixels, dispose } = studio();
  const plantation = new T.Group();
  buildVegetation(new Track(), plantation);
  const leaf = plantation.children.find(
    (o) =>
      o instanceof T.InstancedMesh &&
      (o.material as T.Material).name === 'Original four-character planted foliage',
  ) as T.InstancedMesh;
  if (!leaf) throw new Error('Production foliage missing');
  const material = leaf.material as T.MeshStandardMaterial;
  const geometry = new T.PlaneGeometry(2, 2);
  const normal = geometry.getAttribute('normal');
  for (let i = 0; i < normal.count; i++) normal.setXYZ(i, 0, 0.8, 0.6);
  const card = new T.InstancedMesh(geometry, material, 1);
  card.setMatrixAt(0, new T.Matrix4());
  scene.add(card);
  const key = new T.DirectionalLight(0xffffff, 3);
  key.position.set(0, 3, 2);
  scene.add(key);
  camera.position.set(0, 0, 3.2);
  camera.lookAt(0, 0, 0);
  const position = geometry.getAttribute('position'),
    frontPositions = position.array.slice(),
    frontNormals = normal.array.slice(),
    frontIndices = geometry.index!.array.slice(),
    uv = geometry.getAttribute('uv'),
    frontUVs = uv.array.slice();
  // Reverse declared front-facing orientation through the normal renderer path,
  // not primitive reindexing. Opposite local/object X reflections retain exactly
  // the same ordered world vertices, authored normals and atlas coordinates.
  // Reindexing also perturbed Mesa's alpha-edge interpolation, so it did not
  // isolate the normal correction from the unrelated texture sampling control.
  const setFacing = (back: boolean) => {
    const sign = back ? -1 : 1;
    for (let i = 0; i < position.count; i++) {
      position.setX(i, frontPositions[i * 3] * sign);
      normal.setX(i, frontNormals[i * 3] * sign);
    }
    position.needsUpdate = normal.needsUpdate = true;
    card.scale.x = sign;
    card.updateMatrixWorld(true);
    const normalMatrix = new T.Matrix3().getNormalMatrix(card.matrixWorld);
    let maximumWorldPositionDelta = 0,
      maximumWorldNormalDelta = 0;
    for (let i = 0; i < position.count; i++) {
      const world = new T.Vector3().fromBufferAttribute(position, i).applyMatrix4(card.matrixWorld);
      const authored = new T.Vector3().fromArray(frontPositions, i * 3);
      const worldNormal = new T.Vector3()
        .fromBufferAttribute(normal, i)
        .applyNormalMatrix(normalMatrix);
      const authoredNormal = new T.Vector3().fromArray(frontNormals, i * 3).normalize();
      maximumWorldPositionDelta = Math.max(maximumWorldPositionDelta, world.distanceTo(authored));
      maximumWorldNormalDelta = Math.max(
        maximumWorldNormalDelta,
        worldNormal.distanceTo(authoredNormal),
      );
    }
    return {
      back,
      matrixDeterminant: card.matrixWorld.determinant(),
      maximumWorldPositionDelta,
      maximumWorldNormalDelta,
      indicesUnchanged: frontIndices.every((value, i) => geometry.index!.getX(i) === value),
      uvUnchanged: frontUVs.every((value, i) => uv.array[i] === value),
    };
  };
  const callback = material.onBeforeCompile,
    cacheKey = material.customProgramCacheKey();
  const correction = 'normal *= faceDirection;\n  nonPerturbedNormal = normal;';
  const captures = [];
  const comparisons = [];
  const facingChecks = [];
  try {
    // Keep production texture/alpha/shading and every original pixel assertion.
    // The normal witness and disabled-correction negative control must still
    // distinguish front/back lighting while projected coverage remains exact.
    for (const observation of ['lit', 'normal'] as const) {
      for (const enabled of [false, true]) {
        material.onBeforeCompile = (s, r) => {
          callback.call(material, s, r);
          if (!enabled) {
            if (!s.fragmentShader.includes(correction))
              throw new Error('Missing canopy normal correction');
            s.fragmentShader = s.fragmentShader.replace(correction, '');
          }
          if (observation === 'normal') {
            const output = '#include <opaque_fragment>';
            if (!s.fragmentShader.includes(output)) throw new Error('Missing normal readback hook');
            s.fragmentShader = s.fragmentShader.replace(
              output,
              `${output}\ngl_FragColor = vec4(normal * .5 + .5, 1.);`,
            );
          }
        };
        const name = `canopy-${enabled ? 'corrected' : 'control'}${observation === 'normal' ? '-normal' : ''}`;
        material.customProgramCacheKey = () => `${cacheKey}-${name}`;
        material.needsUpdate = true;
        facingChecks.push(setFacing(false));
        captures.push(capture(`${name}-front`));
        const frontPixels = pixels();
        facingChecks.push(setFacing(true));
        captures.push(capture(`${name}-back`));
        comparisons.push({ name, ...pixelDifference(frontPixels, pixels()) });
      }
    }
    return { captures, comparisons, facingChecks, glError: renderer.getContext().getError() };
  } finally {
    // The test card shares the production material and atlas, not its geometry.
    scene.remove(card);
    card.dispose();
    geometry.dispose();
    disposePhase27Scene(plantation);
    dispose();
  }
}
