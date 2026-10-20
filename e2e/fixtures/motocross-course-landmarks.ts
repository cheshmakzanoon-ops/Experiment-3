import * as T from 'three';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
import { BuildQueue } from '../../src/rendering/build-queue.ts';
import { OffroadScene } from '../../src/rendering/offroad/index.ts';
import { mxFurnitureGround } from '../../src/rendering/offroad/mx-trackside-furniture.ts';
import { scannedGround } from '../../src/rendering/ground/scan-store.ts';
import { disposeTextureLoaders } from '../../src/rendering/assets/texture-loader.ts';
import { materials } from '../../src/rendering/materials/index.ts';
import { lightPoolUniforms } from '../../src/rendering/studio/light-pools.ts';
import { rigTrack } from '../../src/simulation/offroad/jump-rig.ts';
import { Track, trackPoint } from '../../src/simulation/track.ts';
import { TrackTerrainSurface } from '../../src/simulation/offroad/course-terrain.ts';
import {
  brakingBumpSample,
  sampleBrakingBumps,
} from '../../src/simulation/offroad/braking-bumps.ts';
import { chainShaderHook } from '../../src/rendering/studio/shader-hooks.ts';
import type { TerrainView } from '../../src/rendering/offroad/terrain-view.ts';

/** Read the actual production mesh and compare its attributes with the
 * physical course field. This does not inject or replace rendered geometry. */
function inspectBrakingField(surface: TrackTerrainSurface, view: TerrainView) {
  const terrain = surface.terrain,
    lines = surface.course.spec.brakingBumps ?? [],
    maximumHeight = Math.max(0.001, ...lines.map((line) => line.height)),
    sample = brakingBumpSample();
  let finite = true,
    vertices = 0,
    workedVertices = 0,
    maxVertexHeightErrorM = 0,
    maxFootprintError = 0,
    maxRaisedSoilError = 0,
    maxMeshInterpolationErrorM = 0;
  for (const child of view.group.children) {
    if (!(child instanceof T.Mesh)) continue;
    const geometry = child.geometry,
      positions = geometry.getAttribute('position'),
      course = geometry.getAttribute('mxCourse'),
      work = geometry.getAttribute('mxBrakingWork');
    for (const name of ['position', 'normal', 'mxCourse', 'mxBrakingWork']) {
      const attribute = geometry.getAttribute(name) as T.BufferAttribute;
      if (!attribute) {
        finite = false;
        continue;
      }
      for (const value of attribute.array) if (!Number.isFinite(value)) finite = false;
    }
    if (!positions || !course || !work) continue;
    vertices += positions.count;
    for (let i = 0; i < positions.count; i++) {
      const lateral = course.getX(i),
        s = course.getY(i);
      sampleBrakingBumps(lines, s, lateral, surface.track.length, sample);
      maxFootprintError = Math.max(maxFootprintError, Math.abs(work.getX(i) - sample.work));
      maxRaisedSoilError = Math.max(
        maxRaisedSoilError,
        Math.abs(work.getY(i) - sample.h / maximumHeight),
      );
      if (sample.work <= 0) continue;
      workedVertices++;
      maxVertexHeightErrorM = Math.max(
        maxVertexHeightErrorM,
        Math.abs(positions.getY(i) - terrain.baseHeight(s, lateral)),
      );
    }
  }
  for (const line of lines)
    for (let s = line.from + 0.25; s < line.to; s += 0.5)
      maxMeshInterpolationErrorM = Math.max(
        maxMeshInterpolationErrorM,
        Math.abs(view.heightAt(s, line.centre) - terrain.baseHeight(s, line.centre)),
      );
  return {
    finite,
    vertices,
    workedVertices,
    maxVertexHeightErrorM,
    maxFootprintError,
    maxRaisedSoilError,
    maxMeshInterpolationErrorM,
  };
}

/** Isolated production course objects under controlled inspection lighting.
 * This deliberately reports a component render, not full-game FPS. The full
 * app/worker/controls are exercised separately by MX45. */
export async function captureMxCourseIdentities(
  circuit: 'valley-ridge-mx' | 'arena-nord-sx',
  inspection: 'landmarks' | 'braking-lines' = 'landmarks',
) {
  const track = rigTrack(circuit),
    surface = Track.offroadOf(track) as TrackTerrainSurface,
    originalTerrainHash = inspection === 'braking-lines' ? surface.terrain.hash() : null,
    queue = new BuildQueue(),
    world = new OffroadScene(track, queue);
  queue.runSynchronously();
  const renderer = new T.WebGLRenderer({ antialias: true, preserveDrawingBuffer: true });
  renderer.setSize(1280, 800);
  renderer.setPixelRatio(1);
  renderer.outputColorSpace = T.SRGBColorSpace;
  renderer.toneMapping = T.ACESFilmicToneMapping;
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = T.PCFSoftShadowMap;
  const scene = new T.Scene(),
    indoor = circuit === 'arena-nord-sx',
    camera = new T.PerspectiveCamera(48, 1.6, 0.1, 1400),
    sun = new T.DirectionalLight(indoor ? 0xd9e9ff : 0xffebce, indoor ? 2.5 : 3.1);
  scene.background = new T.Color(indoor ? 0x142135 : 0xb9cbd4);
  scene.fog = new T.Fog(scene.background, 220, 1200);
  sun.castShadow = true;
  sun.shadow.mapSize.set(2048, 2048);
  sun.shadow.normalBias = 0.012;
  Object.assign(sun.shadow.camera, {
    left: -25,
    right: 25,
    top: 25,
    bottom: -25,
    near: 0.1,
    far: 150,
  });
  scene.add(world.group, sun, sun.target, new T.HemisphereLight(0xc8e1f1, 0x746149, 1.05));
  const pmrem = new T.PMREMGenerator(renderer),
    room = new RoomEnvironment(),
    environment = pmrem.fromScene(room, 0.08);
  scene.environment = environment.texture;
  scene.environmentIntensity = 0.55;
  const strength = lightPoolUniforms.lightPoolStrength.value;
  lightPoolUniforms.lightPoolStrength.value = 0;
  const patches: T.Mesh<T.PlaneGeometry, T.MeshStandardMaterial>[] = [];
  const targets: {
    label: string;
    x: number;
    y: number;
    z: number;
    yaw: number;
    distance: number;
    front: number;
    rise?: number;
  }[] =
    inspection === 'landmarks'
      ? world.landmarks!.plan.landmarks.map((site) => ({
          label: site.kind,
          x: site.x,
          y: site.y + (site.kind === 'quarry' ? 2 : 2.6),
          z: site.z,
          yaw: site.yaw,
          distance: site.kind === 'quarry' ? 24 : 20,
          front: -1,
        }))
      : [];
  const guide = world.landmarks!.plan.guides[0];
  if (guide && inspection === 'landmarks')
    targets.push({
      label: 'jump-guide',
      x: guide.x,
      y: guide.y + 1.2,
      z: guide.z,
      yaw: guide.yaw,
      distance: 4.1,
      front: 1,
    });
  if (inspection === 'braking-lines')
    for (const line of surface.course.spec.brakingBumps ?? []) {
      const s = (line.from + line.to) / 2,
        point = track.at(s, trackPoint());
      targets.push({
        label: line.name.toLowerCase().replaceAll(' ', '-'),
        x: point.x,
        y: surface.terrain.baseHeight(s, 0) + 0.2,
        z: point.z,
        yaw: Math.atan2(point.tx, point.tz),
        distance: 14.3,
        front: -1,
        rise: 1.9,
      });
    }
  if (!indoor) {
    // Local ground is sampled from the same visible-ground query used for
    // each footing, rather than moving models down to an arbitrary flat plane.
    for (const target of targets) {
      const geometry = new T.PlaneGeometry(66, 66, 44, 44).rotateX(-Math.PI / 2),
        position = geometry.getAttribute('position');
      for (let i = 0; i < position.count; i++) {
        const x = target.x + position.getX(i),
          z = target.z + position.getZ(i),
          p = trackPoint(),
          lateral = track.nearest(x, z, p);
        const y = mxFurnitureGround(track, x, z) - 0.025;
        position.setXYZ(i, x, y, z);
        // TerrainView owns every legal riding surface; this substrate sits
        // below it and only fills the ground behind the course furniture.
        if (Math.abs(lateral) < p.width + 4) position.setY(i, y - 0.2);
      }
      geometry.computeVertexNormals();
      const patch = new T.Mesh(
        geometry,
        new T.MeshStandardMaterial({ color: 0x656b49, roughness: 1 }),
      );
      patch.receiveShadow = true;
      patches.push(patch);
      scene.add(patch);
    }
  }
  try {
    let brakingShaderCompiled = false;
    if (inspection === 'braking-lines')
      chainShaderHook(world.terrain!.material, 'mx-braking-review-observe-v1', (shader) => {
        // Observe the production shader after its material hooks compose.
        // A registered hook name alone would not prove that it compiled.
        brakingShaderCompiled =
          shader.vertexShader.includes('vMxBrakingWork = mxBrakingWork;') &&
          shader.fragmentShader.includes('vMxBrakingWork.x') &&
          shader.fragmentShader.includes('vMxBrakingWork.y');
      });
    materials.prepare(renderer);
    scannedGround.attach(renderer, 'high');
    if (!(await scannedGround.ready(60000)))
      throw new Error(`Scans unavailable: ${JSON.stringify(scannedGround.diagnostics())}`);
    const captures = [],
      brakingField =
        inspection === 'braking-lines' ? inspectBrakingField(surface, world.terrain!) : null;
    for (const target of targets) {
      const rightX = Math.cos(target.yaw),
        rightZ = -Math.sin(target.yaw),
        forwardX = Math.sin(target.yaw),
        forwardZ = Math.cos(target.yaw);
      camera.position.set(
        target.x + target.front * forwardX * target.distance + rightX * target.distance * 0.34,
        target.y + (target.rise ?? (target.label === 'jump-guide' ? 0.1 : 3.0)),
        target.z + target.front * forwardZ * target.distance + rightZ * target.distance * 0.34,
      );
      camera.lookAt(target.x, target.y, target.z);
      sun.position.set(target.x - 22, target.y + 40, target.z + 25);
      sun.target.position.set(target.x, target.y, target.z);
      renderer.render(scene, camera);
      renderer.render(scene, camera);
      const gl = renderer.getContext();
      let pixels: { distinctColors: number; luminanceRange: number } | null = null;
      if (inspection === 'braking-lines') {
        const rgba = new Uint8Array(1280 * 800 * 4),
          colors = new Set<number>();
        gl.readPixels(0, 0, 1280, 800, gl.RGBA, gl.UNSIGNED_BYTE, rgba);
        let low = Infinity,
          high = -Infinity;
        for (let i = 0; i < rgba.length; i += 4 * 31) {
          const red = rgba[i],
            green = rgba[i + 1],
            blue = rgba[i + 2],
            luminance = red * 0.2126 + green * 0.7152 + blue * 0.0722;
          colors.add(((red >> 4) << 8) | ((green >> 4) << 4) | (blue >> 4));
          low = Math.min(low, luminance);
          high = Math.max(high, luminance);
        }
        pixels = { distinctColors: colors.size, luminanceRange: high - low };
      }
      captures.push({
        label: target.label,
        image: renderer.domElement.toDataURL('image/png'),
        glError: gl.getError(),
        calls: renderer.info.render.calls,
        triangles: renderer.info.render.triangles,
        landmarks: world.landmarks!.plan.landmarks.map(({ kind, name }) => ({ kind, name })),
        guides: world.landmarks!.plan.guides.map(({ jump, station }) => ({
          name: jump.name,
          station,
        })),
        brakingLines: surface.course.spec.brakingBumps ?? [],
        brakingField,
        brakingShaderCompiled,
        terrainUnchanged:
          originalTerrainHash === null || surface.terrain.hash() === originalTerrainHash,
        pixels,
        budget: { draws: world.landmarks!.draws, triangles: world.landmarks!.triangles },
        soilScans: scannedGround.diagnostics(),
        view: { camera: camera.position.toArray(), lookAt: [target.x, target.y, target.z] },
      });
    }
    return captures;
  } finally {
    lightPoolUniforms.lightPoolStrength.value = strength;
    scannedGround.detach(renderer);
    world.dispose();
    for (const patch of patches) {
      patch.geometry.dispose();
      patch.material.dispose();
    }
    environment.dispose();
    room.dispose();
    pmrem.dispose();
    await disposeTextureLoaders(renderer);
    renderer.dispose();
    renderer.forceContextLoss();
  }
}
