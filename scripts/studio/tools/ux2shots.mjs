// Real-game UX screenshots for the wave-2 front-end work (menu per discipline, the Wildcard
// board, loading, briefing, HUD, pause) in ONE browser boot (software GL boots in ~1-2 min).
// Usage: node ux2shots.mjs URL OUTDIR PREFIX --scenes menu-circuit,menu-festival,race
// Scenes run in the order given; `race` and `wildcard-race` start a session, so put them last.
//   menu-circuit | menu-gp | menu-dirt | menu-festival   plate click, then a 1280x720 shot
//   light            pick SUNSET on the LIGHT dial (after only) and shoot the menu
//   board            open the Wildcard board, shoot it, select another event, shoot again (after only)
//   loading          ENTER CIRCUIT and shoot the loading screen only
//   race             ENTER CIRCUIT: loading, briefing, HUD (driving) and pause shots
//   wildcard-race    start the selected Wildcard event from its board: loading, HUD
// Output: OUTDIR/PREFIX-<scene>-1280x720.jpg, JPEG, shrunk until it is at most 190 KB.
import { chromium } from 'playwright';
import { mkdirSync, statSync, writeFileSync } from 'node:fs';
const [url, out, prefix, ...rest] = process.argv.slice(2);
const scenes = (
  rest.includes('--scenes') ? rest[rest.indexOf('--scenes') + 1] : 'menu-circuit'
).split(',');
const eventId = rest.includes('--event') ? rest[rest.indexOf('--event') + 1] : null;
mkdirSync(out, { recursive: true });
const browser = await chromium.launch({
  headless: true,
  executablePath: '/opt/pw-browsers/chromium',
  args: [
    '--use-gl=angle',
    '--use-angle=swiftshader',
    '--enable-unsafe-swiftshader',
    '--ignore-gpu-blocklist',
    '--no-sandbox',
    '--headless=new',
  ],
});
const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
page.setDefaultTimeout(600000);
const errors = [];
page.on('pageerror', (e) => errors.push('page: ' + e.message));
page.on('console', (m) => m.type() === 'error' && errors.push('console: ' + m.text()));
await page.goto(url);
await page.waitForFunction(
  () => document.querySelector('#menu') && !document.querySelector('#menu').hidden,
  null,
  { timeout: 400000 },
);
await page.waitForTimeout(6000);
const log = [];
const shot = async (scene) => {
  const path = `${out}/${prefix}-${scene}-1280x720.jpg`;
  for (const quality of [72, 62, 52, 42, 34]) {
    const buffer = await page.screenshot({ type: 'jpeg', quality, timeout: 300000 });
    writeFileSync(path, buffer);
    if (statSync(path).size <= 190 * 1024) break;
  }
  log.push(`${path} ${(statSync(path).size / 1024).toFixed(0)} KB`);
};
const plate = async (discipline) => {
  await page.locator(`.lb-plate[data-discipline="${discipline}"]`).click();
  await page.waitForTimeout(5000);
};
const waitDriving = () =>
  page.waitForFunction(() => document.querySelector('#app')?.dataset.mode === 'driving');
async function race(label, start) {
  await start();
  await page.waitForFunction(() => !document.querySelector('#loading')?.hidden);
  await page.waitForTimeout(2500);
  await shot(`${label}-loading`);
  const briefing = page.getByRole('button', { name: /GO STRAIGHT TO LIGHTS|GO TO THE GATE/ });
  const first = await Promise.race([
    briefing.waitFor({ state: 'visible' }).then(() => 'briefing'),
    waitDriving().then(() => 'driving'),
  ]);
  if (first === 'briefing') {
    await page.waitForTimeout(1500);
    await shot(`${label}-briefing`);
    await briefing.click();
    await waitDriving();
  }
  await page.waitForTimeout(9000);
  await shot(`${label}-hud`);
  await page.locator('.hud-top [data-action="pause"]').click();
  await page.waitForTimeout(3000);
  await shot(`${label}-pause`);
}
for (const scene of scenes) {
  if (scene.startsWith('menu-')) {
    await plate(scene.slice(5));
    await shot(scene);
  } else if (scene === 'light') {
    await plate('circuit');
    await page.locator('#light').selectOption('sunset');
    await page.waitForTimeout(1500);
    await shot('light');
  } else if (scene === 'board') {
    await page.locator('[data-action="career:wildcard"]').first().click();
    await page.waitForSelector('.wc-board');
    await page.waitForTimeout(1500);
    await shot('board');
    const target = eventId ?? 'karts-after-dark';
    await page.locator(`.wc-row[data-id="${target}"]`).click();
    await page.waitForTimeout(1200);
    await shot('board-selected');
  } else if (scene === 'loading') {
    // Just the loading screen of the current entry, then stop (a race takes minutes on SwiftShader).
    await page.getByRole('button', { name: 'ENTER CIRCUIT', exact: true }).click();
    await page.waitForFunction(() => !document.querySelector('#loading')?.hidden);
    await page.waitForTimeout(2500);
    await shot('loading');
  } else if (scene === 'race') {
    await race('race', () =>
      page.getByRole('button', { name: 'ENTER CIRCUIT', exact: true }).click(),
    );
  } else if (scene === 'wildcard-race') {
    await race('wildcard', async () => {
      if (!(await page.locator('.wc-board').count()))
        await page.locator('[data-action="career:wildcard"]').first().click();
      await page.waitForSelector('.wc-board');
      const target = eventId ?? 'karts-after-dark';
      await page.locator(`.wc-row[data-id="${target}"]`).click();
      await page.locator(`[data-action="career:wildcardGo:${target}"]:visible`).click();
    });
  }
}
console.log(log.join('\n'));
console.log(JSON.stringify({ errors }));
await browser.close();
