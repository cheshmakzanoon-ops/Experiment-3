import { tx } from './index.ts';

/** Words that belong to data tables with stable ids. The dictionaries key them by id
 * (`wildcard.<id>.title`), so rewording the English source never orphans a translation and
 * a translator sees which event a line belongs to. The English comes from the table itself. */
export const wildcardTitle = (entry: { id: string; title: string }) =>
  tx(`wildcard.${entry.id}.title`, entry.title);
export const wildcardPitch = (entry: { id: string; pitch: string }) =>
  tx(`wildcard.${entry.id}.pitch`, entry.pitch);
export const achievementName = (def: { id: string; name: string }) =>
  tx(`achievement.${def.id}.name`, def.name);
export const achievementDescription = (def: { id: string; description: string }) =>
  tx(`achievement.${def.id}.description`, def.description);
export const machineCharacterLine = (id: string, english: string) =>
  tx(`machine.${id}`, english);
