import { expect, it } from 'vitest';
import { desktopExecutable, desktopTarget } from '../desktop/target.ts';
it('distinguishes the Intel package from its Apple Silicon build host', () => {
  expect(desktopTarget('darwin', 'arm64', 'x64')).toEqual({
    platform: 'darwin',
    arch: 'x64',
    hostArch: 'arm64',
  });
  expect(desktopTarget('darwin', 'arm64')).toEqual({
    platform: 'darwin',
    arch: 'arm64',
    hostArch: 'arm64',
  });
});
it.each([
  ['win32', 'x64', 'desktop-out/win-unpacked/MOTOBOUND.exe'],
  ['linux', 'x64', 'desktop-out/linux-unpacked/motobound'],
  ['darwin', 'x64', 'desktop-out/mac/MOTOBOUND.app/Contents/MacOS/MOTOBOUND'],
  ['darwin', 'arm64', 'desktop-out/mac-arm64/MOTOBOUND.app/Contents/MacOS/MOTOBOUND'],
])('selects the exact packaged %s/%s executable', (platform, arch, path) => {
  expect(desktopExecutable(platform, arch)).toBe(path);
});
it('rejects unsupported target requests instead of silently using the host architecture', () => {
  expect(() => desktopTarget('linux', 'x64', 'bad')).toThrow('architecture');
  expect(() => desktopTarget('unknown', 'x64')).toThrow('platform');
});
