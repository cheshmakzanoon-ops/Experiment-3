/**
 * The front end's "speed tunnel" backdrop (D29 frontend-menus, AB-B §4.1):
 * near-black #07060a with red-magenta light streaks (#c8203c -> #ff4a6a)
 * converging on a vanishing point at (0.62, 0.45), a faint teal floor glow
 * (#1e5a5a) over the bottom 20 % and a soft 6 px blur.
 *
 * It is drawn by the compositor, not WebGL: a menu dialog covers the canvas
 * and the renderer holds its frame (presentation.menuCovered), so the
 * backdrop must cost no frames. The streak layout is a fixed hash, so every
 * machine paints the same pixels. Installed for dialogs opened from the
 * paddock menu only; the pause menu keeps the live, blurred race behind it.
 */
export const SPEED_TUNNEL = Object.freeze({
  base: '#07060a',
  streakFrom: '#c8203c',
  streakTo: '#ff4a6a',
  floor: '#1e5a5a',
  vanish: Object.freeze([62, 45] as const),
  streaks: 26,
  blurPx: 6,
});

function hash(i: number, salt: number) {
  let h = Math.imul(i + 1, 0x9e3779b1) ^ Math.imul(salt + 7, 0x85ebca6b);
  h = Math.imul(h ^ (h >>> 15), 0x2c1b3c6d);
  return ((h ^ (h >>> 13)) >>> 0) / 4294967296;
}
const hex = (value: string) => [1, 3, 5].map((i) => parseInt(value.slice(i, i + 2), 16));
const mix = (a: string, b: string, t: number, alpha: number) => {
  const [r, g, bl] = hex(a).map((v, i) => Math.round(v + (hex(b)[i] - v) * t));
  return `rgba(${r},${g},${bl},${alpha.toFixed(2)})`;
};

/** Angular streak stops (degrees from 12 o'clock) for the conic layer. */
export function speedTunnelStreaks() {
  const streaks: { at: number; width: number; colour: string }[] = [];
  for (let i = 0; i < SPEED_TUNNEL.streaks; i++) {
    // Mostly along the side walls (the tunnel's left and right), few on the floor/roof.
    const wall = hash(i, 1) < 0.5 ? 90 : 270;
    const at = wall + (hash(i, 2) - 0.5) * 120;
    const width = 0.35 + 1.1 * hash(i, 3);
    const colour = mix(
      SPEED_TUNNEL.streakFrom,
      SPEED_TUNNEL.streakTo,
      hash(i, 4),
      0.45 + 0.4 * hash(i, 5),
    );
    streaks.push({ at: ((at % 360) + 360) % 360, width, colour });
  }
  return streaks.sort((a, b) => a.at - b.at);
}

/** The CSS `background` of the backdrop (layers top to bottom). */
export function speedTunnelBackground() {
  const [vx, vy] = SPEED_TUNNEL.vanish;
  const stops: string[] = [];
  for (const { at, width, colour } of speedTunnelStreaks()) {
    const end = Math.min(359.9, at + width);
    stops.push(`transparent ${at.toFixed(2)}deg`, `${colour} ${at.toFixed(2)}deg`);
    stops.push(`${colour} ${end.toFixed(2)}deg`, `transparent ${end.toFixed(2)}deg`);
  }
  return [
    // The streaks fade out into the vanishing point and toward the frame edge.
    `radial-gradient(circle at ${vx}% ${vy}%, ${SPEED_TUNNEL.base} 0 4%, transparent 22%)`,
    `radial-gradient(ellipse at ${vx}% ${vy}%, transparent 45%, rgba(7,6,10,0.85) 100%)`,
    `linear-gradient(0deg, ${SPEED_TUNNEL.floor}73 0%, transparent 20%)`,
    `conic-gradient(from 0deg at ${vx}% ${vy}%, ${stops.join(', ')})`,
    SPEED_TUNNEL.base,
  ].join(', ');
}

export const SPEED_TUNNEL_STYLE_ID = 'speedTunnelBackdrop';
/** One stylesheet rule: dialogs opened from the paddock menu sit in the tunnel. */
export function installSpeedTunnel(doc: Document = document) {
  if (doc.getElementById(SPEED_TUNNEL_STYLE_ID)) return false;
  const style = doc.createElement('style');
  style.id = SPEED_TUNNEL_STYLE_ID;
  style.textContent = `[data-mode='menu'] dialog::backdrop {
  background: ${speedTunnelBackground()};
  backdrop-filter: none;
  filter: blur(${SPEED_TUNNEL.blurPx}px);
}`;
  doc.head.append(style);
  return true;
}
