import type { BaseTexture } from '@babylonjs/core/Materials/Textures/baseTexture.js';

export type A07TextureRole = 'baseColor' | 'normal' | 'metallicRoughness';
/** Pinned Babylon getter is effective shader decode, not the source colour tag.
 * These cached fields do not query GL; call from the fixture's GPU-owned receipt. */
export function a07TextureGamma(texture: BaseTexture, role: A07TextureRole) {
  const gammaSpace = texture.gammaSpace;
  const internal = texture.getInternalTexture();
  return {
    role,
    gammaSpace,
    semanticGammaSpace: internal?._gammaSpace ?? null,
    hardwareSrgb: internal?._useSRGBBuffer ?? null,
  };
}
export function a07ProgramGamma(name: string, defines: string) {
  // Pinned PBR uses #ifdef/defined, so even a macro defined as 0 is present.
  const defined = (name: string) => new RegExp(`^\\s*#define\\s+${name}\\b`, 'm').test(defines);
  return {
    name,
    defines,
    gammaAlbedo: defined('GAMMAALBEDO'),
    reflectivityGamma: defined('REFLECTIVITY_GAMMA'),
  };
}
export function assertA07GammaTransport(
  textures: ReturnType<typeof a07TextureGamma>[],
  programs: ReturnType<typeof a07ProgramGamma>[],
) {
  if (!programs.length) throw new Error('A07 gamma receipt has no compiled programs');
  for (const role of ['baseColor', 'normal', 'metallicRoughness'] as const) {
    const matches = textures.filter((texture) => texture.role === role);
    if (matches.length !== 1) throw new Error(`A07 ${role} requires exactly one texture receipt`);
    const texture = matches[0];
    if (role === 'baseColor') {
      if (texture.semanticGammaSpace !== true)
        throw new Error('A07 baseColor semantic gamma tag must be true');
      for (const program of programs) {
        if (
          typeof texture.hardwareSrgb !== 'boolean' ||
          Number(texture.hardwareSrgb) + Number(program.gammaAlbedo) !== 1
        )
          throw new Error(
            `A07 baseColor requires exactly one hardware/shader decode in ${program.name}: hardware=${texture.hardwareSrgb}, GAMMAALBEDO=${program.gammaAlbedo}`,
          );
        if (texture.gammaSpace !== program.gammaAlbedo)
          throw new Error(
            `A07 baseColor effective gammaSpace disagrees with GAMMAALBEDO in ${program.name}`,
          );
      }
    } else {
      for (const field of ['semanticGammaSpace', 'hardwareSrgb', 'gammaSpace'] as const)
        if (texture[field] !== false)
          throw new Error(`A07 ${role} data texture ${field} must be false; got ${texture[field]}`);
    }
  }
  for (const program of programs)
    if (program.reflectivityGamma)
      throw new Error(
        `A07 metallicRoughness data texture has REFLECTIVITY_GAMMA in ${program.name}`,
      );
}
