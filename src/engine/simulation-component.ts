import { Simulation } from '../simulation/world.ts';
import { controls, type Controls, type SessionOptions } from '../simulation/config.ts';

/** Engine-independent host for the existing simulation. Babylon owns rendering;
 * this component alone advances the repository's vehicle/race physics. */
export class SimulationComponent {
  static readonly stepSeconds = 1 / 120;
  readonly simulation: Simulation;
  readonly frame: Float32Array;
  private accumulator = 0;
  private paused = false;
  droppedSeconds = 0;
  constructor(options: SessionOptions) {
    this.simulation = new Simulation(options);
    this.frame = this.simulation.makeFrame();
  }
  setInput(input: Controls) {
    this.simulation.setInput(input);
  }
  setPaused(paused: boolean) {
    this.paused = paused;
    this.accumulator = 0;
    if (paused) this.setInput(controls());
  }
  advance(seconds: number) {
    if (!Number.isFinite(seconds) || seconds < 0) throw new Error('Invalid frame duration');
    if (this.paused) return 0;
    // Never turn a background-tab interval into a giant simulation step.
    const accepted = Math.min(seconds, 0.1);
    this.droppedSeconds += seconds - accepted;
    this.accumulator += accepted;
    let steps = 0;
    while (this.accumulator + 1e-12 >= SimulationComponent.stepSeconds && steps < 12) {
      this.simulation.step(SimulationComponent.stepSeconds);
      this.accumulator = Math.max(0, this.accumulator - SimulationComponent.stepSeconds);
      steps++;
    }
    this.simulation.writeFrame(this.frame);
    return steps;
  }
}
