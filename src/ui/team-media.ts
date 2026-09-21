import * as T from 'three';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
import { ForegroundPerson } from '../rendering/foreground-person.ts';
import { box, mesh, mergeStatic, canvasTexture } from '../rendering/geometry.ts';
import { driverProfile, DRIVERS, type TeamState } from '../storage/team-career.ts';
import { teamMediaScript, mediaAt, MEDIA_DURATION } from './team-media-script.ts';
import { escapeHtml } from './team-hub.ts';
import { downloadBlob } from '../storage/data.ts';

/** Explicitly opened, bounded original media scene. It owns a separate canvas,
 * clock, controls and GPU resources; no physics input, race reward, microphone,
 * network connection or invented spoken audio is involved. */
export class TeamMediaView {
  readonly root = document.createElement('section');
  readonly canvas = document.createElement('canvas');
  private renderer!: T.WebGLRenderer;
  private scene = new T.Scene();
  private camera = new T.PerspectiveCamera(42, 16 / 9, 0.05, 40);
  private people: ForegroundPerson[] = [];
  private environment!: T.WebGLRenderTarget;
  private lines: ReturnType<typeof teamMediaScript>;
  private observer!: ResizeObserver;
  private events = new AbortController();
  private frame = 0;
  private previous = -1;
  private dirty = true;
  private disposed = false;
  private time = 0;
  private playing = false;
  private currentLine = -1;
  constructor(
    parent: HTMLElement,
    team: TeamState,
    private reducedMotion = false,
  ) {
    this.lines = teamMediaScript(team);
    this.root.className = 'team-media';
    this.root.innerHTML = `<header><div><span class="eyebrow">APEX / INSIDE THE WORKSHOP</span><h2>Team briefing</h2></div><button data-action="modalClose">RETURN</button></header><p class="media-scope">Original animated, captioned scene using your local team save. No recorded interview or spoken voice. The race remains paused.</p><div class="media-frame"><div class="media-caption"><span data-speaker></span><p data-line></p></div><div class="media-brand">${escapeHtml(team.livery.sponsor)} <b>WEEK ${team.week}</b></div></div><div class="media-controls"><button data-media="play">PLAY BRIEFING</button><button data-media="restart">RESTART</button><label>SCENE TIMELINE<input data-media="seek" type="range" min="0" max="${MEDIA_DURATION}" step=".05" value="0"></label><output data-time>0:00 / 0:47</output><button data-media="photo">CAPTURE SCENE</button></div><details><summary>READ FULL TRANSCRIPT</summary><ol>${this.lines.map((l) => `<li><b>${l.speaker === 'driver' ? escapeHtml(driverProfile(team).name) : 'PRESENTER'}</b> ${escapeHtml(l.text)}</li>`).join('')}</ol></details><p data-media-status role="status">Ready. Captions remain visible throughout the scene.</p>`;
    this.canvas.setAttribute('aria-label', 'Original animated team briefing');
    this.root.querySelector('.media-frame')!.prepend(this.canvas);
    parent.append(this.root);
    try {
      this.renderer = new T.WebGLRenderer({ canvas: this.canvas, antialias: true });
      this.renderer.setPixelRatio(Math.min(1.25, devicePixelRatio));
      this.renderer.toneMapping = T.ACESFilmicToneMapping;
      this.renderer.toneMappingExposure = 0.95;
      this.renderer.shadowMap.enabled = true;
      this.renderer.shadowMap.type = T.PCFSoftShadowMap;
      this.scene.background = new T.Color(0x182128);
      const room = new RoomEnvironment(),
        generator = new T.PMREMGenerator(this.renderer);
      try {
        this.environment = generator.fromScene(room, 0.04, 0.1, 50, { size: 128 });
      } finally {
        generator.dispose();
        room.dispose();
      }
      this.scene.environment = this.environment.texture;
      this.scene.environmentIntensity = 0.32;
      this.scene.add(new T.HemisphereLight(0xb8d8e8, 0x463c30, 0.8));
      const key = new T.DirectionalLight(0xffe6cb, 3.8);
      key.position.set(-3, 4, 4);
      key.castShadow = true;
      key.shadow.mapSize.set(1024, 1024);
      Object.assign(key.shadow.camera, {
        left: -4,
        right: 4,
        top: 4,
        bottom: -4,
        near: 0.1,
        far: 20,
      });
      key.shadow.normalBias = 0.02;
      this.scene.add(key);
      const rim = new T.PointLight(0x9fcadd, 38, 12, 2);
      rim.position.set(2, 2, -2);
      this.scene.add(rim);
      this.buildSet(team);
      const id = Math.max(
        0,
        DRIVERS.findIndex((d) => d.id === team.driver),
      );
      this.people = [
        new ForegroundPerson(id, 'driver'),
        new ForegroundPerson((id + 1) % 4, 'presenter'),
      ];
      this.people[0].root.position.x = -0.62;
      this.people[0].root.rotation.y = 0.25;
      this.people[1].root.position.x = 0.62;
      this.people[1].root.rotation.y = -0.25;
      this.people.forEach((p) => this.scene.add(p.root));
      this.root.addEventListener(
        'click',
        (e) => {
          const action = (e.target as Element).closest<HTMLElement>('[data-media]')?.dataset.media;
          if (action === 'play') {
            this.playing = !this.playing;
            if (this.time >= MEDIA_DURATION) this.time = 0;
            this.previous = -1;
            this.dirty = true;
            this.buttons();
          }
          if (action === 'restart') {
            this.time = 0;
            this.playing = false;
            this.dirty = true;
            this.buttons();
          }
          if (action === 'photo') {
            try {
              this.capture();
            } catch (error) {
              this.status(
                `Scene capture failed: ${error instanceof Error ? error.message : String(error)}`,
              );
            }
          }
        },
        { signal: this.events.signal },
      );
      this.root.addEventListener(
        'input',
        (e) => {
          const input = e.target as HTMLInputElement;
          if (input.dataset.media === 'seek') {
            this.seek(Number(input.value));
          }
        },
        { signal: this.events.signal },
      );
      document.addEventListener(
        'visibilitychange',
        () => {
          if (document.hidden) {
            this.playing = false;
            this.previous = -1;
            this.buttons();
            this.status('Paused because the page became hidden.');
          }
        },
        { signal: this.events.signal },
      );
      this.canvas.addEventListener(
        'webglcontextlost',
        (e) => {
          e.preventDefault();
          this.playing = false;
          this.status('Graphics context lost. Close and reopen this briefing.');
        },
        { signal: this.events.signal },
      );
      this.observer = new ResizeObserver(() => {
        this.resize();
      });
      this.observer.observe(this.root.querySelector('.media-frame')!);
      this.resize();
      this.draw();
      this.frame = requestAnimationFrame(this.tick);
    } catch (error) {
      this.dispose();
      throw error;
    }
  }
  private buildSet(team: TeamState) {
    const group = new T.Group(),
      floor = new T.MeshStandardMaterial({ color: 0x343f42, roughness: 0.45, metalness: 0.1 }),
      steel = new T.MeshStandardMaterial({ color: 0x25343d, metalness: 0.65, roughness: 0.35 }),
      paint = new T.MeshStandardMaterial({ color: team.livery.primary, roughness: 0.6 }),
      wood = new T.MeshStandardMaterial({ color: 0x795942, roughness: 0.8 });
    box(group, floor, 0, -0.065, 0, 12, 0.12, 10);
    box(group, steel, 0, 2, -2.4, 10, 4, 0.12);
    for (let x = -4.5; x < 4.5; x += 0.45) box(group, wood, x, 2.1, -2.28, 0.075, 3.8, 0.09);
    box(group, paint, 0, 1.45, -2.15, 3.9, 2.1, 0.05);
    const map = canvasTexture(1024, 256, (c) => {
      c.fillStyle = '#12262e';
      c.fillRect(0, 0, 1024, 256);
      c.fillStyle = '#f4eee0';
      c.font = '800 83px Arial';
      c.fillText(team.livery.sponsor, 48, 118, 928);
      c.fillStyle = '#a4c8cb';
      c.font = '500 28px Arial';
      c.fillText('ENGINEERING / TEAM OPERATIONS', 50, 181, 925);
    });
    mesh(group, new T.PlaneGeometry(3.4, 0.85), new T.MeshBasicMaterial({ map }), 0, 2, -2.1);
    for (const side of [-1, 1]) {
      box(group, steel, side * 3.3, 0.48, -1.3, 2.1, 0.86, 0.85);
      box(group, floor, side * 3.3, 0.95, -1.3, 2.25, 0.08, 0.95);
      for (let j = 0; j < 4; j++)
        box(group, wood, side * 3.3, 0.2 + j * 0.19, -0.86, 1.9, 0.14, 0.025);
    }
    mergeStatic(group);
    this.scene.add(group);
  }
  private resize() {
    const width = Math.max(
      240,
      Math.min(1280, this.root.querySelector('.media-frame')!.clientWidth || 800),
    );
    const height = Math.round((width * 9) / 16);
    this.renderer.setSize(width, height, false);
    this.camera.aspect = width / height;
    this.camera.updateProjectionMatrix();
    this.dirty = true;
  }
  private buttons() {
    this.root.querySelector('[data-media="play"]')!.textContent = this.playing
      ? 'PAUSE'
      : 'PLAY BRIEFING';
  }
  private status(text: string) {
    this.root.querySelector('[data-media-status]')!.textContent = text;
  }
  seek(time: number) {
    if (!Number.isFinite(time)) throw new Error('Invalid briefing seek');
    this.time = T.MathUtils.clamp(time, 0, MEDIA_DURATION);
    this.playing = false;
    this.previous = -1;
    this.dirty = true;
    this.buttons();
  }
  private tick = (now: number) => {
    if (this.disposed) return;
    if (!this.root.isConnected) {
      this.dispose();
      return;
    }
    if (this.previous < 0) this.previous = now;
    const elapsed = (now - this.previous) / 1000;
    if (this.dirty || (this.playing && elapsed >= 1 / 30)) {
      if (this.playing) {
        this.time = Math.min(MEDIA_DURATION, this.time + Math.min(0.1, elapsed));
        if (this.time >= MEDIA_DURATION) {
          this.playing = false;
          this.buttons();
        }
      }
      this.previous = now;
      try {
        this.draw();
      } catch (error) {
        this.playing = false;
        this.buttons();
        this.status(
          `Scene rendering failed: ${error instanceof Error ? error.message : String(error)}. Close and reopen the briefing.`,
        );
      }
      this.dirty = false;
    }
    this.frame = requestAnimationFrame(this.tick);
  };
  draw() {
    if (this.disposed) return;
    const line = mediaAt(this.lines, this.time),
      index = this.lines.indexOf(line);
    this.people[0].pose(this.time, line.speaker === 'driver', 0.22);
    this.people[1].pose(this.time, line.speaker === 'host', -0.22);
    const drift = this.reducedMotion ? 0 : Math.sin(this.time * 0.11) * 0.06;
    if (line.shot === 'driver') {
      this.camera.position.set(-0.03 + drift, 1.68, 1.75);
      this.camera.lookAt(-0.6, 1.56, 0);
      this.camera.fov = 32;
    } else if (line.shot === 'host') {
      this.camera.position.set(-0.05 + drift, 1.68, 1.78);
      this.camera.lookAt(0.6, 1.56, 0);
      this.camera.fov = 32;
    } else {
      this.camera.position.set(drift, 1.64, 3.55);
      this.camera.lookAt(0, 1.15, 0);
      this.camera.fov = 39;
    }
    this.camera.updateProjectionMatrix();
    this.renderer.render(this.scene, this.camera);
    if (index !== this.currentLine) {
      this.root.querySelector('[data-speaker]')!.textContent =
        line.speaker === 'host' ? 'PRESENTER' : 'TEAM DRIVER';
      this.root.querySelector('[data-line]')!.textContent = line.text;
      this.currentLine = index;
    }
    (this.root.querySelector('[data-media="seek"]') as HTMLInputElement).value = String(this.time);
    this.root.querySelector('[data-time]')!.textContent =
      `0:${Math.floor(this.time).toString().padStart(2, '0')} / 0:47`;
  }
  private capture() {
    this.draw();
    this.canvas.toBlob((blob) => {
      if (this.disposed) return;
      if (!blob) {
        this.status('Scene capture failed.');
        return;
      }
      downloadBlob(blob, 'apex-original-team-briefing.png');
      this.status(
        'Captured the original 3D scene only. Captions are available in the transcript; this is not race footage.',
      );
    }, 'image/png');
  }
  diagnostics() {
    return {
      time: this.time,
      playing: this.playing,
      disposed: this.disposed,
      drawCalls: this.renderer.info.render.calls,
      triangles: this.renderer.info.render.triangles,
      glError: this.renderer.getContext().getError(),
      scope: 'original-scripted-media-not-race-footage',
      spokenAudio: false,
    };
  }
  dispose() {
    if (this.disposed) return;
    this.disposed = true;
    this.playing = false;
    cancelAnimationFrame(this.frame);
    this.observer?.disconnect();
    this.events.abort();
    const geometry = new Set<T.BufferGeometry>(),
      material = new Set<T.Material>(),
      texture = new Set<T.Texture>();
    this.scene.traverse((o) => {
      if (o instanceof T.Mesh) {
        geometry.add(o.geometry);
        for (const m of Array.isArray(o.material) ? o.material : [o.material]) {
          material.add(m);
          for (const v of Object.values(m)) if (v instanceof T.Texture) texture.add(v);
        }
      }
      if (o instanceof T.Light && 'shadow' in o) (o as T.DirectionalLight).shadow?.dispose();
    });
    geometry.forEach((g) => g.dispose());
    material.forEach((m) => m.dispose());
    texture.forEach((t) => t.dispose());
    this.environment?.dispose();
    this.renderer?.dispose();
    this.renderer?.forceContextLoss();
    this.root.remove();
  }
}
