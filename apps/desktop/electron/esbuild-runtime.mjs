import { createRequire } from 'node:module';

export function resolvePackagedEsbuildBinary(mainModuleUrl, platform = process.platform, architecture = process.arch) {
  const appRequire = createRequire(mainModuleUrl);
  const tsxRequire = createRequire(appRequire.resolve('tsx'));
  const esbuildRequire = createRequire(tsxRequire.resolve('esbuild'));

  return esbuildRequire.resolve(`@esbuild/${platform}-${architecture}/bin/esbuild`);
}
