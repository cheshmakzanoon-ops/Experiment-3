import type { AnimationGroup } from '@babylonjs/core/Animations/animationGroup.js';
import { F, carBase } from '../../simulation/protocol.ts';
import { steeringSample } from '../../rendering/supplied-steering.ts';
import manifest from '../../rendering/supplied-player.manifest.json' with { type: 'json' };

/** Sample the original driver rig from the existing physics, never a render
 * clock. The asset container owns groups; this adapter only controls playback. */
export class ExistingPlayerSteering {
  private readonly steering: AnimationGroup;
  private disposed = false;
  constructor(groups: readonly AnimationGroup[]) {
    const matches = groups.filter((group) => group.name === manifest.steeringClip);
    if (matches.length !== 1) throw new Error('Expected one authored driver steering clip');
    const group = matches[0];
    if (!Number.isFinite(group.from) || !Number.isFinite(group.to) || group.to <= group.from)
      throw new Error('Invalid authored driver animation range');
    this.steering = group;
    for (const animation of groups) animation.stop();
    group.start(false, 1, group.from, group.to);
    group.pause();
    group.goToFrame(group.from + steeringSample(0, group.to - group.from));
  }
  apply(frame: Float32Array) {
    if (this.disposed) throw new Error('Driver steering adapter is disposed');
    const group = this.steering;
    group.goToFrame(
      group.from + steeringSample(frame[carBase(0) + F.STEER], group.to - group.from),
    );
    return (group.getCurrentFrame() - group.from) / (group.to - group.from);
  }
  dispose() {
    if (this.disposed) return;
    this.disposed = true;
    this.steering.stop();
  }
}
