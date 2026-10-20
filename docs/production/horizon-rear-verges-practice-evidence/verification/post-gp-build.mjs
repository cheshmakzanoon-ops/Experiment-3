import config from '/workspace/scratch/b60b57e087a1/Experiment-3/vite.config.ts';
import { build } from '/workspace/scratch/b60b57e087a1/Experiment-3/node_modules/vite/dist/node/index.js';
await build({...config,configFile:false,cacheDir:'/dev/shm/horizon-b60-validation/build-cache',build:{...config.build,outDir:'/dev/shm/horizon-b60-validation/post-gp-dist',copyPublicDir:false}});
