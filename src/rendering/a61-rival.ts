import { loadHeroShells, type HeroShells } from './hero-shells.ts';
import near from './a61-rival-near.manifest.json' with { type: 'json' };
import mid from './a61-rival-mid.manifest.json' with { type: 'json' };
import far from './a61-rival-far.manifest.json' with { type: 'json' };

export type RivalLevels = readonly [HeroShells, HeroShells, HeroShells];
export const A61_MANIFESTS = [near, mid, far] as const;

/** Three separately checked exports of one native Blender assembly. No global
 * prototype cache: each renderer owns and disposes the three decoded assets. */
export async function loadRivalLevels(
  cancelled: () => boolean = () => false,
): Promise<RivalLevels> {
  const urls = [
    new URL('./a61-rival-near.glb.gz', import.meta.url).href,
    new URL('./a61-rival-mid.glb.gz', import.meta.url).href,
    new URL('./a61-rival-far.glb.gz', import.meta.url).href,
  ];
  const assets: HeroShells[] = [];
  try {
    for (let i = 0; i < urls.length; i++)
      assets.push(await loadHeroShells(cancelled, fetch, urls[i], A61_MANIFESTS[i]));
    return assets as unknown as RivalLevels;
  } catch (error) {
    assets.forEach((asset) => asset.dispose());
    throw error;
  }
}
