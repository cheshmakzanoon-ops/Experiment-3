import type { PhotoSettings } from '../rendering/photo-camera.ts';
import type { HubPage } from './team-hub.ts';
import type { ReferenceEntry } from './reference-catalogue.ts';
export interface ReferenceRoute {
  destination: 'photo' | 'academy' | 'settings' | 'team' | 'controls';
  label: string;
  instruction: string;
  photo?: Partial<PhotoSettings>;
  hub?: HubPage;
  night?: boolean;
}
/** Each numbered source opens an actual existing workspace or a scene view.
 * A route is discoverability, NOT certification that the whole image is reproduced. */
export function referenceRoute(entry: ReferenceEntry): ReferenceRoute | null {
  const id = entry.id;
  if (entry.status === 'excluded') return null;
  if ([48, 49, 93].includes(id))
    return {
      destination: 'settings',
      label: 'OPEN DEVICE CALIBRATION',
      instruction:
        'Connect a supported device and use input calibration. Product photographs are not game assets; those physical peripherals were not tested here.',
    };
  if (id === 40)
    return {
      destination: 'settings',
      label: 'INSPECT ACCESSIBILITY SETTINGS',
      instruction:
        'Existing colour-accessible presentation, contrast, device calibration and bindings are available here. The reference audio-driving cue system is still a documented gap.',
    };
  if (id === 47)
    return {
      destination: 'photo',
      label: 'INSPECT GRID PREPARATION',
      photo: { backdrop: 'circuit', distance: 11, elevation: 22, azimuth: 48 },
      instruction:
        'Grid blankets and staff are visible only at preparation time. The menu preview shows that initial state; a live-session photo preserves its real phase rather than inventing a grid.',
    };
  if ([34, 37, 69, 70, 72, 74, 85, 89, 97].includes(id))
    return {
      destination: 'academy',
      label: 'OPEN DRIVING ACADEMY',
      instruction:
        'Enable the advisory guide, start a measured five-attempt programme, or review its actual lap results. Scripted story chapters and online leaderboards remain unimplemented.',
    };
  if ([25, 39, 79, 80, 87].includes(id))
    return {
      destination: 'academy',
      label: 'INSPECT NIGHT LIGHTING',
      night: true,
      instruction:
        'Night presentation enabled. Resume or enter the circuit to see floodlights; the original LED landmark is near 13% of the Aurel lap, not a recreated licensed venue.',
    };
  if ([11, 12, 13, 14, 15, 16, 17, 18, 19, 20, 23, 35, 38, 43, 81, 86].includes(id))
    return {
      destination: 'team',
      label: 'OPEN TEAM WORKSPACE',
      hub: [12].includes(id)
        ? 'engineering'
        : [13, 14, 17, 19, 23].includes(id)
          ? 'personnel'
          : id === 15
            ? 'finance'
            : 'overview',
      instruction:
        'Inspect the native team economy, research, contracts and calendar. This workspace does not claim the photographed architecture, real-person likenesses or narrative cinematics.',
    };
  if ([4, 71, 92, 94, 95].includes(id))
    return {
      destination: 'controls',
      label: 'OPEN RACE / PIT CONTROLS',
      instruction:
        'Use a real session for grid launch, cockpit mirrors and pit service. Request a stop using the mapped PIT action; crew animation follows actual service state.',
    };
  const photo: Partial<PhotoSettings> = [5, 26, 31, 33, 91, 99].includes(id)
    ? { backdrop: 'studio', azimuth: 60, elevation: 12, distance: 10, focalLength: 48 }
    : [1, 6, 45, 46, 76, 83].includes(id)
      ? { backdrop: 'circuit', azimuth: 42, elevation: 65, distance: 20, focalLength: 42 }
      : [3, 9, 30, 73, 88, 96].includes(id)
        ? { backdrop: 'circuit', azimuth: -35, elevation: 32, distance: 3.6, focalLength: 38 }
        : [7, 10, 29, 44, 68, 78, 82, 98].includes(id)
          ? { backdrop: 'circuit', azimuth: 145, elevation: 12, distance: 10, focalLength: 42 }
          : { backdrop: 'circuit', azimuth: 38, elevation: 12, distance: 8.5, focalLength: 38 };
  return {
    destination: 'photo',
    label: photo.backdrop === 'studio' ? 'OPEN 3D SHOWROOM' : 'INSPECT NATIVE 3D SCENE',
    photo,
    instruction: [10, 68, 82].includes(id)
      ? 'This opens the current frozen scene. Start a Heavy rain session first to inspect actual wet tyres, spray and reflections; opening a reference does not fabricate weather.'
      : 'Current scene paused at a reference-oriented camera angle. Resume driving for wheel motion, live cockpit instruments and traffic; still-image fidelity remains separately qualified.',
  };
}
