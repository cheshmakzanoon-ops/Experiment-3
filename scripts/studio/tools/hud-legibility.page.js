// In-page HUD legibility measurement, injected as a script (hud-measure.mjs and e2e/65-hud-legibility).
// Sets `window.hudLegibility = { measure(root), layout(), TIERS, FLOOR, BLOCKS, SIGHT }`.
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
//   tertiary   non-essential microcopy (none needs it today: the HUD's smallest text is 11 px)    >= 10 px
//   decor      text that is not information: the MOTOBOUND wordmark                                exempt
//
// The pixel floors are the ones docs/studio/reports/hud-legibility.md sets for a 7-inch 1280x800 handheld
// (Steam Deck class): they are CSS px at the viewport the page is measured at.
//
// layout(): the HUD's panels that are on screen now, as rectangles, for the footprint checks: which ones
// overlap each other, which leave the window, which enter the sight window (the strip of road ahead), and
// which texts are wider than the box that draws them.
(() => {
  const FLOOR = { primary: 18, secondary: 11, tertiary: 10 };

  /** [selector, tier, why]. First match wins; anything unmatched is secondary (the strict default). */
  const TIERS = [
    // ---- decor: exempt (the whole list; nothing else is) ---------------------------------------------
    ['.f1-wordmark, .brand', 'decor', 'the MOTOBOUND wordmark: a logo, not information'],
    // ---- primary readouts: read at a glance while driving ---------------------------------------------
    ['#speed, #gear, #lapTime, #positionBadge, #festSpeed, #festGear', 'primary', 'speed, gear, lap time, position'],
    ['.f1-pos > span, .f1-tower-lap > b', 'primary', 'position and lap numerals'],
  ];

  /** [name, selector, extra selectors whose boxes are joined into the block]. A block counts when drawn. */
  const BLOCKS = [
    ['tower', '.timing', ['.tower-row > u']], // the fastest-lap tab sticks out of the row
    ['lap-panel', '.lap-panel', []],
    ['instruments', '.instruments', ['.f1-tyres']],
    ['notes', '.f1-notes', []],
    ['status-stack', '.mx-status-stack', []], // the dirt gate card and ride readout
    ['minimap', '.minimap canvas', []],
    ['dock', '.hud-top', []],
    ['banner', '.f1-banner:not([data-state="off"])', []],
    ['pit-lane', '.f1-pit:not([hidden])', []],
    ['vehicle-panel', '.car-status', []],
    ['start-lights', '#startSequence:not([hidden])', []],
    ['festival-road', '.fest-road', []],
    ['festival-explore', '.fest-explore', []],
    ['festival-hint', '.fest-hint', []],
    ['festival-map', '.fest-minimap', []],
    ['festival-speed', '.fest-speed', []],
  ];
  /** The sight window, as fractions of the viewport: the road ahead between the horizon and the bonnet.
   * Persistent HUD never enters it (the start lights sit in it by design and only until the lights go out). */
  const SIGHT = { x0: 0.38, x1: 0.62, y0: 0.4, y1: 0.6 };

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
  /** What the player sees times the declared size: every `transform: scale` above the element and every CSS
   * `zoom` (the open-world HUD's widgets scale with it; getComputedStyle reports the unzoomed font size). */
  const scaleOf = (el) => {
    let scale = 1;
    for (let n = el; n && n.nodeType === 1; n = n.parentElement) {
      const cs = getComputedStyle(n);
      const m = /^matrix\(([^)]+)\)$/.exec(cs.transform);
      if (m) {
        const [a, b] = m[1].split(',').map(Number);
        scale *= Math.hypot(a, b);
      }
      const zoom = parseFloat(cs.zoom);
      if (Number.isFinite(zoom) && zoom > 0) scale *= zoom;
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

  /** True when the element (or an ancestor) is not drawn: display none, visibility hidden, opacity ~0, a
   * 1 px clipped screen-reader node, or a font size of 0 (a label that a ::after replaces). */
  const drawn = (el) => {
    if (!el.getClientRects().length) return false;
    for (let n = el; n && n.nodeType === 1; n = n.parentElement) {
      const cs = getComputedStyle(n);
      if (cs.visibility === 'hidden' || cs.display === 'none') return false;
    }
    const r = el.getBoundingClientRect();
    return (
      r.width >= 2 && r.height >= 2 && opacityOf(el) >= 0.05 && parseFloat(getComputedStyle(el).fontSize) >= 0.5
    );
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

  /** Text that is wider than the box that draws it and is clipped there (overflow hidden / clip). */
  const clipped = () => {
    const out = [];
    for (const el of document.querySelectorAll('#hud *, .fest-hud *')) {
      if (el instanceof SVGElement || el.closest('svg') || !drawn(el)) continue;
      const own = [...el.childNodes].some((n) => n.nodeType === Node.TEXT_NODE && n.textContent.trim());
      if (!own) continue;
      const cs = getComputedStyle(el);
      if (cs.display === 'inline' || (cs.overflowX !== 'hidden' && cs.overflowX !== 'clip')) continue;
      if (cs.textOverflow === 'ellipsis') continue; // an ellipsis is a declared truncation
      if (el.scrollWidth > el.clientWidth + 1)
        out.push(`${label(el)} "${el.textContent.trim().slice(0, 30)}" ${el.scrollWidth} > ${el.clientWidth}`);
    }
    return out;
  };

  const layout = () => {
    const w = window.innerWidth,
      h = window.innerHeight;
    const blocks = [];
    for (const [name, selector, extra] of BLOCKS) {
      for (const el of document.querySelectorAll(selector)) {
        if (!el.getClientRects().length) continue;
        const own = el.getBoundingClientRect();
        if (own.width < 2 || own.height < 2) continue;
        const boxes = [own];
        for (const s of extra)
          for (const n of el.querySelectorAll(s)) {
            const r = n.getBoundingClientRect();
            if (n.getClientRects().length && r.width >= 2 && r.height >= 2) boxes.push(r);
          }
        blocks.push({
          name,
          rect: [
            round(Math.min(...boxes.map((b) => b.left))),
            round(Math.min(...boxes.map((b) => b.top))),
            round(Math.max(...boxes.map((b) => b.right))),
            round(Math.max(...boxes.map((b) => b.bottom))),
          ],
        });
      }
    }
    const overlaps = [];
    for (let i = 0; i < blocks.length; i++)
      for (let j = i + 1; j < blocks.length; j++) {
        const a = blocks[i].rect,
          c = blocks[j].rect;
        const dx = Math.min(a[2], c[2]) - Math.max(a[0], c[0]),
          dy = Math.min(a[3], c[3]) - Math.max(a[1], c[1]);
        if (dx > 0.5 && dy > 0.5)
          overlaps.push(`${blocks[i].name} x ${blocks[j].name} (${Math.round(dx)} x ${Math.round(dy)} px)`);
      }
    const outside = blocks
      .filter((k) => k.rect[0] < -0.5 || k.rect[1] < -0.5 || k.rect[2] > w + 0.5 || k.rect[3] > h + 0.5)
      .map((k) => `${k.name} [${k.rect.map(Math.round)}] in ${w}x${h}`);
    const sight = blocks
      .filter((k) => k.name !== 'start-lights')
      .filter((k) => {
        const [l, t, r, b] = k.rect;
        return l < SIGHT.x1 * w && r > SIGHT.x0 * w && t < SIGHT.y1 * h && b > SIGHT.y0 * h;
      })
      .map((k) => `${k.name} [${k.rect.map(Math.round)}] in the sight window`);
    return { viewport: [w, h], blocks, overlaps, outside, sight, clipped: clipped() };
  };

  window.hudLegibility = { measure, layout, TIERS, FLOOR, BLOCKS, SIGHT };
})();
