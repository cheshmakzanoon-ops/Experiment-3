/** A completed actual world draw, never a synthetic simulation tick. */
export interface HeldPresentationReceipt {
  sampleTick: number;
  presentedTick: number;
  submittedAt: number;
  completedAt: number;
  viewportRevision: number;
  completed: true;
}
interface PresentationWait {
  active(): void;
  ready(): boolean;
  deadline: number;
  now?: () => number;
  yieldTask?: () => Promise<void>;
}
/** Initial candidate construction can resize the shared drawing buffer too. */
export async function withDrainedFestivalPresentation<T>(
  options: PresentationWait,
  construct: () => T,
): Promise<T> {
  const now = options.now ?? (() => performance.now());
  const yieldTask =
    options.yieldTask ?? (() => new Promise<void>((resolve) => setTimeout(resolve, 16)));
  const check = () => {
    options.active();
    if (now() >= options.deadline) throw new Error('Festival world preparation deadline exceeded');
  };
  check();
  while (!options.ready()) {
    await yieldTask();
    check();
  }
  check();
  return construct();
}
/** Existing shared context gate owns both previous work and each candidate draw.
 * A resize invalidates completion, but cannot mutate targets until work drains. */
export async function completeHeldPresentation(options: {
  active(): void;
  ready(): boolean;
  revision(): number;
  resize(): void;
  draw(): void;
  receipt(): { sampleTick: number; presentedTick: number };
  deadline: number;
  now?: () => number;
  yieldTask?: () => Promise<void>;
}): Promise<HeldPresentationReceipt> {
  const now = options.now ?? (() => performance.now());
  const yieldTask =
    options.yieldTask ?? (() => new Promise<void>((resolve) => setTimeout(resolve, 16)));
  const check = () => {
    options.active();
    if (now() >= options.deadline) throw new Error('Festival world preparation deadline exceeded');
  };
  const settle = async () => {
    check();
    while (!options.ready()) {
      await yieldTask();
      check();
    }
    check();
  };
  await settle();
  for (;;) {
    check();
    const viewportRevision = options.revision();
    options.resize();
    options.draw();
    check();
    const submittedAt = now();
    const receipt = options.receipt();
    if (
      !Number.isInteger(receipt.sampleTick) ||
      receipt.sampleTick < 0 ||
      receipt.sampleTick !== receipt.presentedTick
    )
      throw new Error('Festival held presentation does not match the authoritative snapshot');
    await settle();
    if (options.revision() !== viewportRevision) continue;
    return { ...receipt, submittedAt, completedAt: now(), viewportRevision, completed: true };
  }
}
