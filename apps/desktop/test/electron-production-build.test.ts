import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import afterPack from '../electron/after-pack.mjs';

const packageJson = JSON.parse(await readFile(new URL('../package.json', import.meta.url), 'utf8')) as {
  scripts: Record<string, string>;
  dependencies: Record<string, string>;
  devDependencies: Record<string, string>;
  build: {
    win: { target: string[] };
    linux: { target: string[] };
    mac: { target: string[] };
    asarUnpack: string[];
    afterPack: string;
  };
};

test('desktop build scripts package production installers for each OS', () => {
  assert.match(packageJson.scripts.build, /electron-builder/);
  assert.match(packageJson.scripts['build:win'], /--win nsis/);
  assert.match(packageJson.scripts['build:linux'], /--linux AppImage/);
  assert.match(packageJson.scripts['build:mac'], /--mac dmg/);
  assert.deepEqual(packageJson.build.win.target, ['nsis']);
  assert.deepEqual(packageJson.build.linux.target, ['AppImage']);
  assert.deepEqual(packageJson.build.mac.target, ['dmg']);
  assert.equal(packageJson.build.afterPack, './electron/after-pack.mjs');
  assert.ok(packageJson.dependencies.tsx, 'the TypeScript loader is included in packaged production dependencies');
  assert.ok(packageJson.devDependencies.electron, 'Electron itself stays a build-time dependency');
  assert.ok(packageJson.build.asarUnpack.includes('**/node_modules/@esbuild/**'),
    'the esbuild executable required by the packaged TypeScript loader stays outside asar');
});

test('packaged main process points tsx at the unpacked esbuild binary before registering the loader', async () => {
  const mainSource = await readFile(new URL('../electron/main.mjs', import.meta.url), 'utf8');
  const configSetup = mainSource.indexOf('prismata-runtime-config.json');
  const binarySetup = mainSource.indexOf('process.env.ESBUILD_BINARY_PATH');
  const tsxRegistration = mainSource.indexOf("await import('tsx/esm')");
  assert.ok(configSetup >= 0 && binarySetup > configSetup && tsxRegistration > binarySetup,
    'packaged runtime config is loaded before tsx and the esbuild binary setup');
  assert.match(mainSource, /if\s*\(app\.isPackaged\)[\s\S]*?app\.asar\.unpacked/);
});

test('production workflow builds on native Windows, Linux, and macOS runners', async () => {
  const workflow = (await readFile(new URL('../../../.github/workflows/desktop-production.yml', import.meta.url), 'utf8'))
    .replace(/\r\n/g, '\n');
  for (const runner of ['windows-2022', 'ubuntu-latest', 'macos-latest']) {
    assert.ok(workflow.includes(runner), `workflow includes ${runner}`);
  }
  assert.match(workflow, /actions\/checkout@v5/);
  assert.match(workflow, /pnpm\/action-setup@v6/);
  assert.match(workflow, /actions\/setup-node@v5/);
  assert.match(workflow, /actions\/upload-artifact@v6/);
  assert.match(workflow, /run: pnpm run build:\$\{\{ matrix\.target \}\}\n\s+working-directory: apps\/desktop/);
  assert.doesNotMatch(workflow, /pnpm --filter @prismata\/desktop run build:/);
  assert.match(workflow, /ilammy\/msvc-dev-cmd@v1/);
  assert.match(workflow, /GYP_MSVS_VERSION:.*2022/);
  assert.match(workflow, /write_github_env CSC_LINK/);
  assert.match(workflow, /Add-GitHubEnvironmentVariable 'WIN_CSC_LINK'/);
  assert.doesNotMatch(workflow, /CSC_LINK:.*\|\| ''/);
  assert.match(workflow, /JOYSTICK_CLIENT_ID:\s*\$\{\{ secrets\.JOYSTICK_CLIENT_ID \}\}/);
  assert.match(workflow, /JOYSTICK_SCOPES:\s*\$\{\{ secrets\.JOYSTICK_SCOPES \}\}/);
  assert.match(workflow, /JOYSTICK_PROFILE_ENDPOINT:\s*\$\{\{ secrets\.JOYSTICK_PROFILE_ENDPOINT \}\}/);
  assert.match(workflow, /Missing required GitHub Actions secret: JOYSTICK_CLIENT_ID/);
});

test('afterPack embeds only supported Joystick runtime configuration beside app.asar', async () => {
  const appOutDir = await mkdtemp(join(tmpdir(), 'prismata-after-pack-'));
  const previousEnvironment = Object.fromEntries(
    ['JOYSTICK_CLIENT_ID', 'JOYSTICK_SCOPES', 'JOYSTICK_PROFILE_ENDPOINT', 'JOYSTICK_TOKEN_URL']
      .map((key) => [key, process.env[key]]),
  );

  process.env.JOYSTICK_CLIENT_ID = 'public-client-id';
  process.env.JOYSTICK_SCOPES = 'identity:read chat:read';
  process.env.JOYSTICK_PROFILE_ENDPOINT = 'https://api.example.test/me';
  process.env.JOYSTICK_TOKEN_URL = 'https://not-supported.example.test/token';

  try {
    await afterPack({ electronPlatformName: 'linux', appOutDir });
    const config = JSON.parse(await readFile(join(appOutDir, 'resources', 'prismata-runtime-config.json'), 'utf8'));
    assert.deepEqual(config, {
      JOYSTICK_CLIENT_ID: 'public-client-id',
      JOYSTICK_SCOPES: 'identity:read chat:read',
      JOYSTICK_PROFILE_ENDPOINT: 'https://api.example.test/me',
    });

    const macOutDir = join(appOutDir, 'mac-output');
    await afterPack({
      electronPlatformName: 'darwin',
      appOutDir: macOutDir,
      packager: { appInfo: { productFilename: 'Prismata' } },
    });
    const macConfig = await readFile(join(macOutDir, 'Prismata.app', 'Contents', 'Resources', 'prismata-runtime-config.json'), 'utf8');
    assert.deepEqual(JSON.parse(macConfig), config);
  } finally {
    for (const [key, value] of Object.entries(previousEnvironment)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
    await rm(appOutDir, { recursive: true, force: true });
  }
});
