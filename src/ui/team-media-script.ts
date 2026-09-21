import { driverProfile, weeklyBudget, RESEARCH, type TeamState } from '../storage/team-career.ts';
export interface MediaLine {
  start: number;
  duration: number;
  speaker: 'host' | 'driver';
  text: string;
  shot: 'wide' | 'driver' | 'host';
}
/** Original scripted presentation of the actual local save. This is not a real
 * recorded interview, a branching career story or a fabricated race result. */
export function teamMediaScript(team: TeamState): readonly MediaLine[] {
  const driver = driverProfile(team),
    budget = weeklyBudget(team);
  const project = team.research.find((p) => p.remaining > 0);
  return [
    {
      start: 0,
      duration: 6,
      speaker: 'host',
      shot: 'wide',
      text: `Inside ${team.livery.sponsor}. Week ${team.week}: ${driver.name} joins us in the workshop.`,
    },
    { start: 6, duration: 9, speaker: 'driver', shot: 'driver', text: team.briefing.slice(0, 240) },
    {
      start: 15,
      duration: 7,
      speaker: 'host',
      shot: 'host',
      text: `The team has ${team.points} local rivalry points after ${team.rounds} classified rounds. What is the engineering focus?`,
    },
    {
      start: 22,
      duration: 9,
      speaker: 'driver',
      shot: 'driver',
      text: project
        ? `${RESEARCH.find((p) => p.id === project.id)!.name}: ${project.remaining} research weeks remain. We will evaluate the resulting setup on the circuit.`
        : 'There is no active research study. The next useful step is to compare repeatable laps and decide which setup trade-off to investigate.',
    },
    {
      start: 31,
      duration: 9,
      speaker: 'host',
      shot: 'wide',
      text: `At current staffing, the weekly budget projection is ${budget.net < 0 ? 'a deficit' : 'a surplus'} of ${Math.abs(budget.net).toLocaleString('en')} credits. That is a forecast, not a booked transaction.`,
    },
    {
      start: 40,
      duration: 7,
      speaker: 'driver',
      shot: 'driver',
      text: 'Keep the feedback specific. The lap, tyre behaviour and telemetry should explain the next change—not just the finishing position.',
    },
  ];
}
export const MEDIA_DURATION = 47;
export function mediaAt(lines: readonly MediaLine[], time: number) {
  if (!Number.isFinite(time)) throw new Error('Invalid media timeline');
  return (
    lines.find((l) => time >= l.start && time < l.start + l.duration) ??
    lines[time < 0 ? 0 : lines.length - 1]
  );
}
