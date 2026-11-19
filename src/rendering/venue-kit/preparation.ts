import type { Track } from '../../simulation/track.ts';
import { BuildQueue, type BuildProgress } from '../build-queue.ts';
import { prepareVenueField, venueFieldPreparationSteps, venueFieldReady } from './plan.ts';

/** Prepare the catalogue's shared terrain dependency before scene constructors
 * request it synchronously. Use the ordinary construction scheduler so several
 * small raster batches share a frame, rather than adding a frame per segment. */
export async function prepareVenueGround(
  track: Track,
  progress: (value: BuildProgress) => void,
  cancelled: () => boolean,
) {
  if (cancelled()) return false;
  if (!track.circuit.catalogue || venueFieldReady(track)) return true;
  const queue = new BuildQueue(),
    preparation = prepareVenueField(track);
  let done = false;
  // The last iterator advance returns the completed owner after its final
  // yielded raster batch. A shared/synchronous consumer can finish it sooner.
  for (let i = 0; i <= venueFieldPreparationSteps(track); i++)
    queue.add('Preparing venue ground', 0, () => {
      if (!done) done = preparation.next().done === true;
    });
  try {
    const complete = await queue.run(progress, cancelled);
    if (complete && !done) throw new Error('Venue field preparation did not finish');
    return complete;
  } finally {
    // Closing a suspended iterator releases this waiter. Other concurrent
    // preparations and completed cached fields retain their own lifetime.
    preparation.return(undefined as never);
  }
}
