import { describe, it } from 'vitest';
import * as checks from '../scripts/phase27c-oracles.ts';

describe('Phase 27C geometry, integration and temporal invariants', () => {
  it('closes and smooths all eight original glove fingers', () => { checks.verifyGloveGeometry(); });
  it('preserves seat anchors and fixed arm lengths at every load and steering extreme', () => { checks.verifyDriverEnvelope(); });
  it('bounds crowd LOD, storage, phases and pause/seek state', () => { checks.verifyCrowdContract(); });
  it('keeps the six service sites and lighting grounded and clear of protected corridors', () => { checks.verifyServiceAndLights(); });
  it('frames the complete car around a whole lap at four aspect ratios', () => { checks.verifyBroadcastFraming(); });
  it('keeps camera bodies out of their own views without a transmissive full-scene pass', () => { checks.verifyCameraOptics(); });
  it('keeps wheel hardware rigid and the sidepod inlet skin unchanged', () => { checks.verifyMechanicalOwnership(); });
});
