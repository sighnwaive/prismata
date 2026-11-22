import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { renderShellPage } from '../electron/shell-page';

const page = renderShellPage('starting desktop shell', 'Prismata desktop');
const mainSource = readFileSync(new URL('../electron/main.mjs', import.meta.url), 'utf8');
const preloadSource = readFileSync(new URL('../electron/preload.mjs', import.meta.url), 'utf8');
const joystickLogoPath = new URL('../electron/assets/joysticktv-logo-simple-dark.svg', import.meta.url);
const joystickLogo = readFileSync(joystickLogoPath);

test('desktop shell visibly renders Joystick authentication controls and states', () => {
  assert.match(page, /<body><div id="desktop-error" class="error-toast" role="alert" aria-live="assertive" hidden><span id="desktop-error-message" class="error-toast-message"><\/span><button id="desktop-error-dismiss" class="error-toast-dismiss" type="button" aria-label="Dismiss error" title="Dismiss">×<\/button><\/div><main><div class="shell">/);
  assert.match(page, /<section class="empty-panel" aria-label="Empty panel">.*?<\/section>\s*<section aria-label="Direct message">/);
  assert.match(page, /\.error-toast \{ position: fixed; z-index: 2000; top: 16px;/);
  assert.match(page, /\.error-toast \{[^}]*justify-content: space-between/);
  assert.match(page, /button\.error-toast-dismiss \{[^}]*flex: 0 0 28px/);
  assert.ok(page.includes(`src="data:image/svg+xml;base64,${joystickLogo.toString('base64')}"`),
    'the Joystick button embeds the Mochi project logo for the isolated data-URL page');
  assert.match(joystickLogo.toString('utf8'), /fill="#76E1F0"/,
    'the embedded logo retains Mochi’s Joystick brand color');
  assert.match(page, /\.empty-panel \{ min-height: clamp\(120px, 20vh, 220px\); padding: 0; \}/);
  assert.match(page, /\.shell > section:first-child \{ grid-column: 1 \/ -1; \}/);
  assert.match(page, /\.shell \{ width: min\(900px, 100%\);[^}]*grid-template-columns: minmax\(0, 1fr\);/);
  assert.match(page, /@media \(min-width: 1200px\) \{ \.shell \{ width: min\(1800px, 100%\); grid-template-columns: 900px minmax\(0, 900px\); \} \}/);
  assert.match(page, /\.panel-bar \{ height: 60px;[^}]*justify-content: space-between/);
  assert.match(page, /<div class="panel-bar"><span class="panel-version">v0\.1\.3<\/span><span class="panel-viewers"/,
    'the version is on the left and the viewer count is right-aligned');
  assert.match(page, /\.joystick-connect-button \{[^}]*width: 4\.5rem; height: 4\.5rem;[^}]*border-radius: 16px; background: #111827/);
  assert.match(page, /\.joystick-connect-button\.connected \{ background: #0c0c0c; \}/);
  assert.match(page, /\.joystick-logo \{[^}]*filter: grayscale\(1\); transition: filter 120ms ease; \}/);
  assert.match(page, /\.joystick-connect-button\.connected \.joystick-logo \{ filter: grayscale\(0\); \}/);
  assert.match(page, /\.panel-live-indicator \{[^}]*color: #[\da-f]{6};/i);
  assert.match(page, /\.panel-live-indicator\.live \{ color: #ff414e; \}/);
  assert.match(page, /liveIndicator\.hidden = !connected/);
  assert.match(page, /joystickStreamIsLive = status\?\.stream\?\.state === 'live'/);
  assert.match(page, /currentAuthState === 'authenticated' && joystickStreamIsLive/);
  assert.match(page, /http-equiv="Content-Security-Policy"/);
  assert.match(page, /default-src 'none'/);
  assert.match(page, /style-src 'unsafe-inline'/);
  assert.match(page, /script-src 'unsafe-inline'/);
  assert.doesNotMatch(page, /unsafe-eval/);
  assert.doesNotMatch(page, /id="auth-heading"|id="auth-state"|id="auth-detail"|id="identity"|id="sign-in"|id="sign-out"/);
  assert.match(page, /id="desktop-error"/);
  assert.match(page, /joystick-connect.+aria-pressed="false"/);
  assert.match(page, /signed-out/);
  assert.match(page, /opening-browser/);
  assert.match(page, /waiting-for-callback/);
  assert.match(page, /authenticated/);
  assert.match(page, /failure/);
  assert.match(page, /offline/);
  assert.match(page, /Retry/);
  assert.match(page, /Cancel/);
  assert.match(page, /LAN status/);
  assert.match(page, /Mobile access/);
  assert.match(page, /<section aria-labelledby="mobile-heading" hidden>/,
    'mobile access panel is kept in the page but hidden');
  assert.match(page, /Enable LAN access/);
  assert.match(page, /<span class="label">Bind host<\/span>/);
  assert.match(page, /lan-host/);
  assert.match(page, /Endpoint/);
  assert.match(page, /Protocol/);
  assert.match(page, /Discovery/);
  assert.match(page, /Fingerprint/);
  assert.match(page, /Paired devices/);
  assert.match(page, /<section aria-labelledby="devices-heading" hidden>/,
    'paired devices panel is kept in the page but hidden');
  assert.match(page, /Revoke/);
  assert.match(page, /Pending mobile connection requests/);
  assert.match(page, /<section aria-labelledby="requests-heading" hidden>/,
    'pending requests panel is kept in the page but hidden');
  assert.match(page, /Confirm code/);
  assert.match(page, /confirmation code/);
  assert.match(page, /All-interface binding is enabled/);
  assert.match(page, /public or WAN networks/);
  assert.match(page, /advertised-address/);
  assert.match(page, /Retry advertising/);
  assert.match(page, /Advertised address/);
  assert.match(page, /<section aria-label="Reminders">/);
  assert.match(page, /Send a custom message/);
  assert.match(page, /Flip a coin/);
  assert.match(page, /id="reminder-task"/);
  assert.match(page, /reminder-message-add/);
  assert.match(page, /const task = \$\('reminder-task'\)\.value/);
  assert.match(page, /id="reminder-message-list"/);
  assert.match(page, /Custom messages send in order/);
  assert.match(page, /Every X minutes/);
  assert.match(page, /Every hour/);
  assert.match(page, /Every day at a selected local time/);
  assert.doesNotMatch(page, /id="reminder-enabled"|Reminder enabled/);
});

test('desktop shell surfaces LAN failures through the fixed error toast', () => {
  assert.match(page, /const statusError = status\.discoveryError \|\| status\.lanError\?\.message; if \(statusError\) \{ showError\(statusError\); \}/);
  assert.doesNotMatch(page, /status\.lanError\.message \+ ' Retry LAN access\.'/);
});

test('desktop shell translates an HTTP 400 token-refresh failure into actionable auth guidance', () => {
  assert.match(page, /function userFacingAuthError\(message\) \{ return message === 'Joystick token refresh failed with HTTP 400' \? 'Joystick authentication could not be refreshed, please authenticate again\.' : message; \}/);
  assert.match(page, /const authError = snapshot\?\.error \? userFacingAuthError\(snapshot\.error\) : undefined; joystickButton\.title = authError \|\| labels\[state\]; if \(snapshot\?\.error\) \{ authErrorMessage = snapshot\.error; showError\(authError\);/);
});

test('all desktop error toasts have a dismiss button and auto-dismiss after eight seconds', () => {
  assert.match(page, /function showError\(message\) \{ if \(errorToastTimer !== undefined\) clearTimeout\(errorToastTimer\); errorMessage\.textContent = message; error\.hidden = false; errorToastTimer = setTimeout\(hideErrorToast, 8000\); \}/);
  assert.match(page, /\$\('desktop-error-dismiss'\)\.onclick = hideErrorToast/);
  assert.match(page, /function hideErrorToast\(\) \{ if \(errorToastTimer !== undefined\) \{ clearTimeout\(errorToastTimer\); errorToastTimer = undefined; \} error\.hidden = true; errorMessage\.textContent = ''; \}/);
});

test('desktop shell invokes only the typed auth preload surface', () => {
  assert.match(page, /window\.prismataDesktop\.auth/);
  assert.match(page, /auth\.getSnapshot\(\)/);
  assert.match(page, /auth\.signInWithJoystick\(\)/);
  assert.match(page, /auth\.signOut\(\)/);
  assert.match(page, /auth\.cancel\(\)/);
  assert.match(page, /auth\.onStateChanged\(/);
  assert.match(preloadSource, /ipcRenderer\.invoke\('auth:getSnapshot'\)/);
  assert.match(preloadSource, /ipcRenderer\.invoke\('auth:signInWithJoystick'\)/);
  assert.match(preloadSource, /ipcRenderer\.invoke\('auth:signOut'\)/);
  assert.match(preloadSource, /ipcRenderer\.invoke\('auth:cancel'\)/);
  assert.match(preloadSource, /ipcRenderer\.invoke\('desktop:listConnectionRequests'\)/);
  assert.match(preloadSource, /ipcRenderer\.invoke\('desktop:listDevices'\)/);
  assert.match(preloadSource, /ipcRenderer\.invoke\('desktop:listNetworkInterfaces'\)/);
  assert.match(preloadSource, /ipcRenderer\.invoke\('desktop:setAdvertisedAddress'/);
  assert.match(preloadSource, /ipcRenderer\.invoke\('desktop:retryAdvertising'/);
  assert.match(preloadSource, /ipcRenderer\.invoke\('reminder:get'/);
  assert.match(preloadSource, /ipcRenderer\.invoke\('reminder:update'/);
  assert.match(preloadSource, /ipcRenderer\.invoke\('reminder:test'/);
  assert.match(mainSource, /ipcMain\.handle\('desktop:listNetworkInterfaces'/);
  assert.doesNotMatch(page, /require\(|process\.|ipcRenderer|accessToken|refreshToken/);
  assert.match(mainSource, /ipcMain\.handle\('auth:cancel'/);
  assert.match(mainSource, /ipcMain\.handle\('reminder:get'/);
  assert.match(mainSource, /ipcMain\.handle\('reminder:update'/);
  assert.match(mainSource, /getReminderSettings\(await activeLifecycle\?\.getSettings\(\)\)/);
  assert.match(mainSource, /requireReminderLifecycle\(activeLifecycle\)/);
  assert.match(mainSource, /ipcMain\.handle\('reminder:test'/);
  assert.doesNotMatch(page, /ipcRenderer|accessToken|refreshToken/);
  assert.match(mainSource, /lanHost: process\.env\.PRISMATA_LAN_HOST/);
});

test('desktop shell omits the removed account panel and session metadata', () => {
  assert.doesNotMatch(page, /auth-heading|auth-state|auth-detail|userId|expiresAt/);
  assert.doesNotMatch(page, /accessToken|refreshToken|sessionToken/);
});

test('desktop shell shows pending mobile requests and explicit code approval instead of QR pairing', () => {
  assert.match(page, /Pending mobile connection requests/);
  assert.match(page, /Confirm code/);
  assert.match(page, /confirmation code/);
  assert.doesNotMatch(page, /QR pairing code/);
  assert.doesNotMatch(page, /Manual pairing/);
  assert.match(page, /input\.type = 'text'/);
  assert.match(page, /Confirm code/);
  assert.doesNotMatch(page, /approveConnectionRequest\(request\.requestId, request\.code/);
});
