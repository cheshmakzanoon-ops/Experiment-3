/** Packaging target and build-host architecture are distinct on macOS:
 * an x64 executable can be built and exercised under Rosetta on arm64. */
export function desktopTarget(platform: string, hostArch: string, requested = hostArch) {
  if (!['win32', 'darwin', 'linux'].includes(platform))
    throw new Error(`Unsupported desktop platform: ${platform}`);
  if (!['x64', 'arm64'].includes(requested))
    throw new Error(`Unsupported desktop architecture: ${requested}`);
  return { platform, arch: requested, hostArch };
}
export function desktopExecutable(platform: string, arch: string) {
  desktopTarget(platform, arch);
  if (platform === 'win32')
    return `desktop-out/win-${arch === 'x64' ? '' : `${arch}-`}unpacked/MOTOBOUND.exe`;
  if (platform === 'darwin')
    return `desktop-out/${arch === 'arm64' ? 'mac-arm64' : 'mac'}/MOTOBOUND.app/Contents/MacOS/MOTOBOUND`;
  return `desktop-out/linux-${arch === 'x64' ? '' : `${arch}-`}unpacked/motobound`;
}
