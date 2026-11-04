// In-page HUD legibility measurement, injected as a script (hud-measure.mjs and e2e/65-hud-legibility).
// Sets `window.hudLegibility = { measure(root), FLOOR }`.
//
// measure(root): every piece of text the race HUD draws under `root` (default `#hud`, else `#app`): the
// element's own text nodes and the text a ::before / ::after draws with `content`. For each, the size
// as the player sees it in CSS px (the computed font size times every `transform: scale` above it),
// whether it is on screen right now, and its legibility tier. The tiers are data (TIERS below) so the
// report, the tool and the e2e guard all read the same table.
//
//   primary    speed, gear, position, lap, time: the numbers read at a glance while driving      >= 18 px
//   secondary  labels and captions a player reads on purpose (units, sector tags, tyre / fuel      >= 11 px
//              labels, pit and flag banners, proximity warnings, tower rows, button captions)
//   tertiary   non-essential microcopy (the second line of a card, a key legend, build tags)      >= 10 px
//   decor      text that is not information: drawn glyphs, ornaments, aria-hidden number scales    exempt
//
// The pixel floors are the ones docs/studio/reports/hud-legibility.md sets for a 7-inch 1280x800 handheld
// (Steam Deck class): they are CSS px at the viewport the page is measured at.
(() => {
  const FLOOR = { primary: 18, secondary: 11, tertiary: 10 };

  /** [selector, tier, why]. First match wins; anything unmatched is secondary (the strict default). */
  const TIERS = [
    // ---- decor: exempt (the whole list; nothing else is) ---------------------------------------------
    ['.f1-wordmark, .brand', 'decor', 'the MOTOBOUND wordmark: a logo, not information'],
    // ---- primary readouts: read at a glance while driving ---------------------------------------------
    ['#speed, #gear, #lapTime, #positionBadge, #festSpeed, #festGear', 'primary', 'speed, gear, lap time, position'],
    ['.f1-pos > span, .f1-tower-lap > b', 'primary', 'position and lap numerals'],
    // ---- tertiary: microcopy ---------------------------------------------------------------------------------
    ['.gp-tyres small, .gp-rider, .gp-practice > small', 'tertiary', 'GP panel microcopy: tyre life under the temperature, the rider-state row, practice notes'],
  ];

  const rgbaAlpha = (css) => {
    const m = /^rgba?\(([^)]+)\)$/.exec(css.trim());
    if (!m) return 1;
    const p = m[1].split(/[ ,/]+/).filter(Boolean).map(Number);
    return p[3] ?? 1;
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
  const tierOf = (el) => {
    for (const [selector, tier, why] of TIERS) if (el.matches(selector) || el.closest(selector)) return { tier, why };
    return { tier: 'secondary', why: 'default' };
  };
  const round = (v) => Math.round(v * 100) / 100;

  /** True when the element (or an ancestor) is not drawn: display none, visibility hidden, [hidden], opacity ~0. */
  const drawn = (el) => {
    if (!el.getClientRects().length) return false;
    for (let n = el; n && n.nodeType === 1; n = n.parentElement) {
      const cs = getComputedStyle(n);
      if (cs.visibility === 'hidden' || cs.display === 'none') return false;
    }
    const r = el.getBoundingClientRect();
    return r.width >= 2 && r.height >= 2 && opacityOf(el) >= 0.05 && parseFloat(getComputedStyle(el).fontSize) >= 0.5;
  };

  const measure = (root) => {
    root = root ?? document.getElementById('hud') ?? document.getElementById('app');
    const rows = [];
    for (const el of root.querySelectorAll('*')) {
      if (el instanceof SVGElement || el.closest('svg') || ['SCRIPT', 'STYLE', 'OPTION', 'OPTGROUP'].includes(el.tagName))
        continue;
      const own = [...el.childNodes].some((n) => n.nodeType === Node.TEXT_NODE && n.textContent.trim());
      const scale = scaleOf(el);
      const push = (pseudo, text, fontSize) => {
        const { tier, why } = tierOf(el);
        const r = el.getBoundingClientRect();
        rows.push({
          name: label(el) + (pseudo ?? ''),
          text: text.replace(/\s+/g, ' ').trim().slice(0, 40),
          px: round(parseFloat(fontSize) * scale),
          declared: round(parseFloat(fontSize)),
          scale: round(scale),
          tier,
          why,
          shown: drawn(el),
          rect: [Math.round(r.left), Math.round(r.top), Math.round(r.width), Math.round(r.height)],
        });
      };
      const cs = getComputedStyle(el);
      if (own) push(null, el.textContent, cs.fontSize);
      for (const pseudo of ['::before', '::after']) {
        const content = getComputedStyle(el, pseudo).content;
        // Only generated TEXT counts (content: "KPH" / attr()); a drawn glyph is a box, not type.
        if (!content || content === 'none' || content === 'normal' || /^(""|'')$/.test(content)) continue;
        const m = /^["'](.*)["']$/.exec(content);
        if (!m || !m[1].trim()) continue;
        const pcs = getComputedStyle(el, pseudo);
        if (pcs.display === 'none' || rgbaAlpha(pcs.color) < 0.05) continue;
        push(pseudo, m[1], pcs.fontSize);
      }
    }
    return rows;
  };

  window.hudLegibility = { measure, TIERS, FLOOR };
})();
