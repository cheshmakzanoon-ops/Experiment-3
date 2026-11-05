import { mergeConfig } from 'vite';
import base from '../../vite.config.ts';
// Captures run for many minutes: never let a source edit hot-reload the page under test.
export default mergeConfig(base, { server: { hmr: false } });
