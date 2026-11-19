import * as T from 'three';
import { clamp } from '../../core/math.ts';
import {
  TrackTerrainSurface,
  type TerrainRenderDelta,
} from '../../simulation/offroad/course-terrain.ts';
import { H } from '../../simulation/protocol.ts';
import { Track } from '../../simulation/track.ts';
import type { BuildQueue } from '../build-queue.ts';
import type { QualityPreset } from '../options.ts';
import { installLightPools } from '../studio/light-pools.ts';
import { Roost } from './roost.ts';
import { Stadium } from './stadium.ts';
import { StartGate } from './start-gate.ts';
import { TerrainView } from './terrain-view.ts';
import { MxCourseDressing } from './mx-course-dressing.ts';
import { MxCourseLandmarks } from './mx-course-landmarks.ts';
import { installMxArenaLighting } from './mx-arena-lighting.ts';
import { MxLooseSoil } from './mx-loose-soil.ts';
import { MxMeadow } from './mx-meadow.ts';
import { MxSpectators } from './mx-spectators.ts';

export { installMud, installMudOn, mudUniforms, type MudUniforms } from './mud.ts';
export { DirtBikeModel } from './dirt-bike-model.ts';
/**
 * Off-road venue presentation (WP41), owned by the CircuitScene of a terrain
 * venue: the deformable course terrain, the start gate (motocross and
 * supercross), the supercross stadium bowl, and roost from spinning wheels.
 * Fed by the snapshot (`update`) and by the worker's terrain keyframes
 * (`record`, `showAt` in replays); never written back to the simulation.
 */
export class OffroadScene {
  readonly group = new T.Group();
  terrain: TerrainView | null = null;
  gate: StartGate | null = null;
  stadium: Stadium | null = null;
  dressing: MxCourseDressing | null = null;
  landmarks: MxCourseLandmarks | null = null;
  looseSoil: MxLooseSoil | null = null;
  spectators: MxSpectators | null = null;
  meadow: MxMeadow | null = null;
  readonly roost: Roost;
  private lastTime = NaN;
  private disposed = false;
  private readonly pending: {
    delta: TerrainRenderDelta | undefined;
    time: number;
    live: boolean;
  }[] = [];
  constructor(
    readonly track: Track,
    construction: BuildQueue,
  ) {
    const surface = Track.offroadOf(track);
    if (!(surface instanceof TrackTerrainSurface)) throw new Error('Not a terrain venue');
    const course = surface.course;
    this.roost = new Roost(track);
    this.group.name = 'Off-road venue';
    this.group.add(this.roost.points);
    if (this.roost.clods) this.group.add(this.roost.clods);
    if (this.roost.contactShadows) this.group.add(this.roost.contactShadows);
    try {
      this.queue(construction, 'Off-road course terrain', 3, () => {
        this.terrain = new TerrainView(track);
        this.roost.groundHeight = (s, lateral) => this.terrain!.heightAt(s, lateral);
        // Night venues light the soil with the floodlight pools, like a ribbon.
        installLightPools(this.terrain.material);
        if (this.stadium) installMxArenaLighting(this.terrain.material, this.stadium.lampGrid);
        this.group.add(this.terrain.group);
        for (const p of this.pending.splice(0)) this.terrain.record(p.delta, p.time, p.live);
      });
      if (course.spec.gate)
        this.queue(construction, 'Off-road start gate', 1, () => {
          this.gate = new StartGate(track, course);
          this.group.add(this.gate.root);
        });
      if (course.kind === 'supercross')
        this.queue(construction, 'Supercross stadium', 2, () => {
          this.stadium = new Stadium(track);
          if (this.terrain) installMxArenaLighting(this.terrain.material, this.stadium.lampGrid);
          this.group.add(this.stadium.root);
        });
      if (course.kind === 'motocross' || course.kind === 'supercross') {
        this.queue(construction, 'MX course furniture and shoulders', 3, () => {
          this.dressing = new MxCourseDressing(track);
          this.group.add(this.dressing.root, this.dressing.turf);
        });
        this.queue(construction, 'MX loose soil', 1, () => {
          this.looseSoil = new MxLooseSoil(track);
          this.group.add(this.looseSoil.root);
        });
        if (course.kind === 'motocross')
          // After the furniture: onlookers keep clear of its service bays and posts.
          this.queue(construction, 'MX spectators and marshals', 4, () => {
            this.spectators = new MxSpectators(track, this.dressing?.trackside.plan.sites ?? []);
            this.group.add(this.spectators.root);
          });
        if (course.kind === 'motocross') {
          this.meadow = new MxMeadow(track, () => this.dressing?.trackside.plan.sites ?? []);
          this.group.add(this.meadow.root);
          this.meadow.queueInitial(construction);
        }
        this.queue(construction, 'MX course identities and jump profiles', 2, () => {
          this.landmarks = new MxCourseLandmarks(track);
          this.group.add(this.landmarks.root);
        });
      }
    } catch (error) {
      this.dispose();
      throw error;
    }
  }
  /** A running queue may resume after its renderer closes. Every owned task
   * checks the owner's lifetime, independently of the queue's caller signal. */
  private queue(construction: BuildQueue, label: string, priority: number, work: () => void) {
    construction.add(label, priority, () => {
      if (this.disposed) return;
      try {
        work();
      } catch (error) {
        this.dispose();
        throw error;
      }
    });
  }
  /** Prepare optional scenery inside the renderer's existing paused graphics
   * transaction. Its owner releases or restores assets after compilation. */
  async prepareQuality(
    quality: QualityPreset,
    cancelled: () => boolean,
    yieldControl: () => Promise<void>,
  ) {
    if (this.disposed) return false;
    return this.meadow
      ? this.meadow.prepareQuality(quality, () => this.disposed || cancelled(), yieldControl)
      : null;
  }
  /** A worker surface keyframe's terrain export. */
  record(delta: TerrainRenderDelta | undefined, time: number, live: boolean) {
    if (this.disposed || !delta) return;
    if (this.terrain) this.terrain.record(delta, time, live);
    else this.pending.push({ delta, time, live });
  }
  /** Replay: show the terrain as it was at `time`; null returns to live. */
  showAt(time: number | null) {
    if (this.disposed) return;
    if (time === null) this.terrain?.showLive();
    else this.terrain?.showAt(time);
  }
  update(frame: Float32Array) {
    if (this.disposed) return;
    this.gate?.update(frame);
    this.stadium?.update(frame[H.TIME]);
    const time = frame[H.TIME],
      dt = Number.isFinite(this.lastTime) ? clamp(time - this.lastTime, 0, 0.1) : 0;
    this.dressing?.update(time);
    this.spectators?.update(time);
    this.meadow?.update(time);
    if (this.terrain) this.looseSoil?.setWetness(this.terrain.soilWetness);
    // Even a sub-frame reverse seek can cross a takeoff/contact edge.
    // Drop particles and edge history before reading that earlier snapshot.
    if (time < this.lastTime) this.roost.clear();
    this.lastTime = time;
    this.roost.update(frame, dt);
  }
  dispose() {
    if (this.disposed) return;
    this.disposed = true;
    // Detach before any nested disposal, so the renderer's generic traversal
    // cannot dispose the same instance buffers, templates or texture handles.
    this.group.removeFromParent();
    this.group.visible = false;
    this.pending.length = 0;
    this.roost.groundHeight = null;
    this.terrain?.dispose();
    this.gate?.dispose();
    this.stadium?.dispose();
    this.dressing?.dispose();
    this.landmarks?.dispose();
    this.looseSoil?.dispose();
    this.spectators?.dispose();
    this.meadow?.dispose();
    this.roost.dispose();
    this.group.clear();
  }
}
/** The off-road presentation for a terrain venue, else null. */
export function offroadSceneFor(track: Track, construction: BuildQueue) {
  return Track.offroadOf(track) instanceof TrackTerrainSurface
    ? new OffroadScene(track, construction)
    : null;
}
