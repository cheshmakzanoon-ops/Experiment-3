import * as T from 'three';
import { LocalAtmosphere } from '../../src/rendering/local-atmosphere.ts';
import {
  WeatherPresentation,
  sceneryCoverUniform,
  tagWeatherSurface,
  type WeatherSurface,
} from '../../src/rendering/weather-presentation.ts';
import {
  WeatherPresentation as ReferenceWeather,
  sceneryCoverUniform as referenceSnow,
} from './weather-presentation-control.ts';
import { Track } from '../../src/simulation/track.ts';
import { aerialUniforms } from '../../src/rendering/studio/aerial-perspective.ts';
import { cloudShadowUniforms } from '../../src/rendering/studio/cloud-shadow.ts';
import { installCarGrounding } from '../../src/rendering/studio/car-grounding.ts';
import { studioUniforms } from '../../src/rendering/studio/studio-frame.ts';

function difference(a: Uint8Array, b: Uint8Array) {
  if (a.length !== b.length) throw new Error('Mismatched pixel captures');
  let max = 0,
    sum = 0,
    changed = 0;
  for (let i = 0; i < a.length; i++) {
    const d = Math.abs(a[i] - b[i]);
    max = Math.max(max, d);
    sum += d;
    if (d) changed++;
  }
  return { maxChannelDelta: max, meanChannelDelta: sum / a.length, changedChannels: changed };
}

function fixture() {
  const renderer = new T.WebGLRenderer({ antialias: false, preserveDrawingBuffer: true });
  renderer.setPixelRatio(1);
  renderer.setSize(256, 192);
  renderer.toneMapping = T.NoToneMapping;
  renderer.outputColorSpace = T.SRGBColorSpace;
  document.body.append(renderer.domElement);
  const scene = new T.Scene();
  scene.background = new T.Color(0x152132);
  scene.add(new T.HemisphereLight(0xb5d3f5, 0x695c4a, 1.2));
  const sun = new T.DirectionalLight(0xffedda, 2.3);
  sun.position.set(4, 8, 3);
  scene.add(sun);
  const camera = new T.PerspectiveCamera(42, 4 / 3, 0.05, 2000);
  camera.position.set(4, 4, 8);
  camera.lookAt(0, 0.8, 0);
  const sphereGeometry = new T.SphereGeometry(1.35, 32, 20);
  const groundGeometry = new T.PlaneGeometry(14, 14);
  groundGeometry.rotateX(-Math.PI / 2);
  const placeholder = new T.MeshStandardMaterial();
  const subject = new T.Mesh(sphereGeometry, placeholder);
  subject.position.y = 1.35;
  const ground = new T.Mesh(groundGeometry, placeholder);
  scene.add(subject, ground);
  const draw = () => {
    renderer.render(scene, camera);
    const gl = renderer.getContext();
    const pixels = new Uint8Array(256 * 192 * 4);
    gl.readPixels(0, 0, 256, 192, gl.RGBA, gl.UNSIGNED_BYTE, pixels);
    return {
      pixels,
      calls: renderer.info.render.calls,
      triangles: renderer.info.render.triangles,
      geometries: renderer.info.memory.geometries,
      textures: renderer.info.memory.textures,
    };
  };
  return {
    renderer,
    scene,
    camera,
    subject,
    ground,
    draw,
    dispose() {
      sphereGeometry.dispose();
      groundGeometry.dispose();
      placeholder.dispose();
      renderer.dispose();
      renderer.domElement.remove();
    },
  };
}

export function weatherWorkProof() {
  const f = fixture();
  const current = new WeatherPresentation(),
    reference = new ReferenceWeather();
  const materials: T.Material[] = [];
  const rows = [];
  let image = '';
  try {
    for (const role of ['stone', 'paint', 'fabric', 'leather'] as WeatherSurface[]) {
      const candidate = tagWeatherSurface(
        new T.MeshStandardMaterial({
          color: 0x93714d,
          roughness: 0.72,
          metalness: role === 'paint' ? 0.2 : 0,
          side: T.DoubleSide,
        }),
        role,
      );
      const control = candidate.clone();
      current.installMaterial(candidate);
      reference.installMaterial(control);
      materials.push(candidate, control);
      let dry: Uint8Array | undefined;
      for (const [mode, wetness, snow] of [
        ['dry', 0, 0],
        ['wet', 0.85, 0],
        ['snow', 0, 0.7],
        ['mixed', 0.65, 0.7],
        ['dry-restored', 0, 0],
      ] as const) {
        current.surface.value.set(wetness, 123.5, 18, 0.4);
        reference.surface.value.copy(current.surface.value);
        sceneryCoverUniform.value = referenceSnow.value = snow;
        f.subject.material = f.ground.material = control;
        const before = f.draw();
        f.subject.material = f.ground.material = candidate;
        const after = f.draw(),
          held = f.draw();
        if (mode === 'dry') dry = after.pixels;
        rows.push({
          role,
          mode,
          comparison: difference(before.pixels, after.pixels),
          held: difference(after.pixels, held.pixels),
          fromDry: difference(dry!, after.pixels),
          countsEqual:
            before.calls === after.calls &&
            before.triangles === after.triangles &&
            before.geometries === after.geometries &&
            before.textures === after.textures,
        });
        if (role === 'stone' && mode === 'mixed')
          image = f.renderer.domElement.toDataURL('image/png');
      }
    }
    return { rows, glError: f.renderer.getContext().getError(), image };
  } finally {
    current.dispose();
    reference.dispose();
    sceneryCoverUniform.value = referenceSnow.value = 0;
    materials.forEach((m) => m.dispose());
    f.dispose();
  }
}

export function fogWorkProof() {
  const f = fixture();
  const atmosphere = new LocalAtmosphere(new Track()),
    p = atmosphere.pockets[0];
  const material = new T.MeshStandardMaterial({ color: 0x967149, roughness: 0.7 });
  installCarGrounding(material);
  atmosphere.installMaterial(material);
  f.subject.material = f.ground.material = material;
  f.subject.position.set(p.x, p.floor + 1.35, p.z);
  f.ground.position.set(p.x, p.floor, p.z);
  f.camera.position.set(p.x + 4, p.floor + 4, p.z + 9);
  f.camera.lookAt(p.x, p.floor + 0.8, p.z);
  f.scene.fog = new T.FogExp2(0x829cb5, 0.0001);
  const field = new T.DataTexture(new Uint8Array([255, 255, 255, 255]), 1, 1);
  field.needsUpdate = true;
  const saved = {
    extinction: aerialUniforms.apexAerialExtinction.value.clone(),
    field: cloudShadowUniforms.apexCloudField.value,
    shadow: cloudShadowUniforms.apexCloudShadow.value.clone(),
    carCount: studioUniforms.studioCarCount.value,
    carPose: studioUniforms.studioCarPose.value[0].clone(),
    gpShape: studioUniforms.studioGpShape.value[0].clone(),
  };
  const activeUniforms = () => {
    const program = (
      f.renderer.properties.get(material) as {
        currentProgram: { getUniforms(): { seq: { id: string }[] } };
      }
    ).currentProgram;
    return program.getUniforms().seq.map((u) => u.id);
  };
  try {
    cloudShadowUniforms.apexCloudShadow.value.y = 0;
    studioUniforms.studioCarCount.value = 0;
    atmosphere.sigma.value = 0;
    const fullZero = f.draw();
    const enabledUniforms = activeUniforms();
    atmosphere.setEnabled(false);
    // Prove shader exclusion independently of setEnabled's zero-density write.
    atmosphere.sigma.value = 0.08;
    const disabled = f.draw(),
      held = f.draw();
    const disabledUniforms = activeUniforms();
    atmosphere.setEnabled(true);
    atmosphere.sigma.value = 0.08;
    const fog = f.draw();
    atmosphere.sigma.value = 0;
    atmosphere.setEnabled(false);
    const restored = f.draw();
    const programs = f.renderer.info.programs?.length;
    for (let i = 0; i < 3; i++) {
      atmosphere.setEnabled(true);
      f.draw();
      atmosphere.setEnabled(false);
      f.draw();
    }
    const reusedPrograms = f.renderer.info.programs?.length;
    aerialUniforms.apexAerialExtinction.value.set(0.06, 0.08, 0.11);
    const aerial = f.draw();
    aerialUniforms.apexAerialExtinction.value.copy(saved.extinction);
    cloudShadowUniforms.apexCloudField.value = field;
    cloudShadowUniforms.apexCloudShadow.value.set(0, 0.9, 100, 0.001);
    const cloud = f.draw();
    cloudShadowUniforms.apexCloudShadow.value.y = 0;
    studioUniforms.studioCarCount.value = 1;
    studioUniforms.studioCarPose.value[0].set(p.x, p.z, 0, p.floor);
    studioUniforms.studioGpShape.value[0].set(0, 0, 0, 0);
    const grounding = f.draw();
    return {
      disabled: difference(fullZero.pixels, disabled.pixels),
      held: difference(disabled.pixels, held.pixels),
      restored: difference(disabled.pixels, restored.pixels),
      fog: difference(disabled.pixels, fog.pixels),
      aerial: difference(disabled.pixels, aerial.pixels),
      cloud: difference(disabled.pixels, cloud.pixels),
      grounding: difference(disabled.pixels, grounding.pixels),
      enabledUniforms,
      disabledUniforms,
      programs,
      reusedPrograms,
      countsEqual: [held, fog, restored, aerial, cloud, grounding].every(
        (v) =>
          v.calls === disabled.calls &&
          v.triangles === disabled.triangles &&
          v.geometries === disabled.geometries,
      ),
      glError: f.renderer.getContext().getError(),
      image: f.renderer.domElement.toDataURL('image/png'),
    };
  } finally {
    aerialUniforms.apexAerialExtinction.value.copy(saved.extinction);
    cloudShadowUniforms.apexCloudField.value = saved.field;
    cloudShadowUniforms.apexCloudShadow.value.copy(saved.shadow);
    studioUniforms.studioCarCount.value = saved.carCount;
    studioUniforms.studioCarPose.value[0].copy(saved.carPose);
    studioUniforms.studioGpShape.value[0].copy(saved.gpShape);
    field.dispose();
    material.dispose();
    f.dispose();
  }
}
