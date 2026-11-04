// In-page design audits for the front end, injected as a script (ux4dom.mjs and e2e/64-design-critic).
// Sets `window.ux4Audit = { audit(), focus(padMode) }`.
//
// audit(): for every visible piece of text on screen, its size as the player sees it (the declared
//   size times any `transform: scale` it sits under, which is how the race HUD scales its panels) and,
//   where the background is known, its WCAG contrast ratio. Returns { texts, judged, small, low, unknown }:
//   `small` is text under 11 px, `low` is text under 4.5:1 (3:1 for large: 24 px, or 18.66 px bold).
//   Text over the 3D scene or a gradient has no known background and is counted in `unknown`, not judged.
//   Disabled controls and dimmed-by-design rows ([data-na]) are exempt, as WCAG exempts inactive UI.
// focus(padMode): every visible interactive element is focused in turn and must show a ring (a real
//   outline, or the browser's own `auto` ring), under the keyboard and, with `#app[data-pad]`, the pad.
(() => {
  const canvas = document.createElement('canvas');
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  const rgba = (css) => {
    const m = /^rgba?\(([^)]+)\)$/.exec(css.trim());
    if (m) {
      const p = m[1].split(/[ ,/]+/).filter(Boolean).map(Number);
      return [p[0], p[1], p[2], p[3] ?? 1];
    }
    ctx.clearRect(0, 0, 1, 1);
    ctx.fillStyle = '#000';
    ctx.fillStyle = css;
    ctx.fillRect(0, 0, 1, 1);
    const d = ctx.getImageData(0, 0, 1, 1).data;
    return [d[0], d[1], d[2], d[3] / 255];
  };
  const over = (top, under) => {
    const a = top[3] + under[3] * (1 - top[3]);
    if (a === 0) return [0, 0, 0, 0];
    return [0, 1, 2].map((i) => (top[i] * top[3] + under[i] * under[3] * (1 - top[3])) / a).concat(a);
  };
  const lum = ([r, g, b]) => {
    const f = (v) => ((v /= 255) <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4);
    return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b);
  };
  const ratio = (a, b) => {
    const [x, y] = [lum(a), lum(b)].sort((p, q) => q - p);
    return (x + 0.05) / (y + 0.05);
  };
  /** The colour behind an element's text: its ancestors' backgrounds composited, or null (scene/gradient). */
  const backdrop = (el) => {
    const layers = [];
    for (let node = el; node && node.nodeType === 1; node = node.parentElement) {
      const cs = getComputedStyle(node);
      if (cs.backgroundImage !== 'none') return null;
      const c = rgba(cs.backgroundColor);
      if (c[3] > 0) layers.push(c);
      if (c[3] >= 0.999) break;
    }
    if (!layers.length || layers[layers.length - 1][3] < 0.999) return null;
    return layers.reduceRight((under, top) => over(top, under));
  };
  const opacityOf = (el) => {
    let o = 1;
    for (let n = el; n && n.nodeType === 1; n = n.parentElement) o *= Number(getComputedStyle(n).opacity);
    return o;
  };
  const scaleOf = (el) => {
    let scale = 1;
    for (let n = el; n && n.nodeType === 1; n = n.parentElement) {
      const m = /^matrix\(([^)]+)\)$/.exec(getComputedStyle(n).transform);
      if (m) {
        const [a, b] = m[1].split(',').map(Number);
        scale *= Math.hypot(a, b);
      }
    }
    return scale;
  };
  const label = (el) =>
    `${el.tagName.toLowerCase()}${el.id ? `#${el.id}` : ''}${
      typeof el.className === 'string' && el.className
        ? `.${el.className.trim().split(/\s+/).slice(0, 2).join('.')}`
        : ''
    }`;

  const audit = () => {
    const small = [],
      low = [];
    let unknown = 0,
      judged = 0,
      texts = 0;
    for (const el of document.querySelectorAll('body *')) {
      if (
        el instanceof SVGElement ||
        el.closest('svg') ||
        ['SCRIPT', 'STYLE', 'OPTION', 'OPTGROUP'].includes(el.tagName)
      )
        continue;
      const own = [...el.childNodes].some((n) => n.nodeType === Node.TEXT_NODE && n.textContent.trim());
      if (!own || !el.getClientRects().length) continue;
      const cs = getComputedStyle(el);
      if (cs.visibility === 'hidden' || cs.display === 'none') continue;
      // A font size of 0 draws no text: the race HUD's icon badge (the ERS mode ring) and the label a ::after
      // replaces (BATT) use it. Text a pseudo-element draws is measured by hud-legibility.page.js.
      if (parseFloat(cs.fontSize) === 0) continue;
      const rect = el.getBoundingClientRect();
      if (rect.width < 1 || rect.height < 1 || el.closest('dialog:not([open])')) continue;
      const fg = rgba(cs.color);
      const alpha = fg[3] * opacityOf(el);
      if (alpha < 0.05) continue; // not on screen
      texts++;
      const size = Math.round(parseFloat(cs.fontSize) * scaleOf(el) * 100) / 100;
      const text = el.textContent.trim().replace(/\s+/g, ' ').slice(0, 40);
      if (size < 11) small.push({ name: label(el), text, size, hud: !!el.closest('#hud') });
      const bg = backdrop(el);
      if (!bg) {
        unknown++;
        continue;
      }
      const eff = over([fg[0], fg[1], fg[2], alpha], bg);
      const r = ratio(eff, bg);
      const large = size >= 24 || (size >= 18.66 && Number(cs.fontWeight) >= 700);
      judged++;
      const exempt = el.closest('[disabled],[data-na],[aria-disabled="true"]');
      if (!exempt && r < (large ? 3 : 4.5))
        low.push({
          name: label(el),
          text,
          ratio: Math.round(r * 100) / 100,
          size,
          large,
          fg: cs.color,
          bg: `rgb(${bg.slice(0, 3).map(Math.round)})`,
        });
    }
    return { texts, judged, small, low, unknown };
  };

  const focus = (padMode) => {
    const app = document.getElementById('app');
    if (padMode) app.setAttribute('data-pad', '');
    else app.removeAttribute('data-pad');
    const visible = (el) => {
      const r = el.getBoundingClientRect();
      const cs = getComputedStyle(el);
      return r.width > 0 && r.height > 0 && cs.visibility !== 'hidden' && cs.display !== 'none';
    };
    const items = [
      ...document.querySelectorAll(
        'button, a[href], input, select, textarea, summary, [tabindex]:not([tabindex="-1"])',
      ),
    ].filter(
      (el) => !el.disabled && visible(el) && !el.closest('dialog:not([open])') && !el.closest('[hidden]'),
    );
    const failures = [];
    let checked = 0;
    for (const el of items) {
      el.focus({ preventScroll: true });
      if (document.activeElement !== el) continue; // not focusable in this state
      const cs = getComputedStyle(el);
      const outlined =
        cs.outlineStyle !== 'none' &&
        parseFloat(cs.outlineWidth) >= 1 &&
        !/rgba\([^)]*,\s*0\)$/.test(cs.outlineColor);
      checked++;
      if (!(outlined || cs.outlineStyle === 'auto'))
        failures.push({
          el: label(el),
          text: (el.textContent || el.getAttribute('aria-label') || el.value || '')
            .trim()
            .replace(/\s+/g, ' ')
            .slice(0, 28),
          outline: `${cs.outlineStyle} ${cs.outlineWidth} ${cs.outlineColor}`,
        });
      el.blur();
    }
    app.removeAttribute('data-pad');
    return { checked, failures };
  };
  window.ux4Audit = { audit, focus };
})();
