import { it } from 'vitest';
import {
  arrayUniformProofNames,
  runArrayUniformProof,
} from './helpers/native-array-uniform-proof.mjs';

it.each(arrayUniformProofNames)('%s', async (name) => {
  const result = await runArrayUniformProof(name);
  console.log('APEX_NATIVE_ARRAY_UNIFORM_PROOF ' + JSON.stringify(result));
});
