import type { BabylonPresentationGpu } from './presentation-gpu.ts';
import { startupVisualSubmissionSequence } from './paused-startup-publication.ts';

type Graphics = ReturnType<BabylonPresentationGpu['diagnostics']>;
export interface SubmissionCapture {
  /** CPU capture after render, before fence insertion; not an exact submission clock. */
  rendererNowMs: number;
  timeOriginMs: number;
  componentEpoch: number;
  sceneEpoch: number;
  paused: boolean;
  tick: number;
  throttle: number;
  speed: number;
  readyBefore: boolean;
  readyAfter: boolean;
  preparationStage: 'surface' | 'environment' | 'stripe' | 'model' | 'none';
  requested: boolean;
  preparationCount: number;
  wheelPhase: number | null;
}
/** CPU facts about submitted commands, NOT completion/readiness evidence. */
export class SubmissionObservation {
  enabled = false;
  private records: (SubmissionCapture & { sequence: number; lossesAtSubmission: number })[] = [];
  record(capture: SubmissionCapture | null, previousSubmitted: number, graphics: Graphics) {
    if (!this.enabled || !capture) return;
    const sequence = startupVisualSubmissionSequence(graphics, true, previousSubmitted);
    if (sequence === null || sequence <= (this.records.at(-1)?.sequence ?? 0)) return;
    if (Object.values(capture).some((v) => typeof v === 'number' && !Number.isFinite(v))) return;
    this.records.push({ ...capture, sequence, lossesAtSubmission: graphics.losses });
    if (this.records.length > 8) this.records.shift();
  }
  snapshot(componentEpoch: number, sceneEpoch: number, losses: number) {
    return {
      version: 1 as const,
      enabled: this.enabled,
      currentComponentEpoch: componentEpoch,
      currentSceneEpoch: sceneEpoch,
      losses,
      records: this.records.map((record) => ({
        ...record,
        provenance:
          losses > record.lossesAtSubmission
            ? ('pre-loss' as const)
            : record.componentEpoch !== componentEpoch || record.sceneEpoch !== sceneEpoch
              ? ('previous-generation' as const)
              : ('current' as const),
      })),
    };
  }
}
