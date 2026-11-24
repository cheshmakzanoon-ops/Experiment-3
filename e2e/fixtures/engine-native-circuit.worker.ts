import { announceNativeWorker } from './engine-worker-clock.ts';
import '../../src/workers/physics.worker.ts';

announceNativeWorker('circuit');
