import { BrakingTripletPreparation } from './braking-triplet-preparation.ts';
import type { loadBabylonBrakingTriplet } from './braking-triplet.ts';
import { GridPreparation } from './grid-preparation.ts';
import type { createBabylonGridPaint } from './grid-paint.ts';
import { GantryPreparation } from './gantry-preparation.ts';
import { LampPreparation } from './lamp-preparation.ts';
import { BannerPreparation } from './banner-preparation.ts';
import type { BabylonStartGantryOptions, loadBabylonStartGantry } from './start-gantry.ts';
import type { createBabylonStartLamps } from './start-lamps.ts';
import type { createBabylonStartBanner } from './start-banner.ts';
import { cleanupPresentation } from './presentation-gpu.ts';

interface EnvironmentDependencies {
  gantry?: typeof loadBabylonStartGantry;
  lamps?: typeof createBabylonStartLamps;
  banner?: typeof createBabylonStartBanner;
  grid?: typeof createBabylonGridPaint;
  brakingTriplet?: typeof loadBabylonBrakingTriplet;
}

/** The original gantry, lamps, banner, dry Formula grid and first clean A09 triplet. Surface readiness precedes this
 * owner. Compilation stays sequential; all installations subscribe before the
 * shared scene can draw. Each owner still requires its own two real receipts. */
export class EnvironmentPreparation {
  gantry: GantryPreparation | undefined;
  lamps: LampPreparation | undefined;
  banner: BannerPreparation | undefined;
  grid: GridPreparation | undefined;
  brakingTriplet: BrakingTripletPreparation | undefined;
  readonly completion: Promise<void>;
  private readonly abort = new AbortController();
  private disposed = false;
  private preparing = true;
  private drawable = false;
  private ready = false;
  private readonly options: BabylonStartGantryOptions;

  constructor(
    options: BabylonStartGantryOptions,
    private readonly frame: () => Float32Array,
    dependencies: EnvironmentDependencies = {},
  ) {
    this.options = { ...options, signal: AbortSignal.any([options.signal, this.abort.signal]) };
    this.completion = this.run(dependencies);
  }
  private current() {
    return (
      !this.disposed &&
      !this.options.signal.aborted &&
      !this.options.scene.isDisposed &&
      this.options.isCurrent()
    );
  }
  private active() {
    this.options.signal.throwIfAborted();
    if (!this.current()) throw new DOMException('Environment ownership changed', 'AbortError');
    if (performance.now() >= this.options.deadline)
      throw new Error('Environment preparation deadline exceeded');
  }
  get canDraw() {
    return (
      this.current() &&
      this.drawable &&
      !!this.gantry?.canDraw &&
      !!this.lamps?.canDraw &&
      !!this.banner?.canDraw &&
      !!this.grid?.canDraw &&
      !!this.brakingTriplet?.canDraw
    );
  }
  get completed() {
    return (
      this.current() &&
      this.ready &&
      !!this.gantry?.completed &&
      !!this.lamps?.completed &&
      !!this.banner?.completed &&
      !!this.grid?.completed &&
      !!this.brakingTriplet?.completed
    );
  }
  private cleanup() {
    const failures = cleanupPresentation([
      () => this.brakingTriplet?.dispose(),
      () => this.grid?.dispose(),
      () => this.banner?.dispose(),
      () => this.lamps?.dispose(),
      () => this.gantry?.dispose(),
    ]);
    if (failures.length) throw new AggregateError(failures, 'Environment cleanup failed');
  }
  dispose() {
    this.disposed = true;
    this.drawable = this.ready = false;
    this.abort.abort();
    // Do not destroy even staged siblings while a compiler owns this context.
    // The sequential run drains the current factory before performing cleanup.
    if (!this.preparing) this.cleanup();
  }
  private async run(dependencies: EnvironmentDependencies) {
    const installations: Promise<void>[] = [];
    try {
      this.active();
      this.gantry = new GantryPreparation(this.options, dependencies.gantry, { staged: true });
      await this.gantry.prepared;
      this.active();
      this.lamps = new LampPreparation(this.options, this.frame, dependencies.lamps, {
        staged: true,
      });
      await this.lamps.prepared;
      this.active();
      this.banner = new BannerPreparation(this.options, dependencies.banner, { staged: true });
      await this.banner.prepared;
      this.active();
      this.grid = new GridPreparation(this.options, dependencies.grid, { staged: true });
      await this.grid.prepared;
      this.active();
      this.brakingTriplet = new BrakingTripletPreparation(
        this.options,
        dependencies.brakingTriplet,
        { staged: true },
      );
      await this.brakingTriplet.prepared;
      this.active();
      this.preparing = false;
      // Deliberately no await between installs: all scene additions and each
      // independent future-frame subscription precede any normal submission.
      for (const owner of [this.gantry, this.lamps, this.banner, this.grid, this.brakingTriplet])
        installations.push(owner.install());
      this.active();
      this.drawable = true;
      await Promise.all(installations);
      this.active();
      // Existing per-owner completion performs the original receipt validation.
      this.ready = true;
    } catch (error) {
      this.preparing = false;
      try {
        this.dispose();
      } catch (cleanupError) {
        try {
          console.error('Environment cleanup failed', cleanupError);
        } catch {
          /* Reporting must not replace the primary failure or skip draining. */
        }
      }
      // Disposing installed owners cancels their real presentation subscriptions.
      await Promise.allSettled(installations);
      throw error;
    }
  }
}
