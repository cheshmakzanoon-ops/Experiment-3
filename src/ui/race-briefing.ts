import { fixed, ta, th } from '../i18n/index.ts';
import { N_ } from '../i18n/mark.ts';
import { F, H, carBase } from '../simulation/protocol.ts';
import type { SessionOptions } from '../simulation/config.ts';
import { circuitDefinition } from '../simulation/circuits.ts';
import { COMPOUNDS } from '../simulation/config.ts';
import { weatherReadout } from './presentation.ts';
import { circuitTitle } from './interface.ts';
import { motocrossKind, motocrossVenueCard } from './motocross-presentation.ts';
import { O, OFFROAD_BASE } from '../simulation/protocol.ts';

const COMPOUND_WORDS: Readonly<Record<string, string>> = {
  soft: N_('SOFT'),
  medium: N_('MEDIUM'),
  hard: N_('HARD'),
  intermediate: N_('INTERMEDIATE'),
  wet: N_('WET'),
};
export function raceBriefing(options: SessionOptions, frame: Float32Array) {
  const o = carBase(0);
  if (frame[H.TICK] !== 0) throw new Error('Race briefing requires the initialized grid');
  const circuit = circuitDefinition(options.circuit);
  const motocross = motocrossKind(options.circuit);
  const compound = Object.keys(COMPOUNDS)[Math.round(frame[o + F.COMPOUND])] ?? options.compound;
  if (motocross) {
    return `<section id="raceBriefing" class="mx-briefing" aria-label="${ta('Motocross race briefing')}"><span class="eyebrow">${th('DIRT SERIES')} / ${motocross === 'supercross' ? th('SUPERCROSS') : th('MOTOCROSS')}</span><h2>${circuitTitle(circuit.id)}</h2><p>${th('Choose your line into turn one. The race begins at the gate drop.')}</p>${motocrossVenueCard(circuit.id)}<dl class="race-briefing-grid"><div><dt>${th('YOUR GATE')}</dt><dd>${Math.max(1, Math.round(frame[o + OFFROAD_BASE + O.SLOT]))}<small> / ${th('{n} RIDERS', { n: frame[H.CARS] })}</small></dd></div><div><dt>${th('RACE DISTANCE')}</dt><dd>${options.laps}<small> ${th('LAPS')}</small></dd></div><div><dt>${th('RIDE MODE')}</dt><dd>${options.assist === 'raw' ? th('FULL CONTROL') : th('ASSISTED')}</dd></div><div><dt>${th('SURFACE')}</dt><dd>${motocross === 'supercross' ? th('PREPARED CLAY') : th('HILLSIDE LOAM')}</dd></div></dl><p class="mx-technique">${th('Brake before the jump face. Throttle lifts the nose in flight; brake lowers it. Aim to meet the downslope with both wheels aligned.')}</p><div class="dialog-buttons"><button class="primary" data-action="raceDayPrepare">${th('WATCH GATE PREPARATION')}</button><button data-action="raceDaySkip">${th('GO TO THE GATE')}</button><button data-action="menu">${th('BACK TO PADDOCK')}</button></div><label class="check"><input id="raceDayQuickStart" type="checkbox">${th('Use Quick Start for future races')}</label></section>`;
  }
  // Circuit names are authored constants; all other values are numeric or validated enums.
  return `<section id="raceBriefing" aria-label="${ta('Race-day briefing')}">
    <span class="eyebrow">${th('RACE DAY')} / ${options.mode === 'endurance' ? th('ENDURANCE') : th('GRAND PRIX')}</span>
    <h2>${circuitTitle(circuit.id)}</h2><p>${th('The grid is formed. Lights out when you are ready.')}</p>
    <dl class="race-briefing-grid">
      <div><dt>${th('STARTING POSITION')}</dt><dd>P${options.grid ? options.grid.indexOf(0) + 1 : 1} <small>/ ${frame[H.CARS]}</small></dd></div>
      <div><dt>${th('RACE DISTANCE')}</dt><dd>${options.laps} <small>${th('LAPS')}</small></dd></div>
      <div><dt>${th('FITTED TYRES')}</dt><dd>${th(COMPOUND_WORDS[compound] ?? compound.toUpperCase())}</dd></div>
      <div><dt>${th('FUEL ON BOARD')}</dt><dd>${fixed(frame[o + F.FUEL], 1)} <small>${th('KG')}</small></dd></div>
    </dl>
    <p class="briefing-weather">${weatherReadout(frame[H.AMBIENT], frame[H.RAIN], frame[H.WATER], frame[H.EXTINCTION], frame[H.DUST], Math.hypot(frame[H.WIND_X], frame[H.WIND_Z]))}</p>
    <p class="small-note">${th('Your garage setup is fitted. To change tyres, weather or setup, return to the paddock.')}</p>
    <div class="dialog-buttons"><button class="primary" data-action="raceDayPrepare">${th('WATCH GRID PREPARATION')}</button><button data-action="raceDaySkip">${th('GO STRAIGHT TO LIGHTS')}</button><button data-action="menu">${th('BACK TO PADDOCK')}</button></div>
    <label class="check"><input id="raceDayQuickStart" type="checkbox">${th('Use Quick Start for future races')}</label>
  </section>`;
}
