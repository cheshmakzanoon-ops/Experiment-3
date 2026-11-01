import {
  PausedStartupPublication,
  startupVisualSubmissionSequence,
  type StartupPublicationRejection,
} from './paused-startup-publication.ts';
import { captureStartupVisualState, inspectStartupVisualState } from './startup-visual-state.ts';
import {
  SurfacePreparation,
  resizePresentationWhenIdle,
  pollPresentationForRender,
} from './surface-preparation.ts';
import { EnvironmentPreparation } from './environment-preparation.ts';
import { StripePreparation } from './stripe-preparation.ts';
import type { LampPreparation } from './lamp-preparation.ts';
import { GraphicsRecovery } from './graphics-recovery.ts';
import type { AssetContainer } from '@babylonjs/core/assetContainer.js';
import { prepareOriginalMaterials } from './asset-preparation.ts';
import { RestartOwnership } from './restart-ownership.ts';
import { BabylonPresentationGpu, cleanupPresentation } from './presentation-gpu.ts';
import { TransformNode } from '@babylonjs/core/Meshes/transformNode.js';
import { Engine } from '@babylonjs/core/Engines/engine.js';
import { BabylonCircuitScene } from './circuit-scene.ts';
import { waitForPresentation } from './presentation-ready.ts';
import { ExistingPlayerSteering } from './existing-player-steering.ts';
import { ExistingPlayerWheels } from './existing-player-wheels.ts';
import { PresentationSchedule } from './presentation-schedule.ts';
import { observePreparationReadiness, observeReadinessSnapshot } from './readiness-observation.ts';
import { installGraphicsObservation } from '../../core/graphics-observation.ts';
import { SimulationComponent } from '../simulation-component.ts';
import { DEFAULT_OPTIONS } from '../../simulation/config.ts';
import { InputController, type TouchAction } from '../../input/controller.ts';
import { InputPump } from '../../input/pump.ts';
import { DEFAULT_SETTINGS, SaveStore, validateSettings } from '../../storage/data.ts';
import { F, carBase } from '../../simulation/protocol.ts';
import './preview.css';

installGraphicsObservation();
const canvas = document.querySelector<HTMLCanvasElement>('#game')!;
const status = document.querySelector<HTMLOutputElement>('#status')!;
const pause = document.querySelector<HTMLButtonElement>('#pause')!;
const restart = document.querySelector<HTMLButtonElement>('#restart')!;
const loadAsset = document.querySelector<HTMLButtonElement>('#loadAsset')!;
const assetStatus = document.querySelector<HTMLOutputElement>('#assetStatus')!;
let assetLoad = new AbortController();
let playerSteering: ExistingPlayerSteering | undefined;
let playerWheels: ExistingPlayerWheels | undefined;
const controlStatus = document.querySelector<HTMLOutputElement>('#controlStatus')!;
let input: InputController | undefined;
let inputPump: InputPump | undefined;
let settings = structuredClone(DEFAULT_SETTINGS);
const abort = new AbortController();
const eventOptions = { signal: abort.signal };
let engine: Engine | undefined;
let scene: BabylonCircuitScene | undefined;
let gpu: BabylonPresentationGpu | undefined;
let surfacePreparation: SurfacePreparation | undefined;
let environmentPreparation: EnvironmentPreparation | undefined;
let stripePreparation: StripePreparation | undefined;
let startupPublication: PausedStartupPublication | undefined;
let startupPublicationDecision: 'reused-completed-image' | 'requested-redraw' | null = null;
let startupPublicationRejection: StartupPublicationRejection | null = null;
let renderedStartupVisualState: {
  source: 'last-owned-paused-draw';
  rejectionCode:
    | ReturnType<typeof inspectStartupVisualState>['rejectionCode']
    | 'authored-player-active';
  state: string | null;
  sequence: number | null;
  tick: number;
} | null = null;
function clearSurfaceDiagnostics() {
  startupPublicationDecision = null;
  startupPublicationRejection = null;
  renderedStartupVisualState = null;
  startupPublication?.dispose();
  startupPublication = undefined;
  for (const key of [
    'stripeState',
    'stripeParts',
    'stripeMaterials',
    'stripeTextures',
    'stripeTriangles',
    'stripeWidth',
    'stripeHeight',
    'stripeHardwareSrgb',
    'bannerState',
    'bannerParts',
    'bannerMaterials',
    'bannerTextures',
    'bannerTriangles',
    'bannerWidth',
    'bannerHeight',
    'bannerHardwareSrgb',
    'lampState',
    'lampParts',
    'lampMaterials',
    'lampTriangles',
    'lampLights',
    'gantryState',
    'gantryParts',
    'gantryMaterials',
    'gantryTextures',
    'gantryTriangles',
    'gantrySha256',
    'surfaceKind',
    'surfaceRoadChunks',
    'surfacePaintChunks',
    'surfaceLeftPaintChunks',
    'surfaceRightPaintChunks',
    'surfaceCoarseMeshes',
    'surfaceVertices',
    'surfacePaintFinishMaterials',
    'surfaceAsphaltSubstrateRoadChunks',
    'surfaceAsphaltSubstrateMaterials',
    'surfaceAsphaltSubstrateTextures',
    'surfaceAsphaltSubstrateSrgbTextures',
    'surfaceFormulaGroundingRoadChunks',
    'surfaceFormulaGroundingPaintChunks',
    'surfaceFormulaGroundingMaterials',
    'surfaceFormulaGroundingCars',
  ])
    delete status.dataset[key];
  status.dataset.sceneReady = 'false';
}
function publishLampDiagnostics(lamps: LampPreparation) {
  for (const [key, value] of Object.entries(lamps.receipt()))
    status.dataset[`lamp${key[0].toUpperCase()}${key.slice(1)}`] = String(value);
}
declare global {
  interface Window {
    babylonGraphicsDiagnostics: typeof readGraphicsDiagnostics;
  }
}
function readGraphicsDiagnostics(includeStartupVisualState = false) {
  const graphics = gpu?.diagnostics();
  if (!graphics) return null;
  return {
    ...graphics,
    // Opt-in cached CPU evidence only; default native queries do no extra work.
    ...(includeStartupVisualState
      ? {
          startupPublicationDecision,
          startupPublicationRejection,
          startupVisualState: renderedStartupVisualState ? { ...renderedStartupVisualState } : null,
        }
      : {}),
    ...observeReadinessSnapshot(() => ({
      paused,
      stopped,
      restartPending: restartOwnership.pending,
      restartRequired: graphicsRecovery.restartRequired,
      resizePending,
      owners: {
        surface: observePreparationReadiness(surfacePreparation),
        gantry: observePreparationReadiness(environmentPreparation?.gantry),
        lamps: observePreparationReadiness(environmentPreparation?.lamps),
        banner: observePreparationReadiness(environmentPreparation?.banner),
        stripe: observePreparationReadiness(stripePreparation),
      },
      schedule: presentation.diagnostics(),
    })),
  };
}
Object.defineProperty(window, 'babylonGraphicsDiagnostics', {
  value: readGraphicsDiagnostics,
  writable: false,
  configurable: false,
});
let stopped = false;
let resizePending = false;

let component: SimulationComponent;
const presentation = new PresentationSchedule();
const graphicsRecovery = new GraphicsRecovery();
const restartOwnership = new RestartOwnership<SimulationComponent>(
  () => {
    assetLoad.abort();
    clearSurfaceDiagnostics();
    loadAsset.disabled = true;
    assetStatus.textContent = 'Restarting presentation…';
  },
  () => {
    component = new SimulationComponent({
      ...DEFAULT_OPTIONS,
      setup: settings.setup,
      mode: 'practice',
      opponents: 0,
    });
    // Clear the previous run's input now, never after later keydown events.
    setPaused(false);
    return component;
  },
);
let renderedFrames = 0;
let paused = false,
  last = performance.now(),
  lastStatus = 0;
function requestPresentation() {
  status.dataset.presentationSettled = 'false';
  presentation.request();
}
function setPaused(value: boolean) {
  if (!value && !graphicsRecovery.canResume) return;
  paused = value;
  requestPresentation();
  input?.setEnabled(!value);
  component.setPaused(value);
  last = performance.now();
  pause.textContent = value ? 'Resume' : 'Pause';
}
function stop(error?: unknown) {
  clearSurfaceDiagnostics();
  if (stopped) return;
  stopped = true;
  delete assetStatus.dataset.scalarHeightMaterials;
  status.dataset.presentationSettled = 'false';
  if (error !== undefined) {
    console.error(error);
    status.textContent = `Babylon could not start or continue: ${error instanceof Error ? error.message : String(error)}. The full game remains available through the link above.`;
  }
  // Stop scheduling first; a failed disposer must not skip other ownership.
  for (const failure of cleanupPresentation([
    () => engine?.stopRenderLoop(),
    () => assetLoad.abort(),
    () => abort.abort(),
    () => gpu?.dispose(),
    () => inputPump?.dispose(),
    () => input?.dispose(),
    () => playerSteering?.dispose(),
    () => playerWheels?.dispose(),
    () => scene?.dispose(),
    () => environmentPreparation?.dispose(),
    () => stripePreparation?.dispose(),
    () => engine?.dispose(),
  ]))
    console.error('Babylon cleanup failed:', failure);
}
function reset() {
  clearSurfaceDiagnostics();
  if (stopped) return;
  delete assetStatus.dataset.scalarHeightMaterials;
  try {
    graphicsRecovery.requestRestart();
    restartOwnership.request();
    requestPresentation();
  } catch (error) {
    stop(error);
  }
}
function rebuildScene(owner: SimulationComponent) {
  const deadline = performance.now() + 120000;
  clearSurfaceDiagnostics();
  delete assetStatus.dataset.scalarHeightMaterials;
  status.dataset.presentationSettled = 'false';
  presentation.reset();
  assetLoad.abort();
  playerSteering?.dispose();
  playerSteering = undefined;
  playerWheels?.dispose();
  playerWheels = undefined;
  delete assetStatus.dataset.wheelPhase;
  delete assetStatus.dataset.steering;
  const cleanupFailures = cleanupPresentation([
    () => scene?.dispose(),
    () => environmentPreparation?.dispose(),
    () => stripePreparation?.dispose(),
  ]);
  if (cleanupFailures.length)
    throw new AggregateError(cleanupFailures, 'Scene replacement cleanup failed');
  environmentPreparation = undefined;
  stripePreparation = undefined;
  const context = {
    presentation: 'circuit',
    vehicles: owner.simulation.cars.map((car) => car.definition),
  };
  scene = new BabylonCircuitScene(engine!, owner.simulation.track, 1, context);
  // Fresh model ownership is published only after an explicit safe rebuild.
  graphicsRecovery.rebuilt();
  assetLoad = new AbortController();
  loadAsset.disabled = true;
  assetStatus.textContent =
    'Preparing original circuit surfaces and dry asphalt substrate and vehicle grounding, then the original Aurel gantry, snapshot-driven lamps, printed banner and start/finish stripe; full environment parity remains unported.';
  const currentScene = scene,
    currentOwner = assetLoad;
  const publication = new PausedStartupPublication(gpu!, currentScene.scene, (renderedVisual) => ({
    component,
    paused,
    tick: component.simulation.tick,
    frame: component.frame,
    visual:
      renderedVisual === undefined
        ? paused
          ? captureStartupVisualState(currentScene)
          : null
        : renderedVisual,
  }));
  startupPublication = publication;
  surfacePreparation = new SurfacePreparation(
    currentScene.scene,
    currentScene.scene.meshes,
    gpu!,
    presentation,
    currentOwner.signal,
    deadline,
  );
  const pending = surfacePreparation;
  void pending.completion
    .then(async () => {
      if (
        stopped ||
        currentOwner.signal.aborted ||
        scene !== currentScene ||
        restartOwnership.pending ||
        !pending.completed
      )
        return;
      const diagnostics = currentScene.surfaceDiagnostics;
      if (
        diagnostics.kind === 'formula-ribbon' &&
        (diagnostics.coarseMeshes !== 0 ||
          diagnostics.roadChunks === 0 ||
          diagnostics.paintChunks !== diagnostics.roadChunks * 2 ||
          diagnostics.leftPaintChunks !== diagnostics.roadChunks ||
          diagnostics.rightPaintChunks !== diagnostics.roadChunks ||
          diagnostics.paintFinishMaterials !== 1 ||
          diagnostics.asphaltSubstrateRoadChunks !== diagnostics.roadChunks ||
          diagnostics.asphaltSubstrateMaterials !== 1 ||
          diagnostics.asphaltSubstrateTextures !== 3 ||
          diagnostics.asphaltSubstrateSrgbTextures !== 1 ||
          diagnostics.formulaGroundingRoadChunks !== diagnostics.roadChunks ||
          diagnostics.formulaGroundingPaintChunks !== diagnostics.paintChunks ||
          diagnostics.formulaGroundingMaterials !== 2 ||
          diagnostics.formulaGroundingCars !== 1)
      )
        throw new Error('Original Formula surface activation incomplete');
      status.dataset.surfaceKind = diagnostics.kind;
      for (const key of [
        'roadChunks',
        'paintChunks',
        'leftPaintChunks',
        'rightPaintChunks',
        'coarseMeshes',
        'vertices',
        'paintFinishMaterials',
        'asphaltSubstrateRoadChunks',
        'asphaltSubstrateMaterials',
        'asphaltSubstrateTextures',
        'asphaltSubstrateSrgbTextures',
        'formulaGroundingRoadChunks',
        'formulaGroundingPaintChunks',
        'formulaGroundingMaterials',
        'formulaGroundingCars',
      ] as const)
        status.dataset[`surface${key[0].toUpperCase()}${key.slice(1)}`] = String(diagnostics[key]);
      const environment = new EnvironmentPreparation(
        {
          scene: currentScene.scene,
          track: owner.simulation.track,
          context,
          base: document.baseURI,
          signal: currentOwner.signal,
          gpu: gpu!,
          deadline,
          schedule: presentation,
          isCurrent: () => !stopped && scene === currentScene && !restartOwnership.pending,
        },
        () => component.frame,
      );
      environmentPreparation = environment;
      await environment.completion;
      if (
        stopped ||
        currentOwner.signal.aborted ||
        scene !== currentScene ||
        restartOwnership.pending ||
        environmentPreparation !== environment ||
        !environment.completed
      )
        return;
      const gantry = environment.gantry!,
        lamps = environment.lamps!,
        banner = environment.banner!;
      for (const [key, value] of Object.entries(gantry.receipt()))
        status.dataset[`gantry${key[0].toUpperCase()}${key.slice(1)}`] = String(value);
      publishLampDiagnostics(lamps);
      for (const [key, value] of Object.entries(banner.receipt()))
        status.dataset[`banner${key[0].toUpperCase()}${key.slice(1)}`] = String(value);
      const stripe = new StripePreparation({
        scene: currentScene.scene,
        track: owner.simulation.track,
        context,
        signal: currentOwner.signal,
        gpu: gpu!,
        deadline,
        schedule: presentation,
        isCurrent: () => !stopped && scene === currentScene && !restartOwnership.pending,
      });
      stripePreparation = stripe;
      await stripe.completion;
      if (
        stopped ||
        currentOwner.signal.aborted ||
        scene !== currentScene ||
        restartOwnership.pending ||
        stripePreparation !== stripe ||
        !stripe.completed
      )
        return;
      for (const [key, value] of Object.entries(stripe.receipt()))
        status.dataset[`stripe${key[0].toUpperCase()}${key.slice(1)}`] = String(value);
      // Completion changes metadata only. Reuse a proven unchanged paused image,
      // never a pending fence or an old scene's receipt. All other cases redraw.
      const graphics = gpu!.diagnostics();
      const publishWithoutDraw = publication.canPublish(
        graphics,
        startupPublication === publication &&
          component === owner &&
          surfacePreparation === pending &&
          pending.completed &&
          environment.completed &&
          stripe.eligible &&
          !stopped &&
          !restartOwnership.pending &&
          !graphicsRecovery.restartRequired &&
          !resizePending &&
          !presentation.pending &&
          !playerSteering &&
          !playerWheels,
      );
      startupPublicationRejection = publication.rejectionReason;
      publication.dispose();
      if (startupPublication === publication) startupPublication = undefined;
      startupPublicationDecision = publishWithoutDraw
        ? 'reused-completed-image'
        : 'requested-redraw';
      if (publishWithoutDraw) status.dataset.sceneReady = 'true';
      else requestPresentation();
      loadAsset.disabled = false;
      assetStatus.textContent = `Original car is optional. Paint, dry asphalt and grounding are active${gantry.eligible ? '; Aurel gantry, snapshot-driven lamps, printed banner and start/finish stripe ready' : ''}. Practice lamps stay dark; bloom and full environment parity remain unported.`;
    })
    .catch((error) => {
      if (currentOwner.signal.aborted || stopped || scene !== currentScene) return;
      stop(error);
    });
}
window.addEventListener('pagehide', () => stop(), { once: true });
try {
  try {
    const saved = await new SaveStore().read('settings');
    if (saved) settings = validateSettings(saved);
  } catch (error) {
    controlStatus.textContent = `Using default controls: ${error instanceof Error ? error.message : String(error)}`;
  }
  abort.signal.throwIfAborted();
  input = new InputController(settings, (action) => {
    if (action === 'pause') setPaused(!paused);
    else if (action === 'blur' || action === 'deviceLost') setPaused(true);
    else if (action === 'autopilot')
      component.simulation.autoPlayer = !component.simulation.autoPlayer;
    else if (action === 'pit') component.simulation.requestPit();
    else if (action === 'drs') input!.state.drs = true;
    else if (action === 'overtake') input!.state.overtake = true;
    else if (action === 'ers') input!.state.ers = ((input!.state.ers + 1) % 3) as 0 | 1 | 2;
    else
      controlStatus.textContent = `${action} is available in the full game; its Babylon presentation is not ported yet.`;
  });
  for (const button of document.querySelectorAll<HTMLElement>('[data-drive]'))
    input.bindTouch(button, button.dataset.drive as TouchAction);
  engine = new Engine(canvas, true, { preserveDrawingBuffer: false, stencil: true });
  const context = canvas.getContext('webgl2');
  if (!context || !('fenceSync' in context))
    throw new Error('Babylon presentation requires WebGL2 fences');
  gpu = new BabylonPresentationGpu(context);
  engine.onContextLostObservable.add(() => {
    clearSurfaceDiagnostics();
    delete assetStatus.dataset.scalarHeightMaterials;
    gpu?.contextLost();
    graphicsRecovery.contextLost();
    assetLoad.abort();
    loadAsset.disabled = true;
    assetStatus.textContent =
      'Graphics context was lost. Restart is required to rebuild the scene before loading or displaying the original model.';
    if (!stopped) setPaused(true);
  });
  engine.onContextRestoredObservable.add(() => {
    gpu?.contextRestored();
    graphicsRecovery.contextRestored();
    if (graphicsRecovery.restartRequired) {
      loadAsset.disabled = true;
      assetStatus.textContent =
        'Graphics context restored. Restart is required before loading or displaying the original model.';
    }
    last = performance.now();
    requestPresentation();
  });
  restartOwnership.request();
  restartOwnership.drain(true, rebuildScene);
  pause.addEventListener('click', () => setPaused(!paused), eventOptions);
  restart.addEventListener('click', reset, eventOptions);
  loadAsset.addEventListener(
    'click',
    async () => {
      if (
        stopped ||
        restartOwnership.pending ||
        graphicsRecovery.restartRequired ||
        !surfacePreparation?.completed
      )
        return;
      if (!environmentPreparation?.gantry?.completed) return;
      if (!environmentPreparation?.lamps?.completed) return;
      if (!environmentPreparation?.banner?.completed) return;
      if (!stripePreparation?.completed) return;
      const currentScene = scene!,
        owner = assetLoad;
      const deadline = performance.now() + 120000;
      const budget = new AbortController();
      const signal = AbortSignal.any([owner.signal, budget.signal]);
      const timer = setTimeout(
        () =>
          budget.abort(new Error('Original model readiness exceeded its 120000ms total budget')),
        120000,
      );
      let container: AssetContainer | undefined;
      let steering: ExistingPlayerSteering | undefined;
      let wheels: ExistingPlayerWheels | undefined;
      let heightAdapter:
        | import('./existing-player-height.ts').ExistingPlayerHeightAdapter
        | undefined;
      let installed = false;
      let disposeUninstalled = (): unknown[] => [];
      const active = () => {
        signal.throwIfAborted();
        if (performance.now() >= deadline)
          throw new Error('Original model readiness exceeded its 120000ms total budget');
        if (
          stopped ||
          scene !== currentScene ||
          currentScene.scene.isDisposed ||
          restartOwnership.pending
        )
          throw new DOMException('Original model ownership changed', 'AbortError');
      };
      loadAsset.disabled = true;
      delete assetStatus.dataset.scalarHeightMaterials;
      assetStatus.textContent = 'Loading and verifying the existing authored Formula asset…';
      try {
        const { loadExistingPlayer, disposeUninstalledPlayer } = await import(
          './existing-player.ts'
        );
        disposeUninstalled = () => disposeUninstalledPlayer(container, [steering, wheels]);
        const { createExistingPlayerHeightAdapter } = await import('./existing-player-height.ts');
        active();
        container = await loadExistingPlayer(
          currentScene.scene,
          document.baseURI,
          signal,
          async ({ raw, bindings }) => {
            active();
            await gpu!.prepare(
              'Original scalar-height materials',
              deadline,
              async (invalidated) => {
                // Owner cancellation is checked by the loader AFTER this lane
                // drains, not injected as a fatal compiler/preparation failure.
                const height = await createExistingPlayerHeightAdapter(raw, bindings, invalidated);
                invalidated.throwIfAborted();
                height.setEnabled(true);
                if (height.enabledCount !== 10)
                  throw new Error('Original scalar-height material activation incomplete');
                heightAdapter = height;
                // Materials own plugin lifetime; no per-frame toggle or new
                // texture owner survives this one-time initialization stage.
              },
            );
          },
        );
        active();
        wheels = new ExistingPlayerWheels([...container.transformNodes, ...container.meshes]);
        steering = new ExistingPlayerSteering(container.animationGroups);
        // Keep the container's complete hierarchy off-scene until atomic add.
        // The entrant contributes only rigid translation/rotation, not scale
        // defines; retain every authored local transform and the existing datum.
        const entrant = currentScene.entrants[0];
        if (
          entrant.parent ||
          entrant.scaling.x !== 1 ||
          entrant.scaling.y !== 1 ||
          entrant.scaling.z !== 1
        )
          throw new Error('Original model preparation requires the existing unit-scale entrant');
        for (const node of container.rootNodes)
          if (node instanceof TransformNode) node.position.y -= 0.25;
        status.dataset.presentationSettled = 'false';
        await prepareOriginalMaterials(container, gpu!, signal, deadline, (done, total, label) => {
          if (!signal.aborted && scene === currentScene)
            assetStatus.textContent = `Preparing original model shader variants ${done}/${total}: ${label}`;
        });
        active();
        container.addAllToScene();
        for (const node of container.rootNodes) node.parent = entrant;
        installed = true;
        playerSteering = steering;
        playerWheels = wheels;
        currentScene.scene.getMeshByName('migration-proxy-0')?.setEnabled(false);
        assetStatus.textContent = 'Waiting for completed original-model presentation…';
        const finishPreparation = presentation.prepare();
        try {
          await waitForPresentation(currentScene.scene, signal, gpu!);
        } finally {
          finishPreparation();
        }
        active();
        if (heightAdapter?.enabledCount !== 10)
          throw new Error('Original scalar-height material activation incomplete');
        assetStatus.dataset.scalarHeightMaterials = String(heightAdapter.enabledCount);
        assetStatus.textContent =
          'Original Formula asset loaded in Babylon. Driver and rigid wheel motion follow physics; tyre deformation, LOD and full material parity are still pending.';
      } catch (error) {
        delete assetStatus.dataset.scalarHeightMaterials;
        // Never retry against a compiler whose ownership could not be drained.
        if (gpu?.diagnostics().preparation.failure || (installed && !owner.signal.aborted)) {
          stop(error);
          return;
        }
        if (owner.signal.aborted || stopped || scene !== currentScene) return;
        loadAsset.disabled = false;
        assetStatus.textContent = `Model unavailable: ${error instanceof Error ? error.message : String(error)}. Retry is safe.`;
      } finally {
        clearTimeout(timer);
        if (!installed) {
          for (const failure of disposeUninstalled())
            console.error('Original model cleanup failed:', failure);
        }
      }
    },
    eventOptions,
  );
  document.addEventListener(
    'visibilitychange',
    () => {
      if (document.hidden) setPaused(true);
      else requestPresentation();
    },
    eventOptions,
  );
  window.addEventListener(
    'resize',
    () => {
      resizePending = true;
      requestPresentation();
    },
    eventOptions,
  );
  inputPump = new InputPump((dt) => {
    if (document.hidden) return;
    if (paused) {
      input!.pollActions(['pause']);
      return;
    }
    const command = input!.update(dt);
    component.setInput(command);
    command.shift = 0;
    command.drs = command.overtake = false;
  });
  inputPump.start();
  engine.runRenderLoop(() => {
    if (stopped) return;
    try {
      const now = performance.now(),
        seconds = (now - last) / 1000;
      last = now;
      component.advance(seconds);
      let startupVisualCaptured = false;
      const polled = pollPresentationForRender(gpu!, presentation, paused);
      if (polled.ready) {
        restartOwnership.drain(true, rebuildScene);
        if (!graphicsRecovery.restartRequired && resizePending) {
          if (resizePresentationWhenIdle(gpu!, () => engine!.resize())) resizePending = false;
        }
        // Rebuild may have claimed the preparation lane since the outer ready check.
        if (
          !polled.deferSubmission &&
          (!environmentPreparation || environmentPreparation.canDraw) &&
          (!stripePreparation || stripePreparation.canDraw)
        )
          if (!graphicsRecovery.restartRequired && surfacePreparation?.canDraw && gpu!.ready())
            gpu!.frame(presentation, paused, scene!.scene, () => {
              if (playerSteering)
                assetStatus.dataset.steering = String(playerSteering.apply(component.frame));
              if (playerWheels)
                assetStatus.dataset.wheelPhase = String(playerWheels.apply(component.frame));
              environmentPreparation?.lamps?.apply(component.frame);
              if (environmentPreparation?.lamps?.completed)
                publishLampDiagnostics(environmentPreparation?.lamps);
              const readyBefore = scene!.scene.isReady();
              scene!.render(component.frame);
              const readyAfter = scene!.scene.isReady();
              presentation.rendered(readyBefore, readyAfter);
              const gantryReady =
                readyBefore && readyAfter && !!environmentPreparation?.gantry?.completed;
              status.dataset.sceneReady = String(
                gantryReady &&
                  !!environmentPreparation?.lamps?.completed &&
                  !!environmentPreparation?.banner?.completed &&
                  !!stripePreparation?.completed,
              );
              const visualInspection =
                paused && !playerSteering && !playerWheels
                  ? inspectStartupVisualState(scene!)
                  : null;
              renderedStartupVisualState = paused
                ? {
                    source: 'last-owned-paused-draw',
                    state: visualInspection?.state ?? null,
                    rejectionCode:
                      visualInspection?.rejectionCode ??
                      (!visualInspection ? 'authored-player-active' : null),
                    sequence: null,
                    tick: component.simulation.tick,
                  }
                : null;
              startupVisualCaptured = true;
              startupPublication?.drawn(renderedStartupVisualState?.state ?? null);
              return readyBefore && readyAfter;
            });
      }
      const graphics = gpu!.diagnostics();
      if (renderedStartupVisualState?.sequence === null)
        renderedStartupVisualState.sequence = startupVisualSubmissionSequence(
          graphics,
          startupVisualCaptured,
          renderedFrames,
        );
      renderedFrames = graphics.submitted;
      status.dataset.renderedFrames = String(renderedFrames);
      status.dataset.completedFrames = String(graphics.completed);
      status.dataset.lastCompletedSequence = String(graphics.lastCompletedSequence);
      status.dataset.abandonedFrames = String(graphics.abandoned);
      status.dataset.presentationSettled = String(
        paused &&
          !restartOwnership.pending &&
          !!surfacePreparation?.completed &&
          !!environmentPreparation?.completed &&
          !!environmentPreparation?.gantry?.completed &&
          !!environmentPreparation?.lamps?.completed &&
          !!environmentPreparation?.banner?.completed &&
          !!stripePreparation?.completed &&
          !graphicsRecovery.restartRequired &&
          !resizePending &&
          !presentation.pending &&
          !graphics.lost &&
          !graphics.disposed &&
          !graphics.queue.failure &&
          graphics.settled,
      );
      if (now - lastStatus > 250) {
        lastStatus = now;
        status.dataset.steer = String(component.frame[carBase(0) + F.STEER]);
        status.dataset.throttle = String(component.frame[carBase(0) + F.THROTTLE]);
        status.textContent = `${paused ? 'PAUSED' : component.simulation.autoPlayer ? 'AI DEMO' : 'DRIVING'} · ${Math.round(component.frame[carBase(0) + F.SPEED] * 3.6)} km/h · physics tick ${component.simulation.tick}`;
      }
    } catch (error) {
      stop(error);
    }
  });
} catch (error) {
  stop(error);
}
