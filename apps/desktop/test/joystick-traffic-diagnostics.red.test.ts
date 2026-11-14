import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import {
  TOKEN_ENDPOINT,
  createDesktopJoystickBackend,
} from '../src/joystick-oauth.js';
import { createJoystickChatClient } from '../src/joystick-chat.js';
import { createJoystickWhisperClient } from '../src/joystick-whispers.js';
import { createJoystickActionCableGateway } from '../src/joystick-gateway.js';
import { fetchWithJoystickDiagnostics } from '../src/joystick-traffic-diagnostics.js';

type Diagnostic = (event: unknown) => unknown;
type SocketEvent = { data?: string; code?: number; reason?: string };
type SocketListener = (event: SocketEvent) => void;

class FakeSocket {
  readonly sent: string[] = [];
  readonly listeners = new Map<string, SocketListener[]>();

  addEventListener(type: string, listener: SocketListener) {
    const listeners = this.listeners.get(type) ?? [];
    listeners.push(listener);
    this.listeners.set(type, listeners);
  }

  send(value: string) { this.sent.push(value); }
  close() {}
  emit(type: string, event: SocketEvent = {}) {
    for (const listener of this.listeners.get(type) ?? []) listener(event);
  }
  frame(value: unknown) { this.emit('message', { data: JSON.stringify(value) }); }
}

const redirectUri = 'http://127.0.0.1:43110/auth/callback';
const gatewayIdentifier = JSON.stringify({ channel: 'GatewayChannel', event_version: 'v2' });

function collectDiagnostics() {
  const events: unknown[] = [];
  const onDiagnostic: Diagnostic = (event) => { events.push(event); };
  return { events, onDiagnostic };
}

function diagnosticsText(events: unknown[]): string {
  return JSON.stringify(events);
}

function assertSecretsRedacted(events: unknown[], secrets: string[]) {
  const serialized = diagnosticsText(events);
  for (const secret of secrets) {
    assert.equal(serialized.includes(secret), false, `diagnostics must redact ${secret}`);
  }
}

function captureConsole(run: () => Promise<void>) {
  const calls: unknown[][] = [];
  const originals = {
    log: console.log,
    debug: console.debug,
    info: console.info,
    warn: console.warn,
    error: console.error,
  };
  const capture = (...args: unknown[]) => { calls.push(args); };
  console.log = capture;
  console.debug = capture;
  console.info = capture;
  console.warn = capture;
  console.error = capture;
  return run().then(() => calls).finally(() => {
    console.log = originals.log;
    console.debug = originals.debug;
    console.info = originals.info;
    console.warn = originals.warn;
    console.error = originals.error;
  });
}

test('OAuth logs outgoing and incoming HTTP metadata while redacting callback, PKCE, token, and header secrets', async () => {
  const diagnostics = collectDiagnostics();
  const authCode = 'oauth-auth-code-private-sentinel';
  const verifier = 'oauth-pkce-verifier-private-sentinel';
  const accessToken = 'oauth-access-token-private-sentinel';
  const refreshToken = 'oauth-refresh-token-private-sentinel';
  const idToken = 'oauth-id-token-private-sentinel';
  const clientSecret = 'oauth-client-secret-private-sentinel';
  const headerSecret = 'oauth-header-private-sentinel';
  const calls: Array<{ url: string; init?: RequestInit }> = [];
  const fetch = async (input: string | URL, init?: RequestInit) => {
    const url = String(input);
    calls.push({ url, init });
    if (url === TOKEN_ENDPOINT) {
      const form = new URLSearchParams(String(init?.body));
      if (form.get('grant_type') === 'refresh_token') {
        return new Response(JSON.stringify({
          data: {
            access_token: 'oauth-refreshed-access-private-sentinel',
            refresh_token: 'oauth-refreshed-refresh-private-sentinel',
            expires_in: 3600,
            client_secret: clientSecret,
          },
        }), {
          status: 200,
          headers: { authorization: headerSecret, 'x-private-response-header': headerSecret },
        });
      }
      return new Response(JSON.stringify({
        data: { access_token: accessToken, refresh_token: refreshToken, expires_in: 3600, client_secret: clientSecret },
      }), {
        status: 200,
        headers: { authorization: headerSecret, 'x-private-response-header': headerSecret },
      });
    }
    if (url === 'https://api.joystick.tv/api/v1/me/identity') {
      return new Response(JSON.stringify({
        data: { id: 'oauth-profile-id-useful', username: 'oauth-useful-profile', display_name: 'Useful OAuth Profile', id_token: idToken },
      }), { status: 200 });
    }
    if (url === 'https://api.joystick.tv/api/v1/me') {
      return new Response(JSON.stringify({ data: { permissions: ['stream:read', 'chat:whisper:write'], refresh_token: refreshToken } }), { status: 200 });
    }
    throw new Error(`unexpected OAuth fetch: ${url}`);
  };
  const backend = createDesktopJoystickBackend({
    clientId: 'public-client',
    redirectUri,
    fetch,
    onDiagnostic: diagnostics.onDiagnostic,
  } as Parameters<typeof createDesktopJoystickBackend>[0] & { onDiagnostic: Diagnostic });

  const started = await backend.start({ codeVerifier: verifier });
  await backend.complete(
    `${redirectUri}?code=${encodeURIComponent(authCode)}&state=${encodeURIComponent(started.state)}`,
    { codeVerifier: verifier },
  );
  await backend.refresh({
    accessToken,
    refreshToken,
    expiresAt: new Date(Date.now() + 60_000).toISOString(),
    identity: { id: 'oauth-profile-id-useful', login: 'oauth-useful-profile', displayName: 'Useful OAuth Profile' },
    state: 'authenticated',
    userId: 'oauth-profile-id-useful',
    provider: 'joystick',
    grantedPermissions: ['stream:read', 'chat:whisper:write'],
  });

  assert.equal(started.codeVerifier, verifier, 'the authorization transaction retains its PKCE verifier for the callback');
  assert.deepEqual(calls.map((call) => call.url), [
    TOKEN_ENDPOINT,
    'https://api.joystick.tv/api/v1/me/identity',
    'https://api.joystick.tv/api/v1/me',
    TOKEN_ENDPOINT,
  ]);
  const serialized = diagnosticsText(diagnostics.events);
  assert.ok(diagnostics.events.length >= 8, 'each OAuth HTTP request and response should be diagnosed');
  for (const useful of [
    TOKEN_ENDPOINT,
    '/api/v1/me/identity',
    '/api/v1/me',
    'authorization_code',
    'refresh_token',
    'oauth-useful-profile',
    'stream:read',
    '200',
  ]) assert.ok(serialized.includes(useful), `OAuth diagnostics should retain useful metadata: ${useful}`);
  assertSecretsRedacted(diagnostics.events, [
    authCode,
    verifier,
    accessToken,
    refreshToken,
    idToken,
    clientSecret,
    headerSecret,
    started.state,
  ]);
});

test('public chat and whisper log outgoing and incoming HTTP payloads with nested secrets and all header values redacted', async () => {
  const chatDiagnostics = collectDiagnostics();
  const whisperDiagnostics = collectDiagnostics();
  const accessToken = 'http-access-token-private-sentinel';
  const authorization = 'Bearer http-access-token-private-sentinel';
  const privateHeader = 'http-header-value-private-sentinel';
  const nestedToken = 'http-nested-refresh-token-private-sentinel';
  const chat = createJoystickChatClient({
    accessToken,
    getStreamState: () => 'live',
    onDiagnostic: chatDiagnostics.onDiagnostic,
    fetchImpl: async () => new Response(JSON.stringify({
      data: { id: 'chat-response-id-useful', accepted_text: 'chat-useful-message', refresh_token: nestedToken },
    }), {
      status: 201,
      headers: { authorization, 'x-private-response-header': privateHeader },
    }),
  } as Parameters<typeof createJoystickChatClient>[0] & { onDiagnostic: Diagnostic });
  const whisper = createJoystickWhisperClient({
    accessToken,
    getStreamState: () => 'live',
    onDiagnostic: whisperDiagnostics.onDiagnostic,
    fetchImpl: async () => new Response(JSON.stringify({
      sent: true,
      username: 'WhisperRecipientUseful',
      id_token: 'whisper-nested-id-token-private-sentinel',
      metadata: { client_secret: 'whisper-client-secret-private-sentinel' },
    }), {
      status: 200,
      headers: { authorization, 'x-private-response-header': privateHeader },
    }),
  } as Parameters<typeof createJoystickWhisperClient>[0] & { onDiagnostic: Diagnostic });

  await chat.sendMessage({ text: 'chat-useful-message' });
  await whisper.sendWhisper({ username: 'WhisperRecipientUseful', text: 'whisper-useful-message' });

  const chatText = diagnosticsText(chatDiagnostics.events);
  const whisperText = diagnosticsText(whisperDiagnostics.events);
  assert.ok(chatDiagnostics.events.length >= 2, 'chat records both the outgoing request and incoming response');
  assert.ok(whisperDiagnostics.events.length >= 2, 'whispers record both the outgoing request and incoming response');
  for (const useful of [
    'https://api.joystick.tv/api/v1/chat/messages',
    'POST',
    'chat-useful-message',
    'chat-response-id-useful',
    '201',
  ]) assert.ok(chatText.includes(useful), `chat diagnostics should retain useful metadata: ${useful}`);
  for (const useful of [
    'https://api.joystick.tv/api/v1/chat/whispers',
    'POST',
    'WhisperRecipientUseful',
    'whisper-useful-message',
    '200',
  ]) assert.ok(whisperText.includes(useful), `whisper diagnostics should retain useful metadata: ${useful}`);
  assertSecretsRedacted(chatDiagnostics.events, [accessToken, authorization, privateHeader, nestedToken]);
  assertSecretsRedacted(whisperDiagnostics.events, [
    accessToken,
    authorization,
    privateHeader,
    'whisper-nested-id-token-private-sentinel',
    'whisper-client-secret-private-sentinel',
  ]);
});

test('gateway diagnoses inbound and outbound frames while scrubbing URL tokens and recursively nested event secrets', async () => {
  const diagnostics = collectDiagnostics();
  const token = 'gateway-url-token-private-sentinel';
  const headerSecret = 'gateway-authorization-header-private-sentinel';
  const sockets: FakeSocket[] = [];
  const urls: string[] = [];
  const gateway = createJoystickActionCableGateway({
    getAccessToken: () => token,
    getGrantedPermissions: () => ['stream:read'],
    socketFactory: (url: string) => {
      urls.push(url);
      const socket = new FakeSocket();
      sockets.push(socket);
      return socket;
    },
    onDiagnostic: diagnostics.onDiagnostic,
  } as Parameters<typeof createJoystickActionCableGateway>[0] & { onDiagnostic: Diagnostic });
  const event = {
    v: 2,
    type: 'followed',
    id: 'gateway-useful-event-id',
    data: {
      who: 'GatewayUsefulViewer',
      note: 'gateway-useful-event-note',
      metadata: {
        access_token: 'gateway-nested-access-token-private-sentinel',
        refresh_token: 'gateway-nested-refresh-token-private-sentinel',
        id_token: 'gateway-nested-id-token-private-sentinel',
        authorization: headerSecret,
        headers: { authorization: headerSecret, 'x-private': headerSecret },
        code: 'gateway-nested-auth-code-private-sentinel',
        code_verifier: 'gateway-nested-pkce-verifier-private-sentinel',
        client_secret: 'gateway-nested-client-secret-private-sentinel',
        url: `wss://api.joystick.tv/cable?token=${token}`,
      },
    },
  };

  await gateway.start();
  const socket = sockets[0]!;
  socket.frame({ type: 'welcome' });
  socket.frame({ type: 'confirm_subscription', identifier: gatewayIdentifier });
  socket.frame({ type: 'message', identifier: gatewayIdentifier, message: event });

  const serialized = diagnosticsText(diagnostics.events);
  assert.equal(new URL(urls[0]!).searchParams.get('token'), token, 'the socket still authenticates using the access token');
  assert.ok(diagnostics.events.length >= 5, 'connection plus inbound and outbound protocol frames are diagnosed');
  for (const useful of [
    'wss://api.joystick.tv/cable',
    'welcome',
    'confirm_subscription',
    'subscribe',
    'GatewayChannel',
    'message',
    'gateway-useful-event-id',
    'GatewayUsefulViewer',
    'gateway-useful-event-note',
  ]) assert.ok(serialized.includes(useful), `gateway diagnostics should retain useful metadata: ${useful}`);
  assertSecretsRedacted(diagnostics.events, [
    token,
    headerSecret,
    'gateway-nested-access-token-private-sentinel',
    'gateway-nested-refresh-token-private-sentinel',
    'gateway-nested-id-token-private-sentinel',
    'gateway-nested-auth-code-private-sentinel',
    'gateway-nested-pkce-verifier-private-sentinel',
    'gateway-nested-client-secret-private-sentinel',
  ]);
  await gateway.stop();
});

test('gateway console diagnostics skip top-level ActionCable ping frames without suppressing normal traffic', async () => {
  const sockets: FakeSocket[] = [];
  const observed: unknown[] = [];
  const received: unknown[] = [];
  const event = {
    v: 2,
    type: 'followed',
    id: 'gateway-business-event-diagnostic-sentinel',
    data: { who: 'GatewayUsefulViewer' },
  };
  const consoleCalls = await captureConsole(async () => {
    const gateway = createJoystickActionCableGateway({
      getAccessToken: () => 'gateway-access-token',
      getGrantedPermissions: () => ['stream:read'],
      socketFactory: () => { const socket = new FakeSocket(); sockets.push(socket); return socket; },
      onEventEnvelope: (envelope: unknown) => { observed.push(envelope); },
      onEvent: (envelope: unknown) => { received.push(envelope); },
      onDiagnostic: (diagnostic: unknown) => console.debug('[Joystick traffic]', diagnostic),
    });

    await gateway.start();
    const socket = sockets[0]!;
    socket.frame({ type: 'welcome' });
    socket.frame({ type: 'ping' });
    socket.frame({ type: 'confirm_subscription', identifier: gatewayIdentifier });
    socket.frame({ type: 'message', identifier: gatewayIdentifier, message: event });
    await gateway.stop();
  });

  const serializedConsoleDiagnostics = JSON.stringify(consoleCalls);
  assert.ok(consoleCalls.length > 0, 'gateway traffic reaches the console diagnostic sink');
  for (const useful of [
    'welcome',
    'confirm_subscription',
    'subscribe',
    'GatewayChannel',
    'message',
    'gateway-business-event-diagnostic-sentinel',
    'GatewayUsefulViewer',
  ]) assert.ok(serializedConsoleDiagnostics.includes(useful), `console diagnostics retain normal gateway traffic: ${useful}`);
  assert.deepEqual(sockets[0]!.sent, [JSON.stringify({ command: 'subscribe', identifier: gatewayIdentifier })], 'welcome still triggers the subscription');
  assert.deepEqual(observed, [event], 'only the business event reaches the envelope observer');
  assert.deepEqual(received, [event], 'the business event is still dispatched');
  assert.equal(serializedConsoleDiagnostics.includes('ping'), false, 'the top-level ActionCable ping frame is omitted from console diagnostics');
});

test('diagnostic sink failures never print raw fetch or socket errors', async () => {
  const rawFetchError = 'raw-fetch-error-with-fetch-token-private-sentinel';
  const rawSocketError = 'raw-socket-error-with-socket-token-private-sentinel';
  const fetchSinkAttempts: unknown[] = [];
  const socketSinkAttempts: unknown[] = [];
  const consoleCalls = await captureConsole(async () => {
    const chat = createJoystickChatClient({
      accessToken: 'error-path-access-token',
      getStreamState: () => 'live',
      onDiagnostic: (event: unknown) => {
        fetchSinkAttempts.push(event);
        throw new Error(`diagnostic sink rejected: ${JSON.stringify(event)}`);
      },
      fetchImpl: async () => { throw new Error(rawFetchError); },
    } as Parameters<typeof createJoystickChatClient>[0] & { onDiagnostic: Diagnostic });
    await assert.rejects(chat.sendMessage({ text: 'error-path-useful-message' }));

    const gateway = createJoystickActionCableGateway({
      getAccessToken: () => 'error-path-socket-token',
      getGrantedPermissions: () => ['stream:read'],
      socketFactory: () => { throw new Error(rawSocketError); },
      onDiagnostic: (event: unknown) => {
        socketSinkAttempts.push(event);
        throw new Error(`diagnostic sink rejected: ${JSON.stringify(event)}`);
      },
      maxReconnectAttempts: 0,
    } as Parameters<typeof createJoystickActionCableGateway>[0] & { onDiagnostic: Diagnostic });
    await gateway.start();
    await gateway.stop();
  });

  assert.ok(fetchSinkAttempts.length > 0, 'failed HTTP transport attempts still reach the shared diagnostic sink');
  assert.ok(socketSinkAttempts.length > 0, 'failed socket transport attempts still reach the shared diagnostic sink');
  const allOutput = JSON.stringify([consoleCalls, fetchSinkAttempts, socketSinkAttempts]);
  assert.equal(allOutput.includes(rawFetchError), false, 'neither console nor diagnostics expose raw fetch error text');
  assert.equal(allOutput.includes(rawSocketError), false, 'neither console nor diagnostics expose raw socket error text');
  assert.deepEqual(consoleCalls, [], 'diagnostic sink exceptions are swallowed rather than printed');
});

test('console diagnostics recursively redact snake_case and camelCase API and private keys', async () => {
  const secrets = [
    'http-request-api-key-snake-private-sentinel',
    'http-request-api-key-camel-private-sentinel',
    'http-request-private-key-snake-private-sentinel',
    'http-request-private-key-camel-private-sentinel',
    'http-response-api-key-snake-private-sentinel',
    'http-response-api-key-camel-private-sentinel',
    'http-response-private-key-snake-private-sentinel',
    'http-response-private-key-camel-private-sentinel',
    'gateway-api-key-snake-private-sentinel',
    'gateway-api-key-camel-private-sentinel',
    'gateway-private-key-snake-private-sentinel',
    'gateway-private-key-camel-private-sentinel',
  ];
  const consoleCalls = await captureConsole(async () => {
    const onDiagnostic: Diagnostic = (event) => console.debug('[Joystick traffic]', event);
    await fetchWithJoystickDiagnostics(
      async () => new Response(JSON.stringify({
        result: {
          config: {
            api_key: secrets[4],
            apiKey: secrets[5],
            private_key: secrets[6],
            privateKey: secrets[7],
          },
        },
      }), { status: 200 }),
      'https://api.joystick.tv/api/v1/diagnostic-test',
      {
        method: 'POST',
        body: JSON.stringify({
          envelope: {
            config: {
              api_key: secrets[0],
              apiKey: secrets[1],
              private_key: secrets[2],
              privateKey: secrets[3],
            },
          },
        }),
      },
      onDiagnostic,
    );

    const sockets: FakeSocket[] = [];
    const gateway = createJoystickActionCableGateway({
      getAccessToken: () => 'gateway-auth-token',
      getGrantedPermissions: () => ['stream:read'],
      socketFactory: () => {
        const socket = new FakeSocket();
        sockets.push(socket);
        return socket;
      },
      onDiagnostic,
    } as Parameters<typeof createJoystickActionCableGateway>[0] & { onDiagnostic: Diagnostic });
    await gateway.start();
    const socket = sockets[0]!;
    socket.frame({ type: 'welcome' });
    socket.frame({ type: 'confirm_subscription', identifier: gatewayIdentifier });
    socket.frame({
      type: 'message',
      identifier: gatewayIdentifier,
      message: {
        type: 'credentials_updated',
        data: {
          metadata: {
            config: {
              api_key: secrets[8],
              apiKey: secrets[9],
              private_key: secrets[10],
              privateKey: secrets[11],
            },
          },
        },
      },
    });
    await gateway.stop();
  });

  assert.ok(consoleCalls.length > 0, 'HTTP and gateway traffic should reach the console diagnostic sink');
  const serializedConsoleDiagnostics = JSON.stringify(consoleCalls);
  const leakedSecrets = secrets.filter((secret) => serializedConsoleDiagnostics.includes(secret));
  assert.deepEqual(leakedSecrets, [], `console diagnostics must redact nested credential values: ${leakedSecrets.join(', ')}`);
});

test('main wires one development-only diagnostic callback into every desktop Joystick HTTP and gateway client', async () => {
  const mainSource = await readFile(new URL('../electron/main.mjs', import.meta.url), 'utf8');
  const runtimeSource = await readFile(new URL('../electron/joystick-whisper-runtime.ts', import.meta.url), 'utf8');
  const declarationStart = mainSource.indexOf('const joystickTrafficDiagnostic');
  const declarationEnd = mainSource.indexOf('};', declarationStart);
  assert.ok(declarationStart >= 0 && declarationEnd > declarationStart, 'main defines one shared Joystick traffic diagnostic callback');
  const diagnosticSource = mainSource.slice(declarationStart, declarationEnd + 2);
  assert.match(diagnosticSource, /developmentLog\('debug'/, 'development diagnostics use the guarded console logger');
  const guardedLoggerStart = mainSource.indexOf('function developmentLog');
  const guardedLoggerEnd = mainSource.indexOf('\n}', guardedLoggerStart);
  const guardedLogger = mainSource.slice(guardedLoggerStart, guardedLoggerEnd);
  assert.match(guardedLogger, /if\s*\(\s*app\.isPackaged\s*\)\s*return/,
    'the shared logger exits before console output in packaged builds');
  assert.match(guardedLogger, /console\[method\]\(\.\.\.args\)/,
    'the shared logger writes development diagnostics to the selected console method');
  assert.doesNotMatch(mainSource, /console\.(?:log|debug|info|warn|error)\(/,
    'all main-process console output goes through the packaged-mode guard');
  assert.doesNotMatch(runtimeSource, /console\.(?:log|debug|info|warn|error)\(/,
    'runtime logging is injected through the guarded main-process sink');
  assert.match(mainSource, /logError:\s*\(message, diagnostic\)\s*=>\s*developmentLog\('error', message, diagnostic\)/,
    'whisper failures use the guarded console sink');
  assert.equal((mainSource.match(/log:\s*\(message\)\s*=>\s*developmentLog\('warn'/g) ?? []).length, 2,
    'scheduled chat warnings use the guarded console sink');

  const sharedName = 'joystickTrafficDiagnostic';
  const gatewayStart = mainSource.indexOf('createJoystickActionCableGateway({');
  const gatewayOptionsEnd = mainSource.indexOf('onEventEnvelope:', gatewayStart);
  const sections = [
    ['OAuth backend', mainSource.slice(mainSource.indexOf('createDesktopJoystickBackend({'), mainSource.indexOf('}),', mainSource.indexOf('createDesktopJoystickBackend({')))],
    ['public chat sender', mainSource.slice(mainSource.indexOf('createAuthenticatedJoystickChatSender({'), mainSource.indexOf('}),', mainSource.indexOf('createAuthenticatedJoystickChatSender({')))],
    ['gateway', mainSource.slice(gatewayStart, gatewayOptionsEnd)],
    ['whisper HTTP client', mainSource.slice(mainSource.indexOf('createJoystickWhisperClient({'), mainSource.indexOf('})', mainSource.indexOf('createJoystickWhisperClient({')))],
  ] as const;
  for (const [label, source] of sections) {
    assert.ok(source.length > 0, `main constructs the ${label}`);
    assert.match(source, new RegExp(`onDiagnostic\\s*:\\s*${sharedName}`), `${label} receives the shared diagnostic callback`);
  }
});
