import * as T from 'three';
import { CIRCUITS } from '../../src/simulation/circuits.ts';
import { Track, trackPoint } from '../../src/simulation/track.ts';
import { standMaterials } from '../../src/rendering/grandstand.ts';
import type { CrowdCluster } from '../../src/rendering/crowd.ts';
import { studioUniforms } from '../../src/rendering/studio/studio-frame.ts';
import { VenueKitContext } from '../../src/rendering/venue-kit/context.ts';
import { gpSpectatorBankPlan } from '../../src/rendering/venue-kit/gp-spectator-bank-sites.ts';
import {
  buildGpSpectatorBank,
  gpBankSurface,
} from '../../src/rendering/venue-kit/gp-spectator-banks.ts';
import { WeatherPresentation } from '../../src/rendering/weather-presentation.ts';
import { cataloguePlantingGround } from '../../src/rendering/venue-kit/planting-ground.ts';
import { apronWidth } from '../../src/simulation/gp-course-edges.ts';
import { VEGETATION, vegetationUniforms } from '../../src/rendering/vegetation/materials.ts';
import { VegetationLibrary } from '../../src/rendering/vegetation/library.ts';
import { gpBankGrass, TrackGrass } from '../../src/rendering/vegetation/grass.ts';
import { disposePhase27Scene } from './phase27c-resources.ts';

/** Isolated trackside camera on the actual Cape Wrenna bank, with the live
 * crowd, weather mast, rail, staged flags and surveyed terrain coordinates. */
export async function captureGpViewingBank() {
  const track = new Track('clear', false, undefined, CIRCUITS['cape-wrenna']);
  const site = gpSpectatorBankPlan(track)[0],
    kit = new VenueKitContext(track),
    stands = standMaterials(track);
  const props = new T.Group(),
    crowd = new T.Group(),
    groups: CrowdCluster[] = [];
  const { sleeve, profile } = buildGpSpectatorBank(
    track,
    site,
    props,
    crowd,
    groups,
    kit.materials.ground,
    stands.people,
    kit.materials.steel,
    true,
  );
  const scene = new T.Scene(),
    camera = new T.PerspectiveCamera(31, 2, 0.04, 200);
  const gl = new T.WebGLRenderer({ antialias: true, preserveDrawingBuffer: true });
  gl.setSize(840, 420, false);
  gl.toneMapping = T.ACESFilmicToneMapping;
  gl.shadowMap.enabled = true;
  scene.background = new T.Color(0xb4c6cf);
  scene.fog = new T.FogExp2(0xb4c6cf, 0.0025);
  scene.add(props, crowd);
  const sun = new T.DirectionalLight(0xffe4bd, 2.35);
  sun.position.set(-4, 6, 3);
  scene.add(sun, new T.HemisphereLight(0xd4e4ee, 0x87735c, 1.35));
  const weather = new WeatherPresentation();
  weather.install(props);
  weather.install(crowd);
  const land = props.getObjectByName('GP general-admission bank')!;
  land.updateWorldMatrix(true, true);
  const sock = land.getObjectByName('GP sector wind sleeve')!;
  const surface = gpBankSurface(track, site);
  const at = (x: number, y: number, z: number) => land.localToWorld(new T.Vector3(x, y, z));
  // Ground this near-rail study on the surveyed surroundings of the same bank.
  // The camera faces away from the course. Omit any triangles over the circuit.
  const apron = new T.PlaneGeometry(185, 230, 42, 54).rotateX(-Math.PI / 2);
  const pos = apron.getAttribute('position'),
    uv = apron.getAttribute('uv'),
    edge = new Float32Array(pos.count),
    inset = new Float32Array(pos.count);
  const near = trackPoint(),
    ground = cataloguePlantingGround(track);
  for (let i = 0; i < pos.count; i++) {
    const p = at(pos.getX(i), 0, pos.getZ(i)),
      lateral = track.nearest(p.x, p.z, near);
    pos.setXYZ(i, p.x, ground(near.s, lateral, p.x, p.z) - 0.055, p.z);
    uv.setXY(i, lateral / 5, near.s / 5);
    edge[i] = Math.abs(lateral) - near.width;
    inset[i] = 4 - apronWidth(track.gpEdges!.at(near.s, lateral < 0 ? -1 : 1));
  }
  const index = apron.index!,
    offRoad: number[] = [];
  for (let j = 0; j < index.count; j += 3) {
    const a = index.getX(j),
      b = index.getX(j + 1),
      c = index.getX(j + 2);
    if (Math.min(edge[a], edge[b], edge[c]) > 4) offRoad.push(a, b, c);
  }
  apron.setIndex(offRoad);
  apron.setAttribute('edgeMetres', new T.BufferAttribute(edge, 1));
  apron.setAttribute('gpVergeInset', new T.BufferAttribute(inset, 1));
  apron.computeVertexNormals();
  const naturalGround = new T.Mesh(apron, kit.materials.ground);
  naturalGround.receiveShadow = true;
  scene.add(naturalGround);
  const centre = at(0, surface.height(0, 0), 0);
  sun.target.position.copy(centre);
  sun.position.copy(centre).add(new T.Vector3(-31, 43, 21));
  sun.castShadow = true;
  sun.shadow.mapSize.set(1024, 1024);
  Object.assign(sun.shadow.camera, {
    left: -41,
    right: 41,
    top: 34,
    bottom: -34,
    near: 2,
    far: 115,
  });
  sun.shadow.normalBias = 0.024;
  scene.add(sun.target);
  const shots: { name: string; image: string; draws: number; triangles: number }[] = [];
  const wind = studioUniforms.studioWind.value.clone(),
    clock = studioUniforms.studioTime.value;
  let meadow: TrackGrass | undefined;
  const previousEye = vegetationUniforms.vegEye.value.clone(),
    previousLod = vegetationUniforms.vegLod.value.clone();
  const snap = (name: string) => {
    camera.getWorldPosition(vegetationUniforms.vegEye.value);
    vegetationUniforms.vegLod.value.z = 0.7 * VEGETATION.grass.high;
    vegetationUniforms.vegLod.value.w = VEGETATION.grass.high;
    meadow?.update(camera, VEGETATION.grass.high);
    for (const c of groups) c.update(4, camera.position, 0, undefined, camera.fov, 2, true, 420);
    const wind = studioUniforms.studioWind.value;
    wind.z = studioUniforms.studioTime.value;
    sleeve!.presentWorld(wind);
    gl.render(scene, camera);
    shots.push({
      name,
      image: gl.domElement.toDataURL('image/png'),
      draws: gl.info.render.calls,
      triangles: gl.info.render.triangles,
    });
    const pix = new Uint8Array(840 * 420 * 4),
      ctx = gl.getContext();
    ctx.readPixels(0, 0, 840, 420, ctx.RGBA, ctx.UNSIGNED_BYTE, pix);
    return pix;
  };
  const difference = (a: Uint8Array, b: Uint8Array) => {
    let count = 0;
    for (let i = 0; i < a.length; i += 4)
      if (
        Math.max(
          Math.abs(a[i] - b[i]),
          Math.abs(a[i + 1] - b[i + 1]),
          Math.abs(a[i + 2] - b[i + 2]),
        ) > 4
      )
        count++;
    return count;
  };
  const library = await VegetationLibrary.load(gl, ['grass-meadow']);
  try {
    const species = library.get('grass-meadow');
    if (!species?.grass) throw new Error('Cape Wrenna meadow textures failed to load');
    const tiles = species.grass.tiles;
    meadow = new TrackGrass(species, gpBankGrass(profile, tiles, Math.ceil(tiles / 2), 0.06));
    scene.add(meadow.root);
    studioUniforms.studioTime.value = 7.35;
    studioUniforms.studioWind.value.set(7, 3, 7.35, 0.81);
    const middle = surface.height(0, 0);
    camera.position.copy(at(-site.side * 39, middle + 3.1, -site.length * 0.39));
    camera.lookAt(at(0, middle + 1.9, site.length * 0.06));
    snap('cape-wrenna-viewing-bank');
    const frontX = -site.side * site.width * 0.17;
    camera.position.copy(at(frontX - site.side * 12, surface.height(frontX, -8) + 1.85, -13));
    camera.lookAt(at(0, surface.height(0, 3) + 1.2, 3));
    const planted = snap('cape-wrenna-supporter-rail');
    meadow.root.visible = false;
    const cut = snap('cape-wrenna-mown-control');
    meadow.root.visible = true;
    const target = sock.getWorldPosition(new T.Vector3());
    camera.position.copy(target).add(new T.Vector3(-4.1, 2.6, 6));
    camera.lookAt(target.clone().add(new T.Vector3(0, -0.65, 0)));
    const east = snap('sector-crosswind');
    studioUniforms.studioWind.value.set(0, 0, 7.35, 0);
    const calm = snap('sector-lull');
    studioUniforms.studioWind.value.set(-7, -3, 7.35, 0.81);
    const west = snap('sector-reverse');
    studioUniforms.studioWind.value.set(7, 3, 7.35, 0.81);
    const rewind = snap('sector-rewound');
    return {
      captures: shots,
      meadowClumps: meadow.clumps,
      meadowPixels: difference(planted, cut),
      windPixels: difference(east, west),
      lullPixels: difference(east, calm),
      windRestore: difference(east, rewind),
      glError: gl.getContext().getError(),
    };
  } finally {
    studioUniforms.studioWind.value.copy(wind);
    studioUniforms.studioTime.value = clock;
    weather.dispose();
    vegetationUniforms.vegEye.value.copy(previousEye);
    vegetationUniforms.vegLod.value.copy(previousLod);
    meadow?.dispose();
    library.dispose();
    surface.geometry.dispose();
    disposePhase27Scene(scene);
    gl.dispose();
  }
}
