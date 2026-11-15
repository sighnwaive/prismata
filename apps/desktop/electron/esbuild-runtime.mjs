import { createRequire } from 'node:module';

export function getEsbuildBinarySubpath(platform) {
  return platform === 'win32' ? 'esbuild.exe' : 'bin/esbuild';
}

export function resolvePackagedEsbuildBinary(mainModuleUrl, platform = process.platform, architecture = process.arch) {
  const appRequire = createRequire(mainModuleUrl);
  const tsxRequire = createRequire(appRequire.resolve('tsx'));
  const esbuildRequire = createRequire(tsxRequire.resolve('esbuild'));
  const binarySubpath = getEsbuildBinarySubpath(platform);

  return esbuildRequire.resolve(`@esbuild/${platform}-${architecture}/${binarySubpath}`);
}
