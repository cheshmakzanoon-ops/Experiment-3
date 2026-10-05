import { writeFile } from 'node:fs/promises';

/** Write the owned PNG before attaching it. Body-only Playwright attachments
 * stay in memory until reporting and are lost if that worker terminates. */
export async function saveSecondaryStandEvidence(
  path: string,
  body: Uint8Array,
  attach: (path: string) => Promise<void>,
): Promise<void> {
  await writeFile(path, body, { flag: 'wx' });
  await attach(path);
}
