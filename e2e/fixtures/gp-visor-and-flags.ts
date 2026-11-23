import * as T from 'three';
import { RoomEnvironment } from 'three/examples/jsm/environments/RoomEnvironment.js';
import { gpEyePose } from '../../src/rendering/gp-helmet-optics.ts';
import { BikeCockpit } from '../../src/rendering/bike-cockpit.ts';
import { Rider } from '../../src/rendering/rider.ts';
import { gpSpectatorFlagMaterial } from '../../src/rendering/gp-spectator-flags.ts';
import { flagGeometry } from '../../src/rendering/studio/crowd-flags.ts';
import { studioHookKeys } from '../../src/rendering/studio/shader-hooks.ts';
import { studioUniforms } from '../../src/rendering/studio/studio-frame.ts';

/** Match the same iris under opposing lamps and in a dark paddock. The
 * production insert uses the original head coordinate frame inside its shell. */
function measureCornealLight(gl: T.WebGLRenderer, face: T.Mesh) {
  const scene = new T.Scene();
  scene.background = new T.Color(0);
  scene.add(new T.Mesh(face.geometry, face.material));
  const camera = new T.PerspectiveCamera(30, gl.domElement.width / gl.domElement.height, .012, 1);
  const iris = new T.Vector3(.031, .0105, .088);
  camera.position.copy(iris).z += .105;
  camera.lookAt(iris);
  const lamp = new T.DirectionalLight(0xffffff, 3);
  lamp.target.position.copy(iris);
  scene.add(lamp, lamp.target);
  const width = 86, height = 30, context = gl.getContext();
  const sample = (x: number, intensity: number) => {
    lamp.position.copy(iris).add(new T.Vector3(x, .18, .5));
    lamp.intensity = intensity;
    gl.render(scene, camera);
    const pixels = new Uint8Array(width * height * 4);
    context.readPixels((gl.domElement.width - width) / 2, (gl.domElement.height - height) / 2,
      width, height, context.RGBA, context.UNSIGNED_BYTE, pixels);
    return Uint8Array.from({length: width * height}, (_, i) =>
      Math.round(.2126 * pixels[i * 4] + .7152 * pixels[i * 4 + 1] + .0722 * pixels[i * 4 + 2]));
  };
  const dark = sample(0, 0), left = sample(-.43, 3), right = sample(.43, 3), repeated = sample(-.43, 3);
  const brightestX = (pixels: Uint8Array) => {
    const threshold = [...pixels].sort((a, b) => b - a)[15];
    let weightedX = 0, sum = 0;
    pixels.forEach((p, i) => {
      if (p >= threshold) { weightedX += (i % width) * p; sum += p; }
    });
    return sum ? weightedX / sum : 0;
  };
  return { darkPeak: Math.max(...dark), leftPeak: Math.max(...left), rightPeak: Math.max(...right),
    leftX: brightestX(left), rightX: brightestX(right), restored: repeated.every((v, i) => v === left[i]) };
}

/** Render the production rider head and instanced supporter cloth in one
 * context. All paired captures use identical lighting and camera poses. */
export function captureGpOpticsAndCloth() {
  const canvas = document.createElement('canvas'), width = 640, height = 360;
  const gl = new T.WebGLRenderer({canvas, antialias: true, preserveDrawingBuffer: true});
  gl.setSize(width, height, false);
  gl.toneMapping = T.ACESFilmicToneMapping;
  const scene = new T.Scene(), room = new RoomEnvironment(), pmrem = new T.PMREMGenerator(gl);
  const environment = pmrem.fromScene(room, .035);
  scene.environment = environment.texture;
  scene.background = new T.Color(0x434d58);
  const camera = new T.PerspectiveCamera(33, width / height, .02, 40);
  const key = new T.DirectionalLight(0xffdfbd, 2.6);
  key.position.set(-1.7, 2.4, 1.8);
  scene.add(key, new T.HemisphereLight(0xd3e5ff, 0x82786f, 1.2));
  const rider = new Rider({primary: 0xaa291b, secondary: 0x151c27, accent: 0xe4c378}, 'high', 'leathers', 23, true);
  const head = rider.root.getObjectByName('Rider head and helmet')!;
  const anchor = head.parent!;
  const dash = new BikeCockpit(17000,true);
  const flags = new T.InstancedMesh(flagGeometry(true), gpSpectatorFlagMaterial(), 3);
  const matrix = new T.Object3D(), tones = [0xa91d32, 0xdc9a1d, 0x204b83];
  for (let i = 0; i < 3; i++) {
    matrix.position.set((i - 1) * 1.25, 0, 0);
    matrix.rotation.y = i * .53;
    matrix.updateMatrix();
    flags.setMatrixAt(i, matrix.matrix);
    flags.setColorAt(i, new T.Color(tones[i]));
  }
  const captures: {name: string; image: string; draws: number; triangles: number}[] = [];
  const snap = (name: string) => {
    gl.render(scene, camera);
    const pixels = new Uint8Array(width * height * 4);
    const context = gl.getContext();
    context.readPixels(0, 0, width, height, context.RGBA, context.UNSIGNED_BYTE, pixels);
    captures.push({name, image: canvas.toDataURL('image/png'), draws: gl.info.render.calls, triangles: gl.info.render.triangles});
    return pixels;
  };
  const changed = (a: Uint8Array, b: Uint8Array) => {
    let count = 0;
    for (let i = 0; i < a.length; i += 4)
      if (Math.max(Math.abs(a[i] - b[i]), Math.abs(a[i + 1] - b[i + 1]), Math.abs(a[i + 2] - b[i + 2])) > 3) count++;
    return count;
  };
  const wind = studioUniforms.studioWind.value.clone(), time = studioUniforms.studioTime.value;
  try {
    scene.add(head);
    head.position.set(0, 0, 0);
    head.quaternion.identity();
    camera.position.set(.08, .097, .59);
    camera.lookAt(0, .065, .03);
    const face = head.getObjectByName('GP recessed brow and eyes');
    if (!(face instanceof T.Mesh)) throw new Error('Missing production GP eye port');
    const cornea = measureCornealLight(gl, face);
    const portrait = snap('coated-visor');
    face.visible = false;
    const liner = snap('liner-without-face');
    face.visible = true;
    const restored = snap('visor-restored');
    const eye = new T.Vector3();
    const eyeFrame = (name: string, time?: number, yaw = 0) => {
      rider.ride({lean: 0, braking: 0, offset: 0, steer: 0, tuck: .4, time,
        sight: {yaw, gradeChange: 0, weight: 1}});
      // Keep the portrait lens locked to the eye port as the riding rig moves.
      head.position.set(0,0,0);
      head.quaternion.identity();
      return snap(name);
    };
    let closeTime = 0;
    while (closeTime < 8 && gpEyePose(eye, 23, closeTime).z < .995) closeTime += .005;
    const looking = eyeFrame('eyes-toward-apex', undefined, .52);
    const blink = eyeFrame('eyelids-closed', closeTime);
    const open = eyeFrame('eyes-rewound');
    const eyeCentre = face.localToWorld(new T.Vector3(0, .0105, .088));
    camera.position.copy(eyeCentre).add(new T.Vector3(0, .011, .245));
    camera.lookAt(eyeCentre);
    const toLeft = eyeFrame('visor-gaze-left', undefined, -.56);
    eyeFrame('visor-gaze-blink', closeTime);
    const toRight = eyeFrame('visor-gaze-right', undefined, .56);
    const leftAgain = eyeFrame('visor-gaze-left-replayed', undefined, -.56);
    // A darker iris moving right leaves a brighter strip behind it. For each
    // eye, measure the distance between the two strips in actual helmet pixels.
    const pupilTravel = [-1, 1].map(side => {
      const centre = face.localToWorld(new T.Vector3(side * .031, .0105, .088)).project(camera);
      const cx = Math.round((centre.x + 1) * width / 2), cy = Math.round((centre.y + 1) * height / 2);
      let gain = 0, loss = 0, gainMoment = 0, lossMoment = 0;
      for (let y = cy - 13; y <= cy + 13; y++) for (let x = cx - 26; x <= cx + 26; x++) {
        const k = 4 * (y * width + x);
        const d = .2126 * (toRight[k] - toLeft[k]) + .7152 * (toRight[k + 1] - toLeft[k + 1])
          + .0722 * (toRight[k + 2] - toLeft[k + 2]);
        if (d > 2) { gain += d; gainMoment += x * d; }
        if (d < -2) { loss -= d; lossMoment -= x * d; }
      }
      return loss && gain ? lossMoment / loss - gainMoment / gain : 0;
    });
    eyeFrame('visor-gaze-centred');
    camera.position.set(.39, .12, .43);
    camera.lookAt(0, .065, .03);
    snap('visor-three-quarter');
    scene.remove(head);
    scene.add(flags);
    camera.position.set(0, .96, 5.5);
    camera.lookAt(0, .94, 0);
    studioUniforms.studioTime.value = 7;
    studioUniforms.studioWind.value.set(6, 2, 7, .8);
    const east = snap('supporters-east');
    studioUniforms.studioWind.value.set(-6, 2, 7, .8);
    const west = snap('supporters-west');
    studioUniforms.studioWind.value.set(0, 0, 7, 0);
    const calm = snap('supporters-calm');
    studioUniforms.studioWind.value.set(6, 2, 7, .8);
    const eastAgain = snap('supporters-rewound');
    scene.remove(flags);
    anchor.add(head);
    let torso: T.Mesh | undefined;
    rider.root.traverse((o) => {
      if (o instanceof T.SkinnedMesh && studioHookKeys(o.material).some(k => k.includes('-torso-'))) torso = o;
    });
    if (!torso) throw new Error('Missing production GP torso skin');
    // Lock the same cut of leather in space, and change its live rider pose.
    // This isolates moving gather highlights from the pitch of the entire bike.
    const garment = new T.Mesh(torso.geometry, torso.material);
    scene.add(garment);
    camera.position.set(.58,.30,-.34);
    camera.lookAt(.09,.235,-.015);
    const hang = (sign: number) => rider.ride({lean: sign*.85, offset: sign*.25, steer: 0, tuck: .25, braking: .18, speed: 36});
    hang(1);
    const loaded = snap('leather-inside-turn');
    hang(-1);
    const released = snap('leather-outside-turn');
    rider.separated(0,0,0);
    snap('leather-recovery');
    hang(1);
    const loadedAgain = snap('leather-turn-rewound');
    scene.remove(garment);
    dash.root.position.set(0,0,0);
    dash.root.rotation.set(0,0,0);
    scene.add(dash.root);
    camera.position.set(-.022,.042,-.212);
    camera.lookAt(0,0,0);
    const race = {speed: 55, rpm: 15200, gear: 4, frontSurfaceTemp: 82,
      rearSurfaceTemp: 96, chassisLean: .59, intervention: .12, brake: .29, throttle: .86};
    dash.update(race);
    const speedFrame = snap('cockpit-tft-at-speed');
    const screen = dash.root.getObjectByName('GP instrument display') as T.Mesh<T.PlaneGeometry,T.MeshPhysicalMaterial>;
    const panel = screen.material.map!.image as HTMLCanvasElement;
    const digitInk = (x: number, y: number, w: number, h: number) => {
      const data = panel.getContext('2d')!.getImageData(x,y,w,h).data;
      let bright = 0;
      for (let i=0;i<data.length;i+=4) if (data[i]>170 && data[i+1]>180 && data[i+2]>170) bright++;
      return bright;
    };
    const speedInk=digitInk(186,108,177,76), gearInk=digitInk(384,108,70,74);
    dash.update({ speed: 0, rpm: 2800, gear: 0, pitLane: true, brake: 1 });
    const pitFrame = snap('cockpit-tft-pit');
    dash.update(race);
    const speedAgain = snap('cockpit-tft-rewound');
    scene.remove(dash.root);
    return {captures, cornea, pupilTravel, gazeRestore: changed(toLeft, leftAgain), speedInk, gearInk, instrumentPixels: changed(speedFrame,pitFrame), instrumentRestore: changed(speedFrame,speedAgain), gatherPixels: changed(loaded,released), gatherRestore: changed(loaded,loadedAgain), gazePixels: changed(portrait,looking), lidPixels: changed(portrait,blink), eyesRestore: changed(portrait,open),
      facePixels: changed(portrait,liner), faceRestore: changed(portrait,restored),
      windPixels: changed(east,west), calmPixels: changed(east,calm), windRestore: changed(east,eastAgain),
      glError: gl.getContext().getError()};
  } finally {
    studioUniforms.studioWind.value.copy(wind);
    studioUniforms.studioTime.value = time;
    anchor.add(head);
    rider.dispose();
    dash.dispose();
    for (const o of dash.root.children) if (o instanceof T.Mesh) o.geometry.dispose();
    flags.geometry.dispose();
    flags.material.dispose();
    flags.dispose();
    environment.dispose();
    pmrem.dispose();
    room.dispose();
    gl.dispose();
  }
}
