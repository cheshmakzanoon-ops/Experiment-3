import * as T from 'three';
import { RacingRenderer } from '../../src/rendering/renderer.ts';
import { graphicsPreset } from '../../src/rendering/options.ts';
import { lightingDirection } from '../../src/rendering/daylight.ts';
import { Simulation } from '../../src/simulation/world.ts';
import { DEFAULT_OPTIONS } from '../../src/simulation/config.ts';
import { H } from '../../src/simulation/protocol.ts';

/** Uses the complete production factory. Fixed survey cameras are supplementary;
 * the normal cockpit render below retains the compositor, mirrors and car grid. */
export async function surveyInfrastructure(lighting: 'day' | 'sunset' | 'night') {
  const width = 1280,
    height = 720;
  const sim = new Simulation({
    ...DEFAULT_OPTIONS,
    mode: 'race',
    opponents: 11,
    weather: lighting === 'night' ? 'rain' : 'clear',
    seed: 1887,
  });
  sim.autoPlayer = true;
  const reset = sim.makeFrame().slice();
  const history = new Map<number, Float32Array>();
  for (let i = 0; i < 8 * 120; i++) {
    sim.step(1 / 120);
    const f = sim.makeFrame();
    if (!history.has(f[H.LIGHTS])) history.set(f[H.LIGHTS], f.slice());
  }
  const frame = sim.makeFrame().slice(),
    original = frame.slice(),
    water = sim.track.water.slice();
  const canvas = document.createElement('canvas');
  document.body.style.cssText = 'margin:0';
  canvas.style.cssText = `display:block;width:${width}px;height:${height}px`;
  document.body.append(canvas);
  const graphics = { ...graphicsPreset('medium'), resolutionScale: 1 };
  console.info('[infrastructure] production factory');
  const view = await RacingRenderer.create(
    canvas,
    sim.track,
    () => {},
    () => false,
    { quality: 'medium', graphics },
  );
  if (!view) throw new Error('Unexpectedly cancelled infrastructure factory');
  const gl = view.renderer.getContext();
  const pixels = new Uint8Array(width * height * 4),
    blanked = new Uint8Array(pixels.length);
  const kitNames = [
    'concreteBarriers',
    'steelGuardrails',
    'catchFence',
    'impactBarriers',
    'recoveryGates',
    'marshalPosts',
    'startGantry',
  ] as const;
  const kits = kitNames.map((name) => view.circuit[name]);
  const images: {
    name: string;
    image: string;
    calls: number;
    triangles: number;
    lit: number;
    range: number;
    changed: number | null;
    peakDelta: number | null;
  }[] = [];
  const update = (f = frame) => {
    for (const kit of kits) kit?.update(view.camera, 'medium');
    view.circuit.startFinish?.update(f, view.camera, lighting === 'night');
    view.circuit.staff.update(f, view.camera.position, true);
    for (const crowd of view.circuit.crowdClusters)
      crowd.update(
        f[H.TIME],
        view.camera.position,
        f[H.RAIN],
        f,
        view.camera.fov,
        view.camera.aspect,
      );
    view.sun.target.position.copy(view.camera.position);
    view.sun.position.copy(view.camera.position).add(lightingDirection(lighting));
    view.venueLighting.update(
      lighting !== 'day',
      view.camera.position,
      lighting === 'sunset' ? 0.18 : 1,
    );
  };
  const camera = (eye: number[], target: number[], fov = 48) => {
    view.camera.position.copy(view.circuit.at(eye[0], eye[1], eye[2]));
    view.camera.lookAt(view.circuit.at(target[0], target[1], target[2]));
    view.camera.fov = fov;
    view.camera.updateProjectionMatrix();
    update();
  };
  const render = () => {
    view.renderer.info.reset();
    view.renderer.render(view.scene, view.camera);
    gl.readPixels(0, 0, width, height, gl.RGBA, gl.UNSIGNED_BYTE, pixels);
  };
  const capture = (name: string, root?: T.Group) => {
    console.info('[infrastructure] capture', name);
    render();
    const image = canvas.toDataURL('image/png');
    const calls = view.renderer.info.render.calls,
      triangles = view.renderer.info.render.triangles;
    let min = 255,
      max = 0,
      lit = 0;
    for (let i = 0; i < pixels.length; i += 4) {
      const v = Math.max(pixels[i], pixels[i + 1], pixels[i + 2]);
      min = Math.min(min, v);
      max = Math.max(max, v);
      if (v > 2) lit++;
    }
    let changed: number | null = null,
      peakDelta: number | null = null;
    if (root) {
      blanked.set(pixels);
      const visible = root.visible;
      try {
        root.visible = false;
        render();
      } finally {
        root.visible = visible;
      }
      changed = 0;
      peakDelta = 0;
      for (let i = 0; i < pixels.length; i += 4) {
        const delta = Math.max(
          Math.abs(pixels[i] - blanked[i]),
          Math.abs(pixels[i + 1] - blanked[i + 1]),
          Math.abs(pixels[i + 2] - blanked[i + 2]),
        );
        if (delta > 12) changed++;
        peakDelta = Math.max(peakDelta, delta);
      }
      render();
    }
    images.push({
      name,
      image,
      calls,
      triangles,
      lit: lit / (width * height),
      range: max - min,
      changed,
      peakDelta,
    });
  };
  try {
    view.lighting = lighting;
    view.mode = 'cockpit';
    view.draw(frame, frame, 1, 1 / 60);
    gl.readPixels(0, 0, width, height, gl.RGBA, gl.UNSIGNED_BYTE, pixels);
    let cockpitLit = 0,
      cockpitMin = 255,
      cockpitMax = 0;
    for (let i = 0; i < pixels.length; i += 4) {
      const v = Math.max(pixels[i], pixels[i + 1], pixels[i + 2]);
      if (v > 2) cockpitLit++;
      cockpitMin = Math.min(cockpitMin, v);
      cockpitMax = Math.max(cockpitMax, v);
    }
    images.push({
      name: 'normal-cockpit',
      image: canvas.toDataURL('image/png'),
      calls: view.renderer.info.render.calls,
      triangles: view.renderer.info.render.triangles,
      lit: cockpitLit / (width * height),
      range: cockpitMax - cockpitMin,
      changed: null,
      peakDelta: null,
    });
    // Asset controls restore visibility immediately; no simulation field is edited.
    camera([-34, 0, 2.1], [0, 0, 4.4], 51);
    capture('A07-grid-approach', view.circuit.startGantry?.root);
    camera([18, -3, 4.2], [0, 0, 5], 55);
    capture('A07-rear-catwalk', view.circuit.startGantry?.root);
    for (const s of [
      { name: 'A01-concrete', station: 100, side: -1, height: 0.65, kit: 'concreteBarriers' },
      { name: 'A03-fence', station: 100, side: -1, height: 2.2, kit: 'catchFence' },
      { name: 'A02-guardrail', station: 430, side: -1, height: 0.6, kit: 'steelGuardrails' },
      { name: 'A04-blocks', station: 1270, side: -1, height: 0.6, kit: 'impactBarriers' },
      { name: 'A04-tyres', station: 1680, side: 1, height: 0.6, kit: 'impactBarriers' },
    ] as const) {
      const l = sim.track.boundary(s.station, s.side) * s.side;
      camera([s.station + 4, l - s.side * 3.4, s.height + 0.8], [s.station, l, s.height], 52);
      capture(s.name, view.circuit[s.kit]?.root);
    }
    // Same authored route plan position is recorded for matched baseline comparison.
    // The site is derived from the original service-site geometry, not test state.
    const gate = view.circuit.recoveryGates?.sites[0];
    const gateStation = gate?.s ?? 1041.1996354671487;
    const gateSide = gate?.side ?? -1;
    const gateL = gateSide * sim.track.boundary(gateStation, gateSide);
    camera([gateStation + 5, gateL - gateSide * 7, 2.1], [gateStation, gateL, 1.5], 54);
    capture('A05-closed-recovery-gate', view.circuit.recoveryGates?.root);
    const post = view.circuit.trackInfrastructure.marshalPosts[0];
    view.camera.position.set(post.x + 4, post.y + 2, post.z + 4);
    view.camera.lookAt(post.x, post.y + 1.0, post.z);
    view.camera.fov = 45;
    view.camera.updateProjectionMatrix();
    update();
    capture('A06-marshal', view.circuit.marshalPosts?.root);
    const marshal = {
      active: view.circuit.staff.active,
      gripError: view.circuit.staff.maxGripError,
      unreachable: view.circuit.staff.unreachable,
    };
    // The retained lamps are sampled in actual GPU pixels, not only materials.
    // Static batching bakes the original gantry transform into lamp geometry.
    // Locate the real material-owning meshes, not their now-different parent.
    view.scene.updateMatrixWorld(true);
    const lampCentres = view.circuit.startLamps.map((material) => {
      const matches: T.Mesh[] = [];
      view.scene.traverse((o) => {
        if (o instanceof T.Mesh && o.material === material) matches.push(o);
      });
      if (matches.length !== 1) throw new Error('Ambiguous retained start-lamp mesh');
      const mesh = matches[0];
      mesh.geometry.computeBoundingBox();
      return mesh.geometry.boundingBox!.getCenter(new T.Vector3()).applyMatrix4(mesh.matrixWorld);
    });
    const lampForward = new T.Vector3()
      .subVectors(lampCentres[4], lampCentres[0])
      .normalize()
      .cross(new T.Vector3(0, 1, 0))
      .normalize();
    view.camera.position.copy(lampCentres[2]).addScaledVector(lampForward, -4.1);
    view.camera.position.y -= 0.05;
    view.camera.lookAt(lampCentres[2]);
    view.camera.fov = 38;
    view.camera.updateProjectionMatrix();
    update();
    const faceBrightness = () =>
      Array.from({ length: 5 }, (_, i) => {
        const p = lampCentres[i].clone().addScaledVector(lampForward, -0.045).project(view.camera);
        const x = Math.round(((p.x + 1) * width) / 2),
          y = Math.round(((p.y + 1) * height) / 2);
        if (x < 4 || x >= width - 4 || y < 4 || y >= height - 4)
          throw new Error('Lamp face outside view');
        let red = 0;
        for (let dy = -3; dy <= 3; dy++)
          for (let dx = -3; dx <= 3; dx++) red += pixels[((y + dy) * width + x + dx) * 4];
        return red / 49;
      });
    view.circuit.update(reset);
    render();
    const off = faceBrightness();
    const lampSamples: { lights: number; time: number; red: number[]; gain: number[] }[] = [];
    for (const f of [
      reset,
      ...[1, 2, 3, 4, 5].map((n) => history.get(n)!),
      frame,
      history.get(3)!,
      history.get(3)!,
      reset,
    ]) {
      if (!f) throw new Error('Missing physical start-state history');
      const copy = f.slice();
      view.circuit.update(f);
      render();
      const red = faceBrightness();
      if (!copy.every((v, i) => v === f[i]))
        throw new Error('Presentation mutated a recorded start');
      lampSamples.push({
        lights: f[H.LIGHTS],
        time: f[H.TIME],
        red,
        gain: red.map((v, i) => v - off[i]),
      });
    }
    capture('A07-lamp-apertures', view.circuit.startGantry?.root);
    const memoryBefore = { ...view.renderer.info.memory };
    const stableFrame = frame.slice();
    view.circuit.update(stableFrame);
    update(stableFrame);
    render();
    const held = pixels.slice();
    for (let i = 0; i < 4; i++) {
      view.circuit.update(stableFrame);
      update(stableFrame);
      render();
    }
    let heldMaxDelta = 0;
    for (let i = 0; i < pixels.length; i++)
      heldMaxDelta = Math.max(heldMaxDelta, Math.abs(pixels[i] - held[i]));
    const memoryAfter = { ...view.renderer.info.memory };
    const source = view.stats();
    // Distant LOD is not an FPS claim. Every kit must keep a silhouette at distance.
    view.camera.position.addScalar(3000);
    for (const kit of kits) kit?.update(view.camera, 'medium');
    const far = kits.map((kit) => kit?.diagnostics() ?? null);
    return {
      lighting,
      images,
      lampSamples,
      source,
      far,
      marshal,
      memoryBefore,
      memoryAfter,
      heldMaxDelta,
      sourceUnchanged: original.every((v, i) => v === frame[i]),
      waterUnchanged: water.every((v, i) => v === sim.track.water[i]),
      glError: gl.getError(),
      contextLost: gl.isContextLost(),
      gate: { station: gateStation, side: gateSide },
      boundary:
        'Production assets, fixed GPU surveys and ordinary cockpit render; not hardware FPS or continuous human-lap approval.',
    };
  } finally {
    view.dispose();
    canvas.remove();
  }
}
