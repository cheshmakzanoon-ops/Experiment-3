import { expect, test } from '@playwright/test';
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { motocrossScreenCapture } from './fixtures/motocross-screen-capture.ts';
import { mod } from '../src/core/math.ts';
import { F, H, O, R, OFFROAD_BASE, RACE_BASE, carBase } from '../src/simulation/protocol.ts';
import { vehicleIndex } from '../src/simulation/vehicles.ts';
import { LANDING_RULES } from '../src/simulation/offroad/riding-feedback.ts';
import { MENU_STARTUP_TIMEOUT_MS } from './menu-startup.ts';

// Every player-facing transition already attaches its full-resolution image.
// Keep actions, DOM snapshots and errors on failure without running a second
// continuous Chromium screencast while the game submits its gate frames.
test.use({ trace: { mode: 'retain-on-failure', screenshots: false, snapshots: true } });

/** Normal production app and worker. Every change uses visible controls or
 * player key bindings; apexDiagnostics is observed without modifying state. */
test('real motocross player entry, eight-rider gate, riding, cameras, pause and venue switch', async ({
  page,
}, info) => {
  // Cold boot, two complete venue builds and observed riding on the software
  // GPU have separate readiness budgets; this is a functional, bounded run.
  test.setTimeout(1200000);
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  page.on('console', (message) => {
    if (message.type() === 'error') errors.push(message.text());
    if (message.text().startsWith('[MX loading]')) console.info(message.text());
  });
  if (process.env.APEX_MOTOCROSS_JOURNEY_PROGRESS === '1') {
    await page.addInitScript(() => {
      let lastStage = '';
      window.setInterval(() => {
        const board = document.getElementById('loading');
        if (!board || board.hidden || !board.getClientRects().length) {
          lastStage = '';
          return;
        }
        const percent = document.getElementById('loadingPercent')?.textContent ?? '';
        const detail = document.getElementById('loadingText')?.textContent?.trim();
        const stage = detail ? `${percent} ${detail}` : '';
        if (stage && stage !== lastStage) {
          lastStage = stage;
          console.info(`[MX loading] ${stage}`);
        }
      }, 5000);
    });
  }
  const diag = () => page.evaluate(() => window.apexDiagnostics());
  const screenshot = await motocrossScreenCapture(page);
  const images = new Set<string>();
  const capture = async (name: string) => {
    const path = info.outputPath(name);
    await screenshot(path);
    const pixels = await readFile(path);
    expect(pixels.readUInt32BE(16)).toBe(page.viewportSize()!.width);
    expect(pixels.readUInt32BE(20)).toBe(page.viewportSize()!.height);
    const digest = createHash('sha256').update(pixels).digest('hex');
    expect(images.has(digest), `${name} presents a new game image`).toBe(false);
    images.add(digest);
    await info.attach(name, { path, contentType: 'image/png' });
    const snapshot = await diag();
    console.info(
      `[MX journey] Captured ${name} (${snapshot.state}, ${
        snapshot.frame?.[H.TIME].toFixed(1) ?? '0'
      } s)`,
    );
  };
  await page.goto('/');
  await expect(page.locator('#menu')).toBeVisible({ timeout: MENU_STARTUP_TIMEOUT_MS });
  const entryPresentation = (await diag()).renderer!;
  expect(entryPresentation.presentationPurpose).toBe('showroom');
  expect(entryPresentation.presentedBackdrop).toBe('studio');
  expect(entryPresentation.construction.tasks).toBe(0);
  expect(entryPresentation.gpuFrameQueue.completed).toBeGreaterThan(0);
  // Software GPUs can spend the whole riding budget on a production frame.
  // An explicit opt-in exercises the same visible settings flow while the
  // separate bike/world fixtures retain their full rendering checks.
  const quality = process.env.APEX_MOTOCROSS_JOURNEY_QUALITY;
  if (quality) {
    if (!['low', 'medium', 'high', 'ultra'].includes(quality))
      throw new Error(`Unsupported motocross journey quality: ${quality}`);
    await page.getByRole('button', { name: 'GARAGE & SETTINGS', exact: true }).click();
    await expect(page.locator('#settingsForm')).toBeVisible();
    await page.locator('[name=quality]').selectOption(quality);
    await page.getByRole('button', { name: 'APPLY & SAVE', exact: true }).click();
    await expect(page.locator('#modal')).toBeHidden({ timeout: MENU_STARTUP_TIMEOUT_MS });
    await expect.poll(async () => (await diag()).settingsTransition.busy).toBe(false);
    console.info(`[MX journey] Selected ${quality} through the production settings form`);
  }
  const reports = [];
  const o = carBase(0);
  for (const [circuit, entry, machine] of [
    ['valley-ridge-mx', 'OUTDOOR MX', 'mx450'],
    ['arena-nord-sx', 'STADIUM SX', 'mx250'],
  ] as const) {
    console.info(`[MX journey] Selecting ${circuit} and ${machine}`);
    const before = (await diag()).presentation!.frames;
    // The dirt shortcuts belong to the DIRT plate (they are hidden under the other plates).
    await page.getByRole('radio', { name: /^DIRT/ }).click();
    await page.getByRole('button', { name: entry, exact: true }).click();
    await page.locator('#vehicle').selectOption(machine);
    // The worker keeps racing while a software renderer captures the views.
    // Use the normal ten-lap race distance so the leaders cannot finish the
    // meeting halfway through the camera and pause observations.
    await page.locator('#laps').selectOption('10');
    await expect(page.locator('#vehicle')).toHaveValue(machine);
    // Observe the completed revision belonging to this selection. A second
    // orbit frame can be GPU-owned long after the chosen bike is on screen.
    await expect
      .poll(
        async () => {
          const d = await diag();
          return {
            machine: d.menuPreview?.machine,
            current: d.menuPreview?.current,
            time: d.menuPreview?.time,
            submitted: (d.presentation?.frames ?? 0) > before,
            backdrop: d.renderer?.presentedBackdrop,
          };
        },
        {
          timeout: MENU_STARTUP_TIMEOUT_MS,
          message: `${circuit}: selected motorcycle is on screen`,
        },
      )
      .toEqual({ machine, current: true, time: 0, submitted: true, backdrop: 'studio' });
    await capture(`${circuit}-actual-menu.png`);
    console.info(`[MX journey] Preparing the complete ${circuit} session`);
    await page.getByRole('button', { name: 'ENTER CIRCUIT', exact: true }).click();
    // The normal loader prepares every chase/shadow/reflection pass. Keep
    // those production checks intact while allowing software compilation its
    // own bounded readiness interval; this is not a load-time benchmark.
    await expect(page.locator('#raceBriefing')).toBeVisible({ timeout: 300000 });
    console.info(`[MX journey] ${circuit} is prepared at the held eight-rider gate`);
    const initialized = await diag();
    expect(initialized.renderer?.presentationPurpose).toBe('circuit');
    expect(initialized.renderer?.construction.tasks).toBeGreaterThan(0);
    expect(initialized.renderer?.preparation?.status).toBe('complete');
    expect(initialized.renderer?.pitPersonnel.wheelGuns).toBeNull();
    expect(initialized.renderer?.pitPersonnel.pitJacks).toBeNull();
    expect(initialized.renderer?.trackInfrastructure.marshalPosts).toBeGreaterThan(0);
    expect(initialized.options.circuit).toBe(circuit);
    expect(initialized.options.laps).toBe(10);
    expect(initialized.frame?.[H.CARS]).toBe(8);
    expect(initialized.frame?.[H.TICK]).toBe(0);
    expect(initialized.frame?.[H.SC_PHASE]).toBe(0);
    expect(initialized.auto).toBe(false);
    for (let rider = 0; rider < 8; rider++)
      expect(
        initialized.frame![carBase(rider) + RACE_BASE + R.VEHICLE],
        `${circuit}: initialized rider ${rider} uses the selected machine`,
      ).toBe(vehicleIndex(machine));
    await expect(page.locator('#raceBriefing')).toContainText('RIDERS');
    await expect
      .poll(
        async () => {
          const held = await diag();
          const queue = held.renderer?.gpuFrameQueue;
          return (
            held.state === 'paused' &&
            held.presentation?.renderedState === 'paused' &&
            held.renderer?.presentedBackdrop === 'circuit' &&
            held.frame?.[H.TICK] === 0 &&
            !!queue &&
            queue.completed > 0 &&
            queue.completed === queue.submitted &&
            !queue.pending
          );
        },
        { timeout: 60000, message: `${circuit}: the held gate has finished its GPU work` },
      )
      .toBe(true);
    const gateFrame = await page.evaluate(async () => {
      const before = window.apexDiagnostics().presentation?.frames;
      const start = performance.now();
      // Observe across several normal 15 Hz paused-world paint opportunities.
      await new Promise<void>((resolve) => {
        const check = (now: number) =>
          now - start >= 220 ? resolve() : requestAnimationFrame(check);
        requestAnimationFrame(check);
      });
      return { before, after: window.apexDiagnostics().presentation?.frames };
    });
    expect(gateFrame.after).toBe(gateFrame.before);
    await page.getByRole('button', { name: 'GO TO THE GATE', exact: true }).click();
    await expect.poll(async () => (await diag()).state).toBe('driving');
    await expect(page.locator('.mx-ride-hud')).toBeVisible();
    const ticksBeforeRelease: number[] = [];
    await expect
      .poll(
        async () => {
          const gate = await diag();
          const phase = gate.gridPresentation.dirtGateRelease;
          if (phase && phase !== 'released') ticksBeforeRelease.push(gate.frame![H.TICK]);
          return phase;
        },
        {
          timeout: 60000,
          message: `${circuit}: the first live gate frame reached the screen before the worker started`,
        },
      )
      .toBe('released');
    expect(ticksBeforeRelease.every((tick) => tick === 0)).toBe(true);
    await capture(`${circuit}-actual-gate.png`);
    await expect.poll(async () => (await diag()).frame?.[H.PHASE] ?? 0).toBe(2);
    // Keep the bike stationary with the ordinary front brake and exercise
    // both independently held body controls through Main -> worker -> pose.
    // Diagnostics remain read-only; no position or flight is synthesized.
    await page.keyboard.down('s');
    await page.keyboard.down('q');
    await expect
      .poll(async () => (await diag()).frame?.[o + OFFROAD_BASE + O.BODY] ?? 0, { timeout: 30000 })
      .toBeGreaterThan(0.55);
    const bodyForward = await diag();
    expect(bodyForward.auto).toBe(false);
    expect(bodyForward.frame![o + F.SPEED]).toBeLessThan(1);
    await page.keyboard.up('q');
    await page.keyboard.down('z');
    await expect
      .poll(async () => (await diag()).frame?.[o + OFFROAD_BASE + O.BODY] ?? 0, { timeout: 30000 })
      .toBeLessThan(-0.55);
    const bodyBack = await diag();
    expect(bodyBack.frame![o + F.SPEED]).toBeLessThan(1);
    await capture(`${circuit}-actual-weight-back.png`);
    await page.keyboard.up('z');
    await page.keyboard.up('s');
    // Exercise the real player throttle before handing the observed run to
    // the game's explicitly enabled AI demonstration.
    await page.keyboard.down('w');
    await expect
      .poll(async () => (await diag()).frame?.[o + F.SPEED] ?? 0, { timeout: 30000 })
      .toBeGreaterThan(3);
    const human = await diag();
    expect(human.auto).toBe(false);
    expect(human.frame?.[o + F.THROTTLE]).toBeGreaterThan(0.2);
    await page.keyboard.up('w');
    await page.keyboard.press('g');
    await expect.poll(async () => (await diag()).auto).toBe(true);
    const aiStart = (await diag()).frame!,
      aiStartedAt = aiStart[H.TIME],
      length = aiStart[H.LENGTH];
    expect(length).toBeGreaterThan(0);
    type RideObservation = {
      tick: number;
      time: number;
      s: number;
      progressM: number;
      speed: number;
      airborne: boolean;
      airTime: number;
      landingSpeed: number;
      landingPitch: number;
      safetyCarPhase: number;
      presentedTime: number;
    };
    const observations: RideObservation[] = [];
    let previousS = aiStart[o + F.S],
      previousTick = aiStart[H.TICK],
      progressM = 0,
      maxAirTime = 0,
      maxSafetyCarPhase = 0;
    let landing: RideObservation | null = null;
    await expect
      .poll(
        async () => {
          const d = await diag(),
            frame = d.frame!;
          if (frame[H.TICK] !== previousTick) {
            const s = frame[o + F.S];
            // The gate is just before S=0. Preserve signed progress through
            // that wrap; backwards movement cannot count as forward travel.
            progressM += mod(s - previousS + length / 2, length) - length / 2;
            previousS = s;
            previousTick = frame[H.TICK];
            const sample: RideObservation = {
              tick: frame[H.TICK],
              time: frame[H.TIME],
              s,
              progressM,
              speed: frame[o + F.SPEED],
              airborne: frame[o + OFFROAD_BASE + O.AIRBORNE] > 0.5,
              airTime: frame[o + OFFROAD_BASE + O.AIR_TIME],
              landingSpeed: frame[o + OFFROAD_BASE + O.LANDING_SPEED],
              landingPitch: frame[o + OFFROAD_BASE + O.LANDING_PITCH],
              safetyCarPhase: frame[H.SC_PHASE],
              presentedTime: d.presentation?.time ?? 0,
            };
            maxSafetyCarPhase = Math.max(maxSafetyCarPhase, sample.safetyCarPhase);
            observations.push(sample);
            maxAirTime = Math.max(maxAirTime, sample.airTime);
            // AIR_TIME persists after touchdown, so slow presentation need
            // not catch the short AIRBORNE=true edge to prove a real flight.
            if (
              !landing &&
              !sample.airborne &&
              sample.airTime > LANDING_RULES.minimumAirTime &&
              sample.landingSpeed > 0.05 &&
              Number.isFinite(sample.landingPitch)
            )
              landing = sample;
          }
          return {
            ridingInterval: frame[H.TIME] - aiStartedAt >= 20,
            forwardProgress: progressM >= 100,
            qualifyingFlight: maxAirTime > LANDING_RULES.minimumAirTime,
            recordedTouchdown: landing !== null,
            renderedRiding: (d.presentation?.time ?? 0) - aiStartedAt >= 10,
          };
        },
        {
          timeout: 180000,
          intervals: [200, 250, 500],
          message: `${circuit}: real course progress, qualifying flight, touchdown and rendered riding`,
        },
      )
      .toEqual({
        ridingInterval: true,
        forwardProgress: true,
        qualifyingFlight: true,
        recordedTouchdown: true,
        renderedRiding: true,
      });
    const ridden = await diag();
    expect(
      maxSafetyCarPhase,
      `${circuit}: motocross retains local cautions without a pace car`,
    ).toBe(0);
    expect(ridden.frame![H.SC_PHASE]).toBe(0);
    expect(ridden.frame!.every(Number.isFinite)).toBe(true);
    expect(ridden.renderer?.environmentAssets.freshMxTyreSegments).toBeGreaterThan(0);
    expect(ridden.options.vehicles?.every((id) => id === machine)).toBe(true);
    expect(ridden.presentation!.frames).toBeGreaterThan(initialized.presentation!.frames);
    console.info(`[MX journey] ${circuit} has real course progress, flight and touchdown`);
    await capture(`${circuit}-actual-chase.png`);
    expect((await diag()).state, `${circuit} is live before switching cameras`).toBe('driving');
    await page.keyboard.press('c');
    await expect
      .poll(async () => {
        const state = await diag();
        return { state: state.state, camera: state.renderer?.camera };
      })
      .toEqual({ state: 'driving', camera: 'cockpit' });
    await capture(`${circuit}-actual-onboard.png`);
    await page.keyboard.press('Escape');
    await expect(page.getByRole('button', { name: 'RESUME SESSION', exact: true })).toBeVisible();
    await expect.poll(async () => (await diag()).workerPause.pending).toBe(false);
    const paused = await diag();
    expect(paused.frame![H.SC_PHASE]).toBe(0);
    await capture(`${circuit}-actual-pause.png`);
    const held = await diag();
    expect(held.workerPause.paused).toBe(true);
    expect(held.frame![H.TICK]).toBe(paused.frame![H.TICK]);
    reports.push({
      circuit,
      machine,
      mode: 'normal application, player throttle followed by explicitly enabled AI demonstration',
      requestedQuality: quality ?? 'saved/default',
      ticksBeforeRelease,
      human: {
        time: human.frame![H.TIME],
        speed: human.frame![o + F.SPEED],
        throttle: human.frame![o + F.THROTTLE],
        auto: human.auto,
        bodyForward: bodyForward.frame![o + OFFROAD_BASE + O.BODY],
        bodyBack: bodyBack.frame![o + OFFROAD_BASE + O.BODY],
      },
      aiStartedAt,
      progressM,
      maxAirTime,
      maxSafetyCarPhase,
      landing,
      observations,
      final: { frame: ridden.frame, renderer: ridden.renderer, presentation: ridden.presentation },
      pausedTick: held.frame![H.TICK],
    });
    await info.attach(`${circuit}-journey.json`, {
      body: JSON.stringify(reports[reports.length - 1], null, 2),
      contentType: 'application/json',
    });
    await page.getByRole('button', { name: 'RETURN TO PADDOCK', exact: true }).click();
    await expect(page.locator('#menu')).toBeVisible();
    await expect
      .poll(
        async () => {
          const d = await diag();
          return {
            purpose: d.renderer?.presentationPurpose,
            backdrop: d.renderer?.presentedBackdrop,
            machine: d.menuPreview?.machine,
            current: d.menuPreview?.current,
            time: d.menuPreview?.time,
            presented: d.presentation?.time,
          };
        },
        { timeout: MENU_STARTUP_TIMEOUT_MS },
      )
      .toEqual({
        purpose: 'circuit',
        backdrop: 'studio',
        machine,
        current: true,
        time: 0,
        presented: 0,
      });
    console.info(`[MX journey] ${circuit} returned to its selected-machine paddock`);
  }
  expect(errors).toEqual([]);
  await info.attach('motocross-production-journey.json', {
    body: JSON.stringify(
      {
        graphicsBackend:
          'Reported separately by browser-backend.json; no physical hardware FPS certification',
        reports,
      },
      null,
      2,
    ),
    contentType: 'application/json',
  });
});
