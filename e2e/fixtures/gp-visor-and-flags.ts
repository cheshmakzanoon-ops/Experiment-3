import * as T from 'three';
import { RoomEnvironment } from 'three/examples/jsm/environments/RoomEnvironment.js';
import { gpEyePose } from '../../src/rendering/gp-helmet-optics.ts';
import { Rider } from '../../src/rendering/rider.ts';
import { gpSpectatorFlagMaterial } from '../../src/rendering/gp-spectator-flags.ts';
import { flagGeometry } from '../../src/rendering/studio/crowd-flags.ts';
import { studioUniforms } from '../../src/rendering/studio/studio-frame.ts';

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
    if (!face) throw new Error('Missing production GP eye port');
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
    return {captures, gazePixels: changed(portrait,looking), lidPixels: changed(portrait,blink), eyesRestore: changed(portrait,open),
      facePixels: changed(portrait,liner), faceRestore: changed(portrait,restored),
      windPixels: changed(east,west), calmPixels: changed(east,calm), windRestore: changed(east,eastAgain),
      glError: gl.getContext().getError()};
  } finally {
    studioUniforms.studioWind.value.copy(wind);
    studioUniforms.studioTime.value = time;
    anchor.add(head);
    rider.dispose();
    flags.geometry.dispose();
    flags.material.dispose();
    flags.dispose();
    environment.dispose();
    pmrem.dispose();
    room.dispose();
    gl.dispose();
  }
}
