import * as T from 'three';
import { CIRCUITS } from '../../src/simulation/circuits.ts';
import { Track } from '../../src/simulation/track.ts';
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
import { disposePhase27Scene } from './phase27c-resources.ts';

/** Isolated trackside camera on the actual Cape Wrenna bank, with the live
 * crowd, weather mast, rail, staged flags and surveyed terrain coordinates. */
export function captureGpViewingBank() {
  const track = new Track('clear', false, undefined, CIRCUITS['cape-wrenna']);
  const site = gpSpectatorBankPlan(track)[0],
    kit = new VenueKitContext(track),
    stands = standMaterials(track);
  const props = new T.Group(),
    crowd = new T.Group(),
    groups: CrowdCluster[] = [];
  const sleeve = buildGpSpectatorBank(
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
  scene.background = new T.Color(0xb4c6cf);
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
  const shots: { name: string; image: string; draws: number; triangles: number }[] = [];
  const wind = studioUniforms.studioWind.value.clone(),
    clock = studioUniforms.studioTime.value;
  const snap = (name: string) => {
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
  try {
    studioUniforms.studioTime.value = 7.35;
    studioUniforms.studioWind.value.set(7, 3, 7.35, 0.81);
    const middle = surface.height(0, 0);
    camera.position.copy(at(-site.side * 39, middle + 3.1, -site.length * 0.39));
    camera.lookAt(at(0, middle + 1.9, site.length * 0.06));
    snap('cape-wrenna-viewing-bank');
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
      windPixels: difference(east, west),
      lullPixels: difference(east, calm),
      windRestore: difference(east, rewind),
      glError: gl.getContext().getError(),
    };
  } finally {
    studioUniforms.studioWind.value.copy(wind);
    studioUniforms.studioTime.value = clock;
    weather.dispose();
    surface.geometry.dispose();
    disposePhase27Scene(scene);
    gl.dispose();
  }
}
