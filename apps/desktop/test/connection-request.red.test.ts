import assert from 'node:assert/strict';
import test from 'node:test';
import { createDesktopService } from '../src/desktop-service.js';
import { createDesktopTransport } from '@prismata/sync';

test('desktop keeps a new request pending and does not issue a session before explicit approval', async () => {
  let clock = Date.parse('2026-09-29T12:00:00.000Z');
  const service = await createDesktopService({ dataFile: ':memory:', now: () => clock });
  const created = await service.request('/api/v1/connection-requests', { method: 'POST', body: { deviceId: 'phone-1', publicKey: 'public', deviceName: 'Phone' } });
  assert.equal(created.status, 201);
  const requestId = (created.body as { requestId: string }).requestId;
  const requestProof = (created.body as { requestProof: string }).requestProof;
  const pending = await service.request(`/api/v1/connection-requests/${requestId}`, { headers: { 'x-prismata-request-proof': requestProof } });
  assert.equal((pending.body as { status: string }).status, 'pending');
  assert.equal('accessToken' in (pending.body as object), false);
  const wrong = await service.approveLocalConnectionRequest(requestId, 'AAAAAA');
  assert.equal(wrong.status, 401);
  const approved = await service.approveLocalConnectionRequest(requestId, (await service.listLocalConnectionRequests())[0].code!);
  assert.equal(approved.status, 200);
  assert.equal('accessToken' in (approved.body as object), false);
  const session = await service.request(`/api/v1/connection-requests/${requestId}/session`, { method: 'POST', headers: { 'x-prismata-request-proof': requestProof } });
  assert.equal(session.status, 201);
  const replay = await service.approveLocalConnectionRequest(requestId, 'AAAAAA');
  assert.equal(replay.status, 409);
  clock += 120_001;
  const expired = await service.request('/api/v1/connection-requests', { method: 'POST', body: { deviceId: 'phone-2', publicKey: 'public', deviceName: 'Phone' } });
  const expiredId = (expired.body as { requestId: string }).requestId;
  clock += 120_001;
  assert.equal((await service.approveLocalConnectionRequest(expiredId, (await service.listLocalConnectionRequests()).find((item) => item.requestId === expiredId)?.code ?? 'AAAAAA')).status, 401);
});

test('public connection request APIs never leak the code and cannot approve or issue by request id', async () => {
  const service = await createDesktopService({ dataFile: ':memory:' });
  const created = await service.request('/api/v1/connection-requests', { method: 'POST', body: { deviceId: 'phone-secure', publicKey: 'public-secure', deviceName: 'Phone' } });
  const body = created.body as Record<string, unknown>;
  assert.equal('code' in body, false);
  assert.equal(typeof body.requestProof, 'string');
  const requestId = String(body.requestId);
  assert.equal('code' in ((await service.request(`/api/v1/connection-requests/${requestId}`)).body as object), false);
  assert.equal((await service.request(`/api/v1/connection-requests/${requestId}/approve`, { method: 'POST', body: { code: 'AAAAAA' } })).status, 404);
  assert.equal((await service.request(`/api/v1/connection-requests/${requestId}/session`, { method: 'POST' })).status, 404);
});

test('proof-bound request status returns the confirmation code without making it enumerable', async () => {
  const service = await createDesktopService({ dataFile: ':memory:' });
  const created = await service.request('/api/v1/connection-requests', { method: 'POST', body: { deviceId: 'phone-code', publicKey: 'public-code', deviceName: 'Phone' } });
  const body = created.body as { requestId: string; requestProof: string };
  const withoutProof = await service.request(`/api/v1/connection-requests/${body.requestId}`);
  assert.equal(withoutProof.status, 401);
  const withProof = await service.request(`/api/v1/connection-requests/${body.requestId}`, { headers: { 'x-prismata-request-proof': body.requestProof } });
  assert.match(String((withProof.body as { code?: unknown }).code), /^[A-Z2-9]{6}$/);
});

test('mobile transport and desktop approval UI receive the identical server-generated code', async () => {
  const service = await createDesktopService({ dataFile: ':memory:' });
  const endpoint = { baseUrl: 'https://desktop.local:48123', instanceId: 'desktop-code', fingerprint: 'ab'.repeat(32) };
  const transport = createDesktopTransport({
    endpoint,
    pinnedRequest: async (url, _fingerprint, init) => {
      const parsed = new URL(url);
      const result = await service.request(parsed.pathname, {
        method: init.method,
        headers: Object.fromEntries(new Headers(init.headers).entries()),
        body: init.body ? JSON.parse(String(init.body)) : undefined,
      });
      return { status: result.status, body: JSON.stringify(result.body) };
    },
  });
  const created = await service.request('/api/v1/connection-requests', { method: 'POST', body: { deviceId: 'phone-code-consistency', publicKey: 'public', deviceName: 'Phone' } });
  const body = created.body as { requestId: string; requestProof: string };
  const mobileDisplayed = await transport.getConnectionRequest(body.requestId, body.requestProof);
  const desktopDisplayed = (await service.listLocalConnectionRequests()).find((request) => request.requestId === body.requestId)?.code;
  assert.equal(mobileDisplayed.code, desktopDisplayed);
});

test('desktop local approval requires a separately supplied code and exposes no pending request after restart', async () => {
  const file = `/tmp/prismata-pairing-${Date.now()}-${Math.random()}.sqlite`;
  const first = await createDesktopService({ dataFile: file });
  await first.request('/api/v1/connection-requests', { method: 'POST', body: { deviceId: 'phone-restart', publicKey: 'public-restart', deviceName: 'Phone' } });
  const localBeforeRestart = await first.listLocalConnectionRequests();
  assert.equal(localBeforeRestart.length, 1);
  assert.equal(typeof localBeforeRestart[0].code, 'string');
  first.close();
  const second = await createDesktopService({ dataFile: file });
  assert.deepEqual(await second.listLocalConnectionRequests(), []);
  second.close();
});

test('concurrent desktop approvals issue at most one approval and malformed attempts are counted', async () => {
  const service = await createDesktopService({ dataFile: ':memory:' });
  const created = await service.request('/api/v1/connection-requests', { method: 'POST', body: { deviceId: 'phone-race', publicKey: 'public-race', deviceName: 'Phone' } });
  const requestId = (created.body as { requestId: string }).requestId;
  const local = await service.listLocalConnectionRequests();
  const results = await Promise.all([service.approveLocalConnectionRequest(requestId, local[0].code!), service.approveLocalConnectionRequest(requestId, local[0].code!)]);
  assert.equal(results.filter((result) => result.status === 200).length, 1);
  assert.equal(results.filter((result) => result.status === 401).length, 1);
  const malformed = await service.request('/api/v1/connection-requests', { method: 'POST', body: { deviceId: 'phone-attempts', publicKey: 'public-attempts', deviceName: 'Phone' } });
  const malformedId = (malformed.body as { requestId: string }).requestId;
  for (let attempt = 0; attempt < 6; attempt += 1) await service.approveLocalConnectionRequest(malformedId, 'AAAAAA');
  assert.equal((await service.listLocalConnectionRequests()).some((request) => request.requestId === malformedId), true);
});

test('concurrent session requests with the same approved proof issue at most one session', async () => {
  const service = await createDesktopService({ dataFile: ':memory:' });
  const created = await service.request('/api/v1/connection-requests', { method: 'POST', body: { deviceId: 'phone-session-race', publicKey: 'public-race', deviceName: 'Phone' } });
  const body = created.body as { requestId: string; requestProof: string };
  const requestId = body.requestId;
  const code = (await service.listLocalConnectionRequests()).find((request) => request.requestId === requestId)?.code;
  assert.equal((await service.approveLocalConnectionRequest(requestId, code!)).status, 200);

  const results = await Promise.all([
    service.request(`/api/v1/connection-requests/${requestId}/session`, { method: 'POST', headers: { 'x-prismata-request-proof': body.requestProof } }),
    service.request(`/api/v1/connection-requests/${requestId}/session`, { method: 'POST', headers: { 'x-prismata-request-proof': body.requestProof } }),
  ]);

  assert.equal(results.filter((result) => result.status === 201).length, 1);
  assert.equal(results.filter((result) => result.status === 409).length, 1);
});
