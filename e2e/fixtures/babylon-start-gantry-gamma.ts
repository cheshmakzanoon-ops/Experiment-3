import type { BaseTexture } from '@babylonjs/core/Materials/Textures/baseTexture.js';

export type A07TextureRole = 'baseColor' | 'normal' | 'metallicRoughness';
/** Pinned Babylon getter is generic metadata, consumed only by selected PBR slots.
 * These cached fields do not query GL; call from the fixture's GPU-owned receipt. */
export function a07TextureGamma(texture: BaseTexture, role: A07TextureRole) {
  const gammaSpace = texture.gammaSpace;
  const internal = texture.getInternalTexture();
  return {
    role,
    gammaSpace,
    diagnosticGenericGammaSpace: internal?._gammaSpace ?? null,
    hardwareSrgb: internal?._useSRGBBuffer ?? null,
  };
}
export function a07ProgramGamma(name: string, defines: string, samplers: readonly string[] = []) {
  // Pinned PBR uses #ifdef/defined, so even a macro defined as 0 is present.
  const defined = (name: string) => new RegExp(`^\\s*#define\\s+${name}\\b`, 'm').test(defines);
  return {
    name,
    defines,
    gammaAlbedo: defined('GAMMAALBEDO'),
    reflectivityGamma: defined('REFLECTIVITY_GAMMA'),
    samplers: [...samplers],
    requiredDataPaths: Object.fromEntries(
      [
        'ALBEDO',
        'BUMP',
        'NORMAL',
        'METALLICWORKFLOW',
        'REFLECTIVITY',
        'ROUGHNESSSTOREINMETALMAPGREEN',
        'METALLNESSSTOREINMETALMAPBLUE',
      ].map((key) => [key, defined(key)]),
    ),
    unexpectedDataPaths: [
      'UNLIT',
      'OBJECTSPACE_NORMALMAP',
      'PARALLAX',
      'PARALLAXOCCLUSION',
      'DETAIL',
      'ROUGHNESSSTOREINMETALMAPALPHA',
      'AOSTOREINMETALMAPRED',
    ].filter(defined),
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
      if (texture.diagnosticGenericGammaSpace !== true)
        throw new Error('A07 baseColor generic gamma tag must be true');
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
      // glTF nonColorData disables sRGB storage. The generic gamma getter/tag
      // remain true by default, but bump and metallic PBR paths do not use them.
      // Never mutate production textures to make unused metadata look linear.
      if (texture.hardwareSrgb !== false)
        throw new Error(
          `A07 ${role} data texture hardwareSrgb must be false; got ${texture.hardwareSrgb}`,
        );
    }
  }
  for (const program of programs) {
    for (const [macro, present] of Object.entries(program.requiredDataPaths))
      if (!present)
        throw new Error(`A07 ${program.name} required native data sampling macro ${macro} absent`);
    for (const sampler of ['albedoSampler', 'bumpSampler', 'reflectivitySampler'])
      if (!program.samplers.includes(sampler))
        throw new Error(`A07 ${program.name} required native data sampler ${sampler} absent`);
    if (program.unexpectedDataPaths.length)
      throw new Error(
        `A07 ${program.name} unexpected data sampling path: ${program.unexpectedDataPaths.join(', ')}`,
      );
    // Pinned metallic define production forces this off. The fragment also
    // guards its conversion with !METALLICWORKFLOW; reject a non-native define
    // contract here, not an alleged active conversion on the metallic branch.
    if (program.reflectivityGamma)
      throw new Error(
        `A07 metallicRoughness native define contract has unexpected REFLECTIVITY_GAMMA in ${program.name}`,
      );
  }
}
