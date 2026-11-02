import gantryManifest from '../src/rendering/start-gantry.manifest.json' with { type: 'json' };
/** Harness-only scopes. Required callers remain full; diagnostics cannot claim
 * that an intentionally omitted authored-model workload passed. */
export function desktopSmokeJourney(value = 'full') {
  if (value !== 'full' && value !== 'compatibility-diagnostic')
    throw new Error(`Unknown desktop smoke journey: ${value}`);
  return {
    requestedJourney: value,
    diagnosticOnly: value === 'compatibility-diagnostic',
    omittedChecks:
      value === 'compatibility-diagnostic'
        ? [
            'Babylon original Formula model import and presentation',
            'Babylon authored wheel motion and pause stability',
            'Babylon imported-model panel layout',
          ]
        : [],
  };
}

export async function runDesktopSmokeJourneys(journey, checks) {
  if (!journey.diagnosticOnly) await checks.authoredModel();
  await checks.captureBabylon();
  // This callback retains the shipped native Game menu and every existing
  // compatibility UI/input assertion. It never navigates directly to a URL.
  await checks.compatibility();
}

/** Race only harness observations, never actual GPU work. No timers, browser
 * hooks or polling changes: the original operation owns its original budget.
 * Per-wait listeners are removed on either outcome; late rejections are handled. */
export function createFirstGraphicsFault() {
  let first;
  const listeners = new Set();
  return {
    record(message) {
      if (first) return;
      first = new Error(`GPU health failed: ${String(message).slice(0, 2048)}`);
      for (const reject of listeners) reject(first);
      listeners.clear();
    },
    read: () => first,
    wait(operation) {
      if (first) return Promise.reject(first);
      return new Promise((resolve, reject) => {
        let settled = false;
        const finish = (ok, value) => {
          if (settled) return;
          settled = true;
          listeners.delete(onFault);
          if (ok) resolve(value);
          else reject(value);
        };
        const onFault = (error) => finish(false, error);
        listeners.add(onFault);
        try {
          Promise.resolve(operation()).then(
            (value) => (first ? finish(false, first) : finish(true, value)),
            (error) => finish(false, first ?? error),
          );
        } catch (error) {
          finish(false, first ?? error);
        }
      });
    },
  };
}

/** A secondary timeout/snapshot error must not erase an observed GPU crash or
 * an earlier failure. Full evidence collection still runs after this call. */
export function retainNativeSmokeFailure(report, error, graphicsFailure) {
  if (report.success === false && report.failure) return;
  report.success = false;
  report.failure = String(graphicsFailure.read() ?? error);
}

/** Required native default route is canonical Aurel, not a generic fallback
 * check. Consume only the existing readiness receipt's raw DOM dataset values;
 * no browser/renderer dependency, new query, wait, or presentation operation. */
export function validateNativeAurelSurface(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value))
    throw new Error('Native Aurel surface readiness receipt is missing or malformed');
  const expected = {
    kind: 'formula-ribbon',
    roadChunks: '38',
    paintChunks: '76',
    leftPaintChunks: '38',
    rightPaintChunks: '38',
    vertices: '31882',
    paintFinishMaterials: '1',
    asphaltSubstrateRoadChunks: '38',
    asphaltSubstrateMaterials: '1',
    asphaltSubstrateTextures: '3',
    asphaltSubstrateSrgbTextures: '1',
    formulaGroundingRoadChunks: '38',
    formulaGroundingPaintChunks: '76',
    formulaGroundingMaterials: '2',
    formulaGroundingCars: '1',
    bannerState: 'ready',
    bannerParts: '1',
    bannerMaterials: '1',
    bannerTextures: '1',
    bannerTriangles: '2',
    bannerWidth: '512',
    bannerHeight: '128',
    bannerHardwareSrgb: '1',
    brakingTripletState: 'ready',
    brakingTripletParts: '6',
    brakingTripletTriangles: '4950',
    brakingTripletScope: 'dry-formula-first-clean-triplet-fixed-lod0',
    gridState: 'ready',
    gridParts: '2',
    gridMaterials: '1',
    gridTextures: '0',
    gridSlots: '12',
    gridBoxes: '36',
    gridTriangles: '432',
    gridDryOnly: 'true',
    gridGpSwitchingParity: 'false',
    gridWeatherParity: 'false',
    gridShadowParity: 'false',
    stripeState: 'ready',
    stripeParts: '1',
    stripeMaterials: '1',
    stripeTextures: '1',
    stripeTriangles: '2',
    stripeWidth: '128',
    stripeHeight: '32',
    stripeHardwareSrgb: '1',
    lampState: 'ready',
    lampParts: '5',
    lampMaterials: '5',
    lampTriangles: '400',
    lampLights: '0',
    gantryState: 'ready',
    gantryParts: '4',
    gantryMaterials: '1',
    gantryTextures: '3',
    gantryTriangles: '9520',
    gantrySha256: gantryManifest.sha256,
    coarseMeshes: '0',
  };
  for (const [key, required] of Object.entries(expected)) {
    if (!Object.hasOwn(value, key) || value[key] !== required)
      throw new Error(`Native Aurel surface readiness mismatch: ${key}`);
  }
  return {
    kind: value.kind,
    roadChunks: Number(value.roadChunks),
    paintChunks: Number(value.paintChunks),
    leftPaintChunks: Number(value.leftPaintChunks),
    rightPaintChunks: Number(value.rightPaintChunks),
    vertices: Number(value.vertices),
    paintFinishMaterials: Number(value.paintFinishMaterials),
    asphaltSubstrateRoadChunks: Number(value.asphaltSubstrateRoadChunks),
    asphaltSubstrateMaterials: Number(value.asphaltSubstrateMaterials),
    asphaltSubstrateTextures: Number(value.asphaltSubstrateTextures),
    asphaltSubstrateSrgbTextures: Number(value.asphaltSubstrateSrgbTextures),
    formulaGroundingRoadChunks: Number(value.formulaGroundingRoadChunks),
    formulaGroundingPaintChunks: Number(value.formulaGroundingPaintChunks),
    formulaGroundingMaterials: Number(value.formulaGroundingMaterials),
    formulaGroundingCars: Number(value.formulaGroundingCars),
    bannerState: value.bannerState,
    bannerParts: Number(value.bannerParts),
    bannerMaterials: Number(value.bannerMaterials),
    bannerTextures: Number(value.bannerTextures),
    bannerTriangles: Number(value.bannerTriangles),
    bannerWidth: Number(value.bannerWidth),
    bannerHeight: Number(value.bannerHeight),
    bannerHardwareSrgb: Number(value.bannerHardwareSrgb),
    brakingTripletState: value.brakingTripletState,
    brakingTripletParts: Number(value.brakingTripletParts),
    brakingTripletTriangles: Number(value.brakingTripletTriangles),
    brakingTripletScope: value.brakingTripletScope,
    gridState: value.gridState,
    gridParts: Number(value.gridParts),
    gridMaterials: Number(value.gridMaterials),
    gridTextures: Number(value.gridTextures),
    gridSlots: Number(value.gridSlots),
    gridBoxes: Number(value.gridBoxes),
    gridTriangles: Number(value.gridTriangles),
    gridDryOnly: value.gridDryOnly === 'true',
    gridGpSwitchingParity: value.gridGpSwitchingParity === 'true',
    gridWeatherParity: value.gridWeatherParity === 'true',
    gridShadowParity: value.gridShadowParity === 'true',
    stripeState: value.stripeState,
    stripeParts: Number(value.stripeParts),
    stripeMaterials: Number(value.stripeMaterials),
    stripeTextures: Number(value.stripeTextures),
    stripeTriangles: Number(value.stripeTriangles),
    stripeWidth: Number(value.stripeWidth),
    stripeHeight: Number(value.stripeHeight),
    stripeHardwareSrgb: Number(value.stripeHardwareSrgb),
    lampState: value.lampState,
    lampParts: Number(value.lampParts),
    lampMaterials: Number(value.lampMaterials),
    lampTriangles: Number(value.lampTriangles),
    lampLights: Number(value.lampLights),
    gantryState: value.gantryState,
    gantryParts: Number(value.gantryParts),
    gantryMaterials: Number(value.gantryMaterials),
    gantryTextures: Number(value.gantryTextures),
    gantryTriangles: Number(value.gantryTriangles),
    gantrySha256: value.gantrySha256,
    coarseMeshes: Number(value.coarseMeshes),
  };
}
