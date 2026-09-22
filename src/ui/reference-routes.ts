import { referenceEvent } from '../rendering/reference-events.ts';
import type { PhotoSettings } from '../rendering/photo-camera.ts';
import type { HubPage } from './team-hub.ts';
import type { ReferenceEntry } from './reference-catalogue.ts';
export interface ReferenceRoute {
  destination: 'photo' | 'academy' | 'settings' | 'team' | 'controls' | 'event' | 'gap' | 'media';
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
  if ([20, 38, 43, 86].includes(id))
    return {
      destination: 'media',
      label: 'WATCH ORIGINAL TEAM BRIEFING',
      instruction:
        'Two original articulated people, directed cameras and timed captions present your real local team state. This is a scripted silent briefing, not a copied interview, a branching story campaign or approved human likeness fidelity.',
    };
  // Reference Review exposes actual race-event watches as a separate action.
  // Keep the primary inspect route stable so a new event witness never replaces
  // the established photo/settings/team workspace used for image comparison.
  if (id === 93) {
    const event = referenceEvent(id)!;
    return {
      destination: 'event',
      label: `WATCH REAL ${event.kind.toUpperCase()}`,
      instruction: event.instruction,
    };
  }
  if ([26, 70].includes(id))
    return {
      destination: 'settings',
      label: id === 26 ? 'OPEN ASSIST & CONTROL SETTINGS' : 'OPEN VEHICLE SETUP',
      instruction:
        'Inspect the actual saved assist, controller and next-session setup controls. A showroom photograph is not this interface.',
    };
  if (id === 69)
    return {
      destination: 'gap',
      label: 'INSPECT UNIMPLEMENTED ONLINE / REVERSE REQUIREMENT',
      instruction:
        'This reference requires online/friends records and a validated reverse circuit. The local practice programme is not either system. No matching implementation or acceptance is claimed.',
    };
  if (id === 33)
    return {
      destination: 'photo',
      label: 'INSPECT SAVED LIVERY ON CIRCUIT',
      photo: { backdrop: 'circuit', azimuth: 90, elevation: 9, distance: 8, focalLength: 55 },
      instruction:
        'The current car wears its actual livery on the existing circuit. Save, return to racing and reload to verify persistence; this route does not substitute a showroom.',
    };
  if ([48, 49].includes(id))
    return {
      destination: 'settings',
      label: 'OPEN DEVICE CALIBRATION',
      instruction:
        'Connect a supported device and use input calibration. Product photographs are not game assets; those physical peripherals were not tested here.',
    };
  if ([1, 46].includes(id))
    return {
      destination: 'photo',
      label: 'COMPARE GEOMETRY / RENDER',
      photo: {
        backdrop: 'circuit',
        survey: 'split',
        split: 0.5,
        azimuth: 42,
        elevation: 42,
        distance: 30,
        focalLength: 30,
      },
      instruction:
        'The left half samples the actual original circuit meshes into a bounded point cloud. The right half uses the same camera and rendered scene. This is NOT measured LiDAR, an imported scan, or a licensed circuit.',
    };
  if ([9, 21, 73, 91, 99, 100].includes(id))
    return {
      destination: 'photo',
      label: 'INSPECT DRIVER / HELMET DETAIL',
      photo: {
        backdrop: 'circuit',
        focusSubject: 1,
        azimuth: -32,
        elevation: 8,
        distance: 2.3,
        focalLength: 85,
      },
      instruction:
        'The camera orbits the actual articulated helmet and visor, not a distant car-centred orbit. This is an original driver detail, not a copied portrait or an accepted identity/title layout.',
    };
  if (id === 77)
    return {
      destination: 'photo',
      label: 'INSPECT FRONT WHEEL / AERO',
      photo: {
        backdrop: 'circuit',
        focusSubject: 3,
        azimuth: 35,
        elevation: 5,
        distance: 2.3,
        focalLength: 48,
      },
      instruction:
        'A dedicated low camera follows the real wheel/upright. Mechanical proportions and contact appearance still need visual comparison.',
    };
  if ([11, 16, 81, 86].includes(id))
    return {
      destination: 'photo',
      label: 'INSPECT ORIGINAL 3D HEADQUARTERS',
      photo: {
        backdrop: 'headquarters',
        focusSubject: id === 11 ? 6 : 0,
        azimuth: id === 11 ? -18 : 28,
        elevation: 17,
        distance: 17,
        focalLength: 30,
      },
      instruction:
        'Original inspectable workshop/atrium: glass elevation, mezzanine, stairs and rails, tool benches, lounge furniture, plants and overhead lighting. This is a procedural scene, not the licensed headquarters or an acted interview. Team HQ holds the working management controls.',
    };
  if (id === 40)
    return {
      destination: 'settings',
      label: 'INSPECT ACCESSIBILITY SETTINGS',
      instruction:
        'Find Audio driving cues: independently enable brake, stereo turn, gear, track-limit and wrong-way tones, adjust lookahead/volume and preview. Apply to persist. Only live human driving emits advice; this is not blind-driving certification.',
    };
  if (id === 47)
    return {
      destination: 'photo',
      label: 'INSPECT GRID PREPARATION',
      photo: { backdrop: 'circuit', distance: 11, elevation: 22, azimuth: 48 },
      instruction:
        'Grid blankets and staff are visible only at preparation time. The menu preview shows that initial state; a live-session photo preserves its real phase rather than inventing a grid.',
    };
  if ([34, 37, 72, 74, 89, 97].includes(id))
    return {
      destination: 'academy',
      label: 'OPEN DRIVING ACADEMY',
      instruction:
        'Enable the advisory guide, start a measured five-attempt programme, or review its actual lap results. Scripted story chapters and online leaderboards remain unimplemented.',
    };
  if ([25, 79, 80, 87].includes(id))
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
  if ([3, 27, 28, 30, 84, 88, 96].includes(id))
    return {
      destination: 'photo',
      label: 'INSPECT NATIVE COCKPIT',
      photo: { backdrop: 'circuit', view: 'cockpit' },
      instruction:
        'The actual driver-eye transform, steering display, hands and mirrors are retained. This held photograph does not create missing weather, traffic or HTML HUD evidence.',
    };
  if ([8, 67].includes(id))
    return {
      destination: 'photo',
      label: 'INSPECT NATIVE POD CAMERA',
      photo: { backdrop: 'circuit', view: 'pod' },
      instruction:
        'Uses the actual pod-camera transform and optics in the current scene, not an exterior orbit.',
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
