#!/usr/bin/env sh
set -eu

repo_root=$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)

cd "$repo_root"
pnpm --dir apps/mobile exec node - <<'NODE'
const assert = require('node:assert/strict');
const path = require('node:path');
const { resolve } = require(require.resolve('metro-resolver', {
  paths: [require.resolve('@react-native/metro-config')],
}));

const mobileRoot = process.cwd();
const workspaceRoot = path.resolve(mobileRoot, '../..');
const config = require(path.join(mobileRoot, 'metro.config.js'));

assert.equal(config.projectRoot, mobileRoot);
assert.deepEqual(config.watchFolders, [workspaceRoot]);
assert.deepEqual(config.resolver.nodeModulesPaths, [
  path.join(mobileRoot, 'node_modules'),
  path.join(workspaceRoot, 'node_modules'),
]);
assert.equal(config.resolver.unstable_enablePackageExports, true);

for (const packageName of ['@prismata/core', '@prismata/sync', '@prismata/ui']) {
  assert.doesNotThrow(() => require.resolve(packageName, { paths: [mobileRoot] }), packageName);
}

const runtimeModule = '@babel/runtime/helpers/interopRequireDefault';
const resolution = resolve(
  {
    originModulePath: path.join(mobileRoot, 'index.js'),
    resolveRequest: null,
    redirectModulePath: (modulePath) => modulePath,
    allowHaste: false,
    assetExts: config.resolver.assetExts,
    sourceExts: config.resolver.sourceExts,
    preferNativePlatform: true,
    disableHierarchicalLookup: config.resolver.disableHierarchicalLookup ?? false,
    nodeModulesPaths: config.resolver.nodeModulesPaths,
    extraNodeModules: config.resolver.extraNodeModules,
    resolveAsset: null,
    doesFileExist: (filePath) => require('node:fs').existsSync(filePath),
  },
  runtimeModule,
  null,
);

assert.ok(resolution.filePath.endsWith('/@babel/runtime/helpers/interopRequireDefault.js'));

console.log('mobile Metro config resolves workspace packages and Babel runtime');
NODE
