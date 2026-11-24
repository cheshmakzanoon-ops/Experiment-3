import { announceNativeWorker } from './engine-worker-clock.ts';
import '../../src/workers/open-world.worker.ts';

announceNativeWorker('festival');
