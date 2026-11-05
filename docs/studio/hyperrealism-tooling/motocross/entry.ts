import * as T from 'three';
import { TerrainView } from '../../src/rendering/offroad/terrain-view.ts';
import { rigTrack } from '../../src/simulation/offroad/jump-rig.ts';
import { DirtBikeModel } from '../../src/rendering/offroad/dirt-bike-model.ts';
import { BikeMaterials } from '../../src/rendering/bike.ts';
import { mudUniforms } from '../../src/rendering/offroad/mud.ts';
import { VEHICLES } from '../../src/simulation/vehicles.ts';
import { Stadium } from '../../src/rendering/offroad/stadium.ts';
import { MxDustMaterial } from '../../src/rendering/offroad/mx-dust-material.ts';
import { setMxQuality } from '../../src/rendering/offroad/mx-quality.ts';
import { StartGate } from '../../src/rendering/offroad/start-gate.ts';
import { Track } from '../../src/simulation/track.ts';
import { TrackTerrainSurface } from '../../src/simulation/offroad/course-terrain.ts';

export function run(mode: string, opts: { mud?: number; wet?: number; view?: string; preset?: string } = {}) {
  const errors: string[] = [];
  const canvas = document.createElement('canvas');
  document.body.appendChild(canvas);
  const W = 640, H = 400;
  const renderer = new T.WebGLRenderer({ canvas, antialias: true, preserveDrawingBuffer: true });
  renderer.setSize(W, H, false);
  renderer.toneMapping = T.ACESFilmicToneMapping;
  renderer.shadowMap.enabled = true;
  renderer.debug.checkShaderErrors = true;
  renderer.debug.onShaderError = (gl, program, vs, fs) => {
    errors.push(String(gl.getProgramInfoLog(program)) + '\nVS:' + gl.getShaderInfoLog(vs) + '\nFS:' + gl.getShaderInfoLog(fs));
  };
  if (opts.preset) setMxQuality(opts.preset as 'low');
  const scene = new T.Scene();
  scene.background = new T.Color(0xa9bfd1);
  const sun = new T.DirectionalLight(0xfff1dd, 3.0);
  scene.add(sun, sun.target, new T.HemisphereLight(0xbcd2ff, 0x5a4632, 1.0));
  const camera = new T.PerspectiveCamera(45, W / H, 0.05, 500);
  if (mode === 'bike') {
    const mud = mudUniforms();
    mud.offroadMud.value = opts.mud ?? 0.7;
    mud.offroadMudWet.value = opts.wet ?? 0.8;
    const model = new DirtBikeModel(VEHICLES['mx450'], 0, 'high', new BikeMaterials(0), mud);
    scene.add(model.root);
    const ground = new T.Mesh(new T.PlaneGeometry(20, 20), new T.MeshStandardMaterial({ color: 0x76604a, roughness: 0.97 }));
    ground.rotation.x = -Math.PI / 2;
    scene.add(ground);
    sun.position.set(-3, 6, -4);
    const v = opts.view ?? 'rear-tyre';
    if (v === 'rear-tyre') { camera.position.set(-0.9, 0.76, -1.65); camera.lookAt(0, 0.36, -0.68); }
    else if (v === 'rear') { camera.position.set(-1.6, 1.4, -3.2); camera.lookAt(0, 0.7, 0); }
    else { camera.position.set(-3.05, 1.72, 3.6); camera.lookAt(0, 0.93, 0); }
  } else if (mode === 'terrain') {
    const track = rigTrack('valley-ridge-mx');
    const view = new TerrainView(track);
    scene.add(view.group);
    const p = track.at(40, { ...track.points[0] } as never) as unknown as { x: number; y: number; z: number; tx: number; tz: number };
    camera.position.set(p.x - p.tx * 6, p.y + 1.8, p.z - p.tz * 6);
    camera.lookAt(p.x + p.tx * 6, p.y, p.z + p.tz * 6);
    sun.position.set(p.x - 30, p.y + 40, p.z + 20);
    sun.target.position.set(p.x, p.y, p.z);
  } else if (mode === 'gate') {
    const track = rigTrack('valley-ridge-mx');
    const course = (Track.offroadOf(track) as TrackTerrainSurface).course;
    const g = new StartGate(track, course);
    scene.add(g.root);
    const view = new TerrainView(track);
    scene.add(view.group);
    const fwd = new T.Vector3(0, 0, 1).applyEuler(g.root.rotation);
    camera.position.copy(g.root.position).addScaledVector(fwd, -5.5).add(new T.Vector3(0, 1.8, 0));
    camera.lookAt(g.root.position.clone().addScaledVector(fwd, 1.5));
    sun.position.set(g.root.position.x - 20, g.root.position.y + 30, g.root.position.z + 10);
    sun.target.position.copy(g.root.position);
  } else if (mode === 'stadium') {
    const arena = new Stadium(rigTrack('arena-nord-sx'));
    scene.add(arena.root);
    const box = new T.Box3().setFromObject(arena.root);
    const c = box.getCenter(new T.Vector3());
    camera.position.set(box.min.x + 25, box.min.y + 4, c.z - 6);
    camera.lookAt(c.x + 20, box.min.y + 12, c.z + 4);
    scene.background = new T.Color(0x05070a);
    const dust = new MxDustMaterial();
    const g = new T.BufferGeometry();
    g.setAttribute('position', new T.BufferAttribute(new Float32Array([c.x, box.min.y + 3, c.z]), 3));
    g.setAttribute('color', new T.BufferAttribute(new Float32Array([0.5, 0.4, 0.3]), 3));
    g.setAttribute('mxParticleSize', new T.BufferAttribute(new Float32Array([2]), 1));
    g.setAttribute('mxParticleAlpha', new T.BufferAttribute(new Float32Array([0.6]), 1));
    g.setAttribute('mxParticleShape', new T.BufferAttribute(new Float32Array([1, 0.3]), 2));
    const pts = new T.Points(g, dust);
    dust.updateViewport(renderer);
    scene.add(pts);
  }
  renderer.render(scene, camera);
  return { errors, url: canvas.toDataURL('image/png') };
}
