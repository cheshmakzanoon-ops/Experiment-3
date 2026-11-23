import * as T from 'three';
import { WeatherPresentation } from '../../src/rendering/weather-presentation.ts';
import { CrowdCluster } from '../../src/rendering/crowd.ts';

export function captureGpFanSilhouettes() {
  const canvas = document.createElement('canvas'),
    width = 512,
    height = 256;
  const gl = new T.WebGLRenderer({
    canvas,
    alpha: true,
    antialias: true,
    preserveDrawingBuffer: true,
  });
  gl.setSize(width, height, false);
  gl.setClearColor(0x1b232c, 0);
  const scene = new T.Scene(),
    camera = new T.PerspectiveCamera(22, width / height, 0.01, 100);
  const key = new T.DirectionalLight(0xffe2c6, 2.2);
  key.position.set(-2, 3, 2.4);
  scene.add(key, new T.HemisphereLight(0xd7e7ff, 0x665d55, 1.2));
  const material = new T.MeshStandardMaterial({ roughness: 0.8 });
  const matrices = [-1.6, -0.54, 0.56, 1.68].map((z, i) =>
    new T.Matrix4().makeRotationY(0.075 * i).setPosition(0, 0, z),
  );
  const shirts = [0xa02725, 0x2d61a2, 0x536239, 0xba8b40].map((x) => new T.Color(x));
  const gp = new CrowdCluster(matrices, shirts, 209, material, undefined, 1, true);
  const seated = new CrowdCluster(matrices, shirts, 209, material, undefined, 1);
  const old = new CrowdCluster(matrices, shirts, 209, material, undefined, 0, true);
  const weather = new WeatherPresentation();
  for (const sections of [gp, seated, old]) weather.install(sections.root);
  const captures: { name: string; image: string; draws: number; triangles: number }[] = [];
  const snap = (name: string, group: CrowdCluster, level: number) => {
    for (const g of [gp, seated, old]) scene.remove(g.root);
    scene.add(group.root);
    group.update(4, camera.position, 0, undefined, 40, 2, true, 1080);
    group.levels.forEach((mesh, i) => {
      mesh.visible = i === level;
      group.lodRanges[i].set(0, 1);
    });
    gl.render(scene, camera);
    const pix = new Uint8Array(width * height * 4),
      ctx = gl.getContext();
    ctx.readPixels(0, 0, width, height, ctx.RGBA, ctx.UNSIGNED_BYTE, pix);
    captures.push({
      name,
      image: canvas.toDataURL('image/png'),
      draws: gl.info.render.calls,
      triangles: gl.info.render.triangles,
    });
    return pix;
  };
  const agreement = (a: Uint8Array, b: Uint8Array) => {
    let union = 0,
      intersection = 0;
    for (let i = 3; i < a.length; i += 4) {
      const x = a[i] > 120,
        y = b[i] > 120;
      if (x || y) union++;
      if (x && y) intersection++;
    }
    return intersection / Math.max(1, union);
  };
  try {
    camera.position.set(-5.1, 1.45, 1.8);
    camera.lookAt(-0.36, 0.56, 0);
    const sculpt = snap('standing-sculpt', gp, 2),
      current = snap('standing-angular', gp, 3),
      previous = snap('standing-legacy-card', old, 3);
    camera.position.set(4.9, 0.94, 2.45);
    camera.lookAt(-0.22, 0.3, 0);
    const backSculpt = snap('seated-rear-sculpt', seated, 2),
      backCard = snap('seated-rear-angular', seated, 3);
    camera.position.set(-5.1, 1.45, 1.8);
    camera.lookAt(-0.36, 0.56, 0);
    const same = snap('standing-rewound', gp, 3);
    let restored = 0;
    for (let i = 0; i < same.length; i++) if (same[i] !== current[i]) restored++;
    return {
      captures,
      shape: agreement(sculpt, current),
      oldShape: agreement(sculpt, previous),
      reverseShape: agreement(backSculpt, backCard),
      restored,
      glError: gl.getContext().getError(),
    };
  } finally {
    for (const group of [gp, seated, old])
      for (const level of group.levels) {
        level.geometry.dispose();
        (level.material as T.Material).dispose();
        level.customDepthMaterial?.dispose();
        level.customDistanceMaterial?.dispose();
        level.dispose();
      }
    material.dispose();
    gl.dispose();
  }
}
