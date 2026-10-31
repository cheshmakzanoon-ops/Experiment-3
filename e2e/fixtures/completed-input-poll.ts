/** Fixture-only evidence. Reads made by the HUD or test do not acknowledge an
 * input sample; only a successfully completed controller poll publishes it. */
export class CompletedInputPoll {
  private active = false;
  private observed: { id: string; index: number; pressed: number[] }[] = [];
  private completed = { sequence: 0, pads: this.observed };

  observe<T extends (Pick<Gamepad, 'id' | 'index' | 'buttons'> | null)[]>(pads: T) {
    if (this.active) {
      this.observed = pads.slice(0, 4).flatMap((pad) =>
        pad
          ? [
              {
                id: pad.id.slice(0, 160),
                index: pad.index,
                pressed: pad.buttons
                  .slice(0, 128)
                  .flatMap((button, index) =>
                    button.pressed || button.value !== 0 ? [index] : [],
                  ),
              },
            ]
          : [],
      );
    }
    return pads;
  }

  sample(poll: () => void) {
    if (this.active) throw new Error('Nested fixture input poll');
    this.active = true;
    this.observed = [];
    try {
      poll();
      this.completed = { sequence: this.completed.sequence + 1, pads: this.observed };
    } finally {
      this.active = false;
    }
  }

  get receipt() {
    return structuredClone(this.completed);
  }
}
