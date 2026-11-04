/**
 * GAME DIRECTOR: drives the REAL game in headless Chromium to capture hero frames.
 *
 * Shared by `art-frames.mjs` (Steam key-art source frames) and `trailer-capture.mjs` (storyboard
 * keyframes). The techniques are the ones `store-shots.mjs` found reliable on software GL (SwiftShader,
 * a shot takes minutes): scan the session at a small viewport, PAUSE on the moment with the game's own
 * pause, then grow the viewport and let the held frame redraw. On top of that this adds the PHOTO STUDIO
 * as the camera: from a held session (or the menu showroom) the studio's free orbit, lens, filter and
 * depth of field frame the shot, so a hero frame is not limited to the chase camera.
 *
 * A shot is a plain object (see SHOT FIELDS below); a scene function turns it into an encoded frame.
 * `runShots` is the resumable loop: a captured shot is skipped on the next run, a failed one is logged
 * and the browser is relaunched, `--budget-minutes` stops between shots, one browser at a time.
 *
 * SHOT FIELDS
 *   id, title, alt, kind       kind: menu-photo | session | festival-coast | wildcard
 *   size [w,h]                 output size (default 1920x1080)
 *   entry                      { plate, circuit, vehicle, weather, light, mode, opponents, laps }
 *   view                       in-session camera for the scan ('chase' ...)
 *   pick                       { seconds, minSpeed } | { scan: 'lean' | 'air', attempts }  (session, wildcard)
 *   photo                      photo-studio settings (see applyPhoto); absent = no studio, the plain frame
 *   hud                        keep the HUD in a plain session frame
 *   event                      wildcard event id (wildcard) / festival event id to travel to (festival-coast)
 *   orbit                      festival photo mode: number of 22.5 degree orbit steps (+ right, - left)
 */
import { appendFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const HIDE_CHROME = `#app,#app *{visibility:hidden!important}#modal::backdrop{background:transparent!important}`;

export class Director {
  /**
   * @param {object} o
   * @param {string} o.url        the running game (vite preview of a FULL build)
   * @param {(m: string) => void} o.log
   * @param {[number, number]} [o.scan]   scan viewport while a moment is searched
   * @param {string} [o.preset]   render quality preset applied from the settings dialog
   * @param {number} [o.quality]  JPEG quality of the frames
   */
  constructor({ url, log, scan = [640, 360], preset = 'high', quality = 92 }) {
    this.url = url;
    this.log = log;
    this.scan = scan;
    this.preset = preset;
    this.quality = quality;
    this.browser = null;
    this.page = null;
    this.errors = [];
    this.build = null;
    this.previewOnly = false;
  }

  // ---- Browser -----------------------------------------------------------------------------------
  async boot() {
    await this.close();
    const { chromium } = await import('@playwright/test');
    this.browser = await chromium.launch({
      headless: true,
      executablePath: process.env.CHROMIUM_PATH || '/opt/pw-browsers/chromium',
      args: [
        '--use-gl=angle',
        '--use-angle=swiftshader',
        '--enable-unsafe-swiftshader',
        '--ignore-gpu-blocklist',
        '--no-sandbox',
        '--headless=new',
      ],
    });
    this.page = await this.browser.newPage({ viewport: { width: this.scan[0], height: this.scan[1] } });
    this.page.setDefaultTimeout(900000);
    this.page.on('pageerror', (e) => this.errors.push(`pageerror: ${e.message}`));
    this.page.on('console', (m) => m.type() === 'error' && this.errors.push(`console: ${m.text()}`));
    this.log('boot: loading the game');
    await this.page.goto(this.url);
    await this.waitFor('menu', (d) => d.state === 'menu', 1800000, 1000);
    await sleep(6000);
    await this.applyQuality();
    const d = await this.probe();
    this.build = d?.build ?? null;
    this.log(`boot: menu ready (build ${this.build ?? 'unknown'})`);
  }
  async close() {
    try {
      await this.browser?.close();
    } catch {
      /* already gone */
    }
    this.browser = null;
    this.page = null;
  }

  // ---- Probing and waiting -----------------------------------------------------------------------
  probe() {
    return this.page
      .evaluate(() => {
        const d = window.apexDiagnostics?.();
        if (!d) return null;
        const r = d.renderer ?? {};
        return {
          build: d.buildIdentity?.commit ?? null,
          state: d.state,
          auto: d.auto,
          festival: d.festival,
          lighting: r.lighting,
          requestedCamera: r.requestedCamera,
          presentedCamera: r.presentedCamera,
          frame: d.frame,
          presentationFrames: d.presentation?.frames ?? 0,
          presented: d.presentation ? { time: d.presentation.time, car: d.presentation.car ?? null } : null,
          menuPreview: d.menuPreview,
          mode: document.querySelector('#app')?.dataset.mode ?? null,
        };
      })
      .catch(() => null);
  }
  async waitFor(label, predicate, timeout = 600000, interval = 400) {
    const end = Date.now() + timeout;
    let last = null;
    while (Date.now() < end) {
      last = await this.probe();
      if (last && predicate(last)) return last;
      await sleep(interval);
    }
    throw new Error(`timed out: ${label} (last state ${last?.state}, mode ${last?.mode})`);
  }
  click(selector) {
    return this.page.evaluate((s) => {
      const e = document.querySelector(s);
      if (!e) throw new Error(`missing ${s}`);
      e.click();
    }, selector);
  }
  async setViewport(w, h) {
    await this.page.setViewportSize({ width: w, height: h });
    await sleep(2500);
  }
  async hideChrome(on) {
    await this.page.evaluate(
      ([css, enable]) => {
        document.getElementById('director-hide')?.remove();
        if (!enable) return;
        const s = document.createElement('style');
        s.id = 'director-hide';
        s.textContent = css;
        document.head.append(s);
      },
      [HIDE_CHROME, on],
    );
  }
  async encode(size, type = 'jpeg') {
    const started = Date.now();
    const buffer = await this.page.screenshot({
      type,
      quality: type === 'jpeg' ? this.quality : undefined,
      timeout: 3600000,
    });
    this.log(`screenshot ${size[0]}x${size[1]} ${(buffer.length / 1024).toFixed(0)} KB in ${((Date.now() - started) / 1000).toFixed(0)} s`);
    return buffer;
  }
  /** PREVIEW mode: frame at the scan size and stop (no 1080p redraw), so a camera can be judged in seconds. */
  async previewFrame() {
    await this.hideChrome(true);
    await sleep(5000);
    const buffer = await this.encode(this.scan);
    await this.hideChrome(false);
    return { buffer, note: 'PREVIEW at the scan size, not a kept frame', preview: true };
  }
  async debugShot(dir, name) {
    if (!dir) return;
    mkdirSync(dir, { recursive: true });
    const buffer = await this.page.screenshot({ type: 'jpeg', quality: 70, timeout: 600000 });
    writeFileSync(join(dir, `${name}.jpg`), buffer);
  }

  // ---- Menu and session plumbing (from store-shots.mjs) --------------------------------------------
  async applyQuality() {
    if (!this.preset || this.preset === 'medium') return;
    try {
      await this.click('#menu [data-action="settings"]');
      await this.page.locator('[name=quality]').selectOption(this.preset);
      await this.page.getByRole('button', { name: 'APPLY & SAVE', exact: true }).click();
      await this.page.locator('#modal').waitFor({ state: 'hidden', timeout: 600000 });
      await this.waitFor('menu after settings', (d) => d.state === 'menu', 600000, 500);
      await sleep(4000);
      this.log(`render quality ${this.preset}`);
    } catch (error) {
      this.log(`render quality ${this.preset} not applied (${String(error.message).split('\n')[0]}); keeping the default`);
      await this.page.keyboard.press('Escape').catch(() => {});
    }
  }
  async toMenu() {
    const page = this.page;
    const d = await this.probe();
    if (d?.state === 'menu' && !d.festival?.active) return;
    if (d?.festival?.active) {
      await page.keyboard.press('Escape');
      await sleep(1500);
      const exit = page.locator('[data-fest="exit"]');
      if (await exit.count()) await exit.first().click();
      await this.waitFor('menu', (x) => x.state === 'menu' && !x.festival?.active, 300000, 500);
      return;
    }
    if (d?.state === 'photo') {
      await this.click('#photoStudio [data-photo-action="close"]').catch(() => {});
      await this.waitFor('leave photo', (x) => x.state !== 'photo', 120000, 300);
    }
    const e = await this.probe();
    if (e?.state === 'driving') await page.keyboard.press('Escape');
    if (e?.state === 'replay') await this.click('[data-action="replayExit"]');
    if (e?.state === 'results') {
      await this.click('#modal [data-action="menu"]').catch(() => {});
    } else {
      await this.waitFor('pause', (x) => x.state === 'paused' || x.state === 'menu' || x.state === 'results', 180000, 300);
      const f = await this.probe();
      if (f?.state === 'paused' || f?.state === 'results') await this.click('#modal [data-action="menu"]');
    }
    await this.waitFor('menu', (x) => x.state === 'menu', 300000, 400);
    await sleep(3000);
  }
  async setEntry(entry = {}) {
    const page = this.page;
    await this.toMenu();
    if (entry.plate) {
      await page.locator(`.lb-plate[data-discipline="${entry.plate}"]`).click();
      await sleep(2500);
    }
    const select = async (id, value) => {
      if (value === undefined) return;
      await page.locator(`#${id}`).selectOption(value);
      await sleep(500);
    };
    await select('mode', entry.mode ?? 'practice');
    await select('circuit', entry.circuit);
    await select('vehicle', entry.vehicle);
    await select('weather', entry.weather);
    await select('light', entry.light);
    await select('opponents', entry.opponents ?? '0');
    if (entry.laps) await select('laps', entry.laps);
  }
  async enterAndDrive(label) {
    await this.click('#menu button.enter.primary');
    const briefing = this.page.getByRole('button', { name: /GO STRAIGHT TO LIGHTS|GO TO THE GATE/ });
    const first = await Promise.race([
      briefing.waitFor({ state: 'visible', timeout: 1800000 }).then(() => 'briefing'),
      this.waitFor('driving', (d) => d.state === 'driving', 1800000, 500).then(() => 'driving'),
    ]);
    if (first === 'briefing') {
      await briefing.click();
      await this.waitFor('driving', (d) => d.state === 'driving', 1800000, 500);
    }
    this.log(`${label}: driving`);
  }
  async setView(view) {
    for (let i = 0; i < 8; i++) {
      const d = await this.probe();
      if (d?.presentedCamera === view && d?.requestedCamera === view) return true;
      if (d?.requestedCamera !== view) await this.page.keyboard.press('c');
      await sleep(1200);
    }
    return false;
  }

  /**
   * Drive on the AI driver at the scan size and PAUSE on the moment the shot asks for
   * (pick.scan 'lean' | 'air', or pick.seconds with a minimum speed). Returns the held diagnostics.
   */
  async parkOnMoment(shot) {
    const page = this.page;
    const pick = shot.pick;
    const carNow = (d) => d?.presented?.car ?? null;
    const wanted = Array.isArray(pick.seconds) ? pick.seconds[0] : pick.seconds;
    const limit = pick.attempts ?? 8;
    const hit = (d) => {
      const car = carNow(d);
      if (!car) return false;
      if (pick.scan === 'lean') return Math.abs(car.lean) > (pick.minLean ?? 0.5) && car.speed > 15;
      if (pick.scan === 'air') return car.airborne > 0.5 && car.airTime > 0.05 && car.airTime < (pick.maxAir ?? 0.7);
      return (d.presented?.time ?? 0) >= wanted && car.speed > (pick.minSpeed ?? 20);
    };
    const stillGood = (d) => {
      const car = carNow(d);
      if (!car) return false;
      if (pick.scan === 'lean') return Math.abs(car.lean) > (pick.minLean ?? 0.5) - 0.15 && car.speed > 12;
      if (pick.scan === 'air') return car.airborne > 0.5;
      return car.speed > 10;
    };
    const search = async () => {
      const started = Date.now();
      let beat = started;
      const seen = { lean: 0, speed: 0, air: 0, airTime: 0 };
      for (;;) {
        const d = await this.probe();
        const car = carNow(d);
        if (car) {
          seen.lean = Math.max(seen.lean, Math.abs(car.lean));
          seen.speed = Math.max(seen.speed, car.speed);
          seen.air = Math.max(seen.air, car.airborne);
          seen.airTime = Math.max(seen.airTime, car.airTime);
        }
        if (d && hit(d)) return d;
        if (d?.state === 'results' || d?.state === 'menu') throw new Error(`the session ended (${d.state}) before the moment`);
        if (Date.now() - beat > 20000) {
          beat = Date.now();
          this.log(
            `${shot.id}: searching t=${d?.presented?.time?.toFixed(1)} s; seen max |lean| ${seen.lean.toFixed(2)}, speed ${seen.speed.toFixed(1)}, airborne ${seen.air}, air time ${seen.airTime.toFixed(2)}`,
          );
        }
        if (Date.now() - started > (pick.scan ? 900000 : 1800000)) throw new Error(`no moment found in ${(Date.now() - started) / 60000} min`);
        await sleep(pick.scan ? 60 : 400);
      }
    };
    if ((await this.probe())?.auto !== true) await page.keyboard.press('g');
    await this.waitFor('autopilot', (d) => d.auto === true, 120000, 300);
    for (let attempt = 1; attempt <= limit; attempt++) {
      const found = await search();
      await page.keyboard.press('Escape');
      const held = await this.waitFor('paused', (d) => d.state === 'paused', 120000, 100);
      const car = carNow(held);
      this.log(
        `${shot.id}: attempt ${attempt}: triggered at t=${found.presented?.time?.toFixed(2)} s, held at t=${held.presented?.time?.toFixed(2)} s, speed ${car?.speed?.toFixed(1)}, lean ${car?.lean?.toFixed(2)}, air ${car?.airborne} (${car?.airTime?.toFixed(2)} s)`,
      );
      if (stillGood(held)) return held;
      if (attempt === limit) break;
      await page.getByRole('button', { name: 'RESUME SESSION', exact: true }).click();
      await this.waitFor('driving', (d) => d.state === 'driving', 120000, 200);
      await sleep(pick.scan === 'air' ? 4000 : 6000);
    }
    throw new Error(`no ${pick.scan ?? 'timed'} moment held after ${limit} attempts`);
  }

  // ---- Photo studio as the camera --------------------------------------------------------------------
  /**
   * Set the photo studio. Selects: view, backdrop, filter, focusSubject, focusMode. Sliders and the
   * depthOfField checkbox are written as the studio's own inputs (the studio listens for `input`).
   * Angles: azimuth 0 looks at the car from behind-left, +-180 from the front; the studio's default is 38.
   */
  async applyPhoto(p) {
    const page = this.page;
    const selects = { view: 'photo-view', backdrop: 'photoBackdrop', filter: 'photo-filter', focusSubject: 'photo-focusSubject', focusMode: 'photo-focusMode' };
    // Backdrop and view first: the studio resets sliders it cannot honour.
    for (const key of ['backdrop', 'view', 'filter', 'focusSubject', 'focusMode']) {
      if (p[key] === undefined) continue;
      await page.locator(`#${selects[key]}`).selectOption(String(p[key]));
      await sleep(400);
    }
    const sliders = ['azimuth', 'elevation', 'distance', 'focalLength', 'exposure', 'roll', 'focusDistance', 'fStop', 'vignette', 'grain', 'saturation'];
    for (const key of sliders) {
      if (p[key] === undefined) continue;
      await page.evaluate(
        ([id, value]) => {
          const el = document.getElementById(id);
          if (!el) throw new Error(`missing #${id}`);
          el.value = String(value);
          el.dispatchEvent(new Event('input', { bubbles: true }));
        },
        [`photo-${key}`, p[key]],
      );
      await sleep(150);
    }
    if (p.depthOfField !== undefined) {
      await page.evaluate((on) => {
        const el = document.getElementById('photo-depthOfField');
        if (el && el.checked !== on) {
          el.checked = on;
          el.dispatchEvent(new Event('input', { bubbles: true }));
        }
      }, !!p.depthOfField);
    }
  }
  async openPhotoFromMenu() {
    await this.click('#menu [data-action="photo"]');
    await this.waitFor('photo studio', (d) => d.state === 'photo', 600000, 500);
    await sleep(6000);
  }
  async openPhotoFromPause() {
    await this.click('#modal [data-action="photo"]');
    await this.waitFor('photo studio', (d) => d.state === 'photo', 600000, 500);
    await sleep(6000);
  }

  // ---- Scenes: each returns { buffer, note } ----------------------------------------------------------
  /** The paddock showroom or the photo studio on the grid, driven from the menu. No race session. */
  async sceneMenuPhoto(shot, debugDir) {
    const [w, h] = shot.size ?? [1920, 1080];
    await this.setViewport(...this.scan);
    await this.setEntry(shot.entry);
    await sleep(3000);
    if (shot.photo) {
      await this.openPhotoFromMenu();
      await this.applyPhoto(shot.photo);
      await this.debugShot(debugDir, `${shot.id}-scan`);
      if (this.previewOnly) return this.previewFrame();
    } else {
      await this.waitFor(
        'menu preview',
        (d) => d.menuPreview?.completedRevision >= d.menuPreview?.requestedRevision,
        300000,
        500,
      ).catch(() => {});
    }
    await this.setViewport(w, h);
    await this.hideChrome(true);
    await sleep(shot.photo ? 14000 : 9000);
    const buffer = await this.encode([w, h]);
    await this.hideChrome(false);
    await this.setViewport(...this.scan);
    return { buffer, note: shot.photo ? 'photo studio from the menu' : 'menu showroom, chrome hidden' };
  }

  /** A session held on a moment; optionally re-framed in the photo studio. */
  async sceneSession(shot, debugDir) {
    const [w, h] = shot.size ?? [1920, 1080];
    await this.setViewport(...this.scan);
    await this.setEntry(shot.entry);
    await this.enterAndDrive(shot.id);
    if (shot.view) await this.setView(shot.view);
    const held = await this.parkOnMoment(shot);
    const car = held.presented?.car;
    let note = `held on ${shot.pick.scan ?? `t=${held.presented?.time?.toFixed(1)} s`}: speed ${car?.speed?.toFixed(1)} m/s, lean ${car?.lean?.toFixed(2)} rad, airborne ${car?.airborne}`;
    if (shot.photo) {
      await this.openPhotoFromPause();
      await this.applyPhoto(shot.photo);
      await this.debugShot(debugDir, `${shot.id}-scan`);
      if (this.previewOnly) return this.previewFrame();
      note += '; framed in the photo studio';
      await this.setViewport(w, h);
      await this.hideChrome(true);
      await sleep(14000);
    } else {
      const frames = held.presentationFrames ?? 0;
      await this.setViewport(w, h);
      await this.hideChrome(!shot.hud);
      await this.waitFor('redraw', (d) => (d.presentationFrames ?? 0) >= frames + 4, 1800000, 500);
      await sleep(4000);
    }
    const buffer = await this.encode([w, h]);
    await this.hideChrome(false);
    await this.setViewport(...this.scan);
    return { buffer, note };
  }

  /** A Wildcard event started from the board, then held like a session. */
  async sceneWildcard(shot, debugDir) {
    const [w, h] = shot.size ?? [1920, 1080];
    const page = this.page;
    await this.setViewport(...this.scan);
    await this.toMenu();
    await this.click('[data-action="career:wildcard"]');
    await page.waitForSelector('.wc-board');
    await page.locator(`.wc-row[data-id="${shot.event}"]`).click();
    await sleep(2000);
    await this.click(`[data-action="career:wildcardGo:${shot.event}"]`);
    const briefing = page.getByRole('button', { name: /GO STRAIGHT TO LIGHTS|GO TO THE GATE/ });
    const first = await Promise.race([
      briefing.waitFor({ state: 'visible', timeout: 1800000 }).then(() => 'briefing'),
      this.waitFor('driving', (d) => d.state === 'driving', 1800000, 500).then(() => 'driving'),
    ]);
    if (first === 'briefing') {
      await briefing.click();
      await this.waitFor('driving', (d) => d.state === 'driving', 1800000, 500);
    }
    this.log(`${shot.id}: wildcard event ${shot.event} driving`);
    if (shot.view) await this.setView(shot.view);
    const held = await this.parkOnMoment(shot);
    const car = held.presented?.car;
    let note = `wildcard ${shot.event}, held at t=${held.presented?.time?.toFixed(1)} s, speed ${car?.speed?.toFixed(1)} m/s`;
    if (shot.photo) {
      await this.openPhotoFromPause();
      await this.applyPhoto(shot.photo);
      await this.debugShot(debugDir, `${shot.id}-scan`);
      if (this.previewOnly) return this.previewFrame();
      note += '; framed in the photo studio';
      await this.setViewport(w, h);
      await this.hideChrome(true);
      await sleep(14000);
    } else {
      const frames = held.presentationFrames ?? 0;
      await this.setViewport(w, h);
      await this.hideChrome(!shot.hud);
      await this.waitFor('redraw', (d) => (d.presentationFrames ?? 0) >= frames + 4, 1800000, 500);
      await sleep(4000);
    }
    const buffer = await this.encode([w, h]);
    await this.hideChrome(false);
    await this.setViewport(...this.scan);
    return { buffer, note };
  }

  /** The festival: enter, travel to an event on the coast, open the festival photo mode, orbit, hide the UI. */
  async sceneFestivalCoast(shot, debugDir) {
    const [w, h] = shot.size ?? [1920, 1080];
    const page = this.page;
    const e = shot.entry ?? {};
    await this.setViewport(...this.scan);
    await this.toMenu();
    await page.locator('.lb-plate[data-discipline="festival"]').click();
    await sleep(2500);
    await page.locator('#weather').selectOption(e.weather ?? 'clear');
    await page.locator('#light').selectOption(e.light ?? 'day');
    if (e.vehicle) await page.locator('#vehicle').selectOption(e.vehicle);
    await sleep(800);
    await this.click('#menu button.enter.primary');
    await this.waitFor('festival', (d) => d.festival?.active === true, 1800000, 1000);
    await this.waitFor('festival mode', (d) => d.mode === 'festival', 1800000, 1000);
    this.log(`${shot.id}: festival running`);
    await sleep(8000);
    if (shot.event) {
      await page.keyboard.press('Escape');
      await sleep(2000);
      await this.click('[data-fest="map"]');
      await sleep(2500);
      await this.click(`[data-fest="mapSelect"][data-value="${shot.event}"]`);
      await sleep(1500);
      await this.debugShot(debugDir, `${shot.id}-map`);
      await this.click('[data-fest="travel"]');
      this.log(`${shot.id}: travelling to ${shot.event}`);
      await sleep(20000);
      // The travel may leave the map or the pause menu open: close whichever is still up.
      for (const selector of ['#festMap:not([hidden]) [data-fest="mapClose"]']) {
        if (await page.locator(selector).count()) await this.click(selector).catch(() => {});
      }
      await sleep(1500);
    }
    await this.debugShot(debugDir, `${shot.id}-arrived`);
    // Settle: let the car idle on the road for a moment so streaming and the light finish.
    await sleep(15000);
    // Photo mode is reached from the pause menu.
    const menuOpen = await page.locator('[data-fest="photo"]').count();
    if (!menuOpen) await page.keyboard.press('Escape');
    await sleep(1500);
    await this.click('[data-fest="photo"]');
    await sleep(3000);
    const steps = shot.orbit ?? 0;
    for (let i = 0; i < Math.abs(steps); i++) {
      await this.click(steps > 0 ? '[data-fest="photoRight"]' : '[data-fest="photoLeft"]');
      await sleep(600);
    }
    await this.click('[data-fest="photoHide"]').catch(() => {});
    await this.debugShot(debugDir, `${shot.id}-photo`);
    if (this.previewOnly) return this.previewFrame();
    await this.setViewport(w, h);
    await this.hideChrome(true);
    await sleep(20000);
    const buffer = await this.encode([w, h]);
    await this.hideChrome(false);
    await this.setViewport(...this.scan);
    return { buffer, note: `festival photo mode at ${shot.event ?? 'the spawn'}, orbit ${steps} steps` };
  }
}

export const SCENES = {
  'menu-photo': 'sceneMenuPhoto',
  session: 'sceneSession',
  wildcard: 'sceneWildcard',
  'festival-coast': 'sceneFestivalCoast',
};

/** The manifest of a capture folder: { version, shots: { id: entry } }. */
export function readManifest(path) {
  try {
    const m = JSON.parse(readFileSync(path, 'utf8'));
    if (m?.version === 1 && m.shots) return m;
  } catch {
    /* a new manifest */
  }
  return { version: 1, shots: {} };
}

/**
 * The resumable capture loop. `shots` is the table; a shot with `status: captured` in the manifest (and its
 * file present) is skipped unless `force` or named in `only`. A shot with `reuse` is never captured here.
 */
export async function runShots({ shots, out, url, only, force = false, budgetMinutes = 0, preset = 'high', scan, debug = false, preview = false, tool }) {
  mkdirSync(out, { recursive: true });
  const manifestPath = join(out, 'manifest.json');
  const manifest = readManifest(manifestPath);
  const t0 = Date.now();
  const log = (message) => {
    const line = `[${new Date().toISOString().slice(11, 19)} +${((Date.now() - t0) / 1000).toFixed(0)}s] ${message}`;
    console.log(line);
    appendFileSync(join(out, 'progress.log'), line + '\n');
  };
  const save = () => {
    manifest.updated = new Date().toISOString();
    manifest.generatedBy = tool;
    const ordered = {};
    for (const shot of shots) if (manifest.shots[shot.id]) ordered[shot.id] = manifest.shots[shot.id];
    for (const [id, entry] of Object.entries(manifest.shots)) ordered[id] ??= entry;
    manifest.shots = ordered;
    writeFileSync(manifestPath, JSON.stringify(manifest, null, 2) + '\n');
  };
  const record = (shot, patch) => {
    manifest.shots[shot.id] = {
      ...(manifest.shots[shot.id] ?? {}),
      id: shot.id,
      title: shot.title,
      alt: shot.alt,
      kind: shot.kind,
      size: (shot.size ?? [1920, 1080]).join('x'),
      entry: shot.entry ?? null,
      pick: shot.pick ?? null,
      photo: shot.photo ?? null,
      ...patch,
    };
    save();
  };
  const fileOf = (shot) => join(out, `${shot.id}.jpg`);
  const done = (shot) => manifest.shots[shot.id]?.status === 'captured' && existsSync(fileOf(shot));
  const wanted = only ? new Set(only) : null;
  const todo = shots.filter((s) => (wanted ? wanted.has(s.id) : force || preview || !done(s)));
  if (!todo.length) {
    log('nothing to do: every shot is captured (use --only / --force to retake)');
    return { ok: 0, failed: 0 };
  }
  const deadline = budgetMinutes > 0 ? t0 + budgetMinutes * 60000 : Infinity;
  const director = new Director({ url, log, scan, preset });
  director.previewOnly = preview;
  const debugDir = debug ? join(out, '_debug') : null;
  log(`${tool}: ${todo.map((s) => s.id).join(', ')} -> ${out} (${preset})`);
  let ok = 0;
  let failed = 0;
  for (const shot of todo) {
    if (Date.now() > deadline) {
      log('budget reached: stopping between shots (rerun to resume)');
      break;
    }
    const started = Date.now();
    try {
      if (!director.browser) await director.boot();
      const scene = SCENES[shot.kind];
      if (!scene) throw new Error(`unknown kind ${shot.kind}`);
      const { buffer, note, preview: wasPreview } = await director[scene](shot, debugDir);
      if (wasPreview) {
        mkdirSync(join(out, '_preview'), { recursive: true });
        writeFileSync(join(out, '_preview', `${shot.id}.jpg`), buffer);
        log(`preview ${shot.id}: ${(buffer.length / 1024).toFixed(0)} KB`);
        ok++;
        continue;
      }
      writeFileSync(fileOf(shot), buffer);
      record(shot, {
        status: 'captured',
        file: `${shot.id}.jpg`,
        bytes: buffer.length,
        quality: director.quality,
        takenAt: new Date().toISOString(),
        build: director.build,
        renderer: 'headless Chromium, software GL (SwiftShader); not a GPU capture',
        preset,
        note,
      });
      log(`captured ${shot.id}: ${(buffer.length / 1024).toFixed(0)} KB. ${note}`);
      ok++;
    } catch (error) {
      failed++;
      const message = String(error?.stack ?? error).split('\n').slice(0, 3).join(' | ');
      log(`FAILED ${shot.id}: ${message}`);
      record(shot, { status: 'failed', note: String(error?.message ?? error).split('\n')[0].slice(0, 240) });
      await director.close();
    }
    log(`${shot.id} took ${((Date.now() - started) / 60000).toFixed(1)} min`);
  }
  writeFileSync(join(out, 'console-errors.txt'), director.errors.join('\n') + (director.errors.length ? '\n' : ''));
  log(`done: ${ok} captured, ${failed} failed, ${director.errors.length} page/console errors`);
  await director.close();
  return { ok, failed };
}
