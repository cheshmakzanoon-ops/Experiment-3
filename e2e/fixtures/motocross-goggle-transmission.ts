import * as T from 'three';
import { Rider, type RiderDetail } from '../../src/rendering/rider.ts';
import { installMud, mudUniforms } from '../../src/rendering/offroad/mud.ts';

/** Colour differences between two interchangeable backing cards measure light
 * transmitted through each pixel of the production lens independently of
 * the reflected colour. Keep its real geometry, exposure and shader chain. */
export function measureGoggleTransmission(detail: Exclude<RiderDetail, 'far'>) {
  const rider = new Rider(
    { primary: 0x185580, secondary: 0xedddbb, accent: 0xd37324 },
    detail,
    'motocross',
  );
  let source: T.Mesh<T.BufferGeometry, T.MeshPhysicalMaterial> | undefined;
  rider.root.traverse((node) => {
    if (
      node instanceof T.Mesh &&
      node.material instanceof T.MeshPhysicalMaterial &&
      node.material.name === 'Motocross smoked coated goggle lens'
    )
      source = node;
  });
  if (!source) throw new Error('Missing motocross racing lens');
  const coat = mudUniforms();
  installMud(source.material, coat);
  const renderer = new T.WebGLRenderer({ antialias: false, preserveDrawingBuffer: true });
  const width = 320,
    height = 144;
  renderer.setSize(width, height, false);
  renderer.outputColorSpace = T.LinearSRGBColorSpace;
  const scene = new T.Scene();
  scene.background = new T.Color();
  const optic = new T.Mesh(source.geometry, source.material);
  scene.add(optic, new T.AmbientLight(0xffffff, 1.4));
  const bounds = new T.Box3().setFromObject(optic),
    centre = bounds.getCenter(new T.Vector3());
  const size = bounds.getSize(new T.Vector3());
  const half = Math.max(size.y, (size.x * height) / width) * 0.54;
  const camera = new T.OrthographicCamera(
    (-half * width) / height,
    (half * width) / height,
    half,
    -half,
    0.01,
    2,
  );
  camera.position.copy(centre);
  camera.position.z += 0.5;
  camera.lookAt(centre);
  const gl = renderer.getContext();
  const transmission = (mud: number) => {
    coat.offroadMud.value = mud;
    coat.offroadMudWet.value = 1;
    const images = [0.02, 0.9].map((grey) => {
      (scene.background as T.Color).setRGB(grey, grey, grey);
      renderer.render(scene, camera);
      const rgba = new Uint8Array(width * height * 4);
      gl.readPixels(0, 0, width, height, gl.RGBA, gl.UNSIGNED_BYTE, rgba);
      return rgba;
    });
    return Uint8Array.from({ length: width * height }, (_, i) =>
      Math.max(0, images[1][i * 4] - images[0][i * 4]),
    );
  };
  try {
    const clean = transmission(0),
      used = transmission(0.55),
      wet = transmission(0.96),
      restored = transmission(0);
    let clearPixels = 0,
      usedOpaque = 0,
      wetOpaque = 0,
      wetClear = 0,
      changedOnReturn = 0;
    for (let i = 0; i < clean.length; i++) {
      if (clean[i] !== restored[i]) changedOnReturn++;
      if (clean[i] < 35 || clean[i] > 180) continue;
      clearPixels++;
      if (used[i] < 0.22 * clean[i]) usedOpaque++;
      if (wet[i] < 0.22 * clean[i]) wetOpaque++;
      if (wet[i] > 0.86 * clean[i]) wetClear++;
    }
    return {
      clearPixels,
      usedOpaque,
      wetOpaque,
      wetClear,
      changedOnReturn,
      calls: renderer.info.render.calls,
      triangles: renderer.info.render.triangles,
      glError: gl.getError(),
    };
  } finally {
    rider.dispose();
    renderer.dispose();
    renderer.forceContextLoss();
  }
}
