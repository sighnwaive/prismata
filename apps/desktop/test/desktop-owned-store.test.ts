import assert from 'node:assert/strict';
import { mkdtemp, readFile, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { createLocalStore } from '../src/local-store.js';

test('local store uses SQLite WAL and persists settings across instances', async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'prismata-store-'));
  const file = path.join(directory, 'state.sqlite');
  const first = await createLocalStore(file);
  assert.equal(first.schemaVersion, 9);
  await first.updateSettings({ theme: 'night' }, 'desktop');

  const second = await createLocalStore(file);
  const persisted = await createLocalStore(file);
  assert.deepEqual((await second.getSettings()).settings, { theme: 'night' });
  assert.equal((await second.getSettings()).revision, 1);
  assert.equal((await first.pragma('journal_mode')).toLowerCase(), 'wal');
  assert.equal(await first.pragma('synchronous'), '2', 'durable claim commits require SQLite synchronous=FULL');
  assert.equal((await readFile(file)).subarray(0, 16).toString(), 'SQLite format 3\u0000');
  persisted.close();
  second.close();
  first.close();
});

test('local store migrates legacy reminder settings into an identified reminders array', async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'prismata-reminder-migration-'));
  const file = path.join(directory, 'state.sqlite');
  await writeFile(file, JSON.stringify({ settings: { settings: { theme: 'night', reminder: { enabled: false, message: 'Legacy', schedule: 'daily', dailyTime: '18:30' } }, revision: 3, updatedAt: '2026-01-01T00:00:00.000Z', origin: 'legacy' } }));
  const store = await createLocalStore(file);
  const snapshot = await store.getSettings();
  assert.deepEqual(snapshot.settings.reminders, [{ id: 'legacy-reminder', enabled: false, task: 'custom-message', message: 'Legacy', schedule: 'daily', intervalMinutes: 5, dailyTime: '18:30' }]);
  assert.equal(snapshot.settings.theme, 'night');
  store.close();
});

test('local store atomically rejects stale settings revisions across instances', async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'prismata-store-'));
  const file = path.join(directory, 'state.sqlite');
  const first = await createLocalStore(file);
  const second = await createLocalStore(file);
  const revision = (await first.getSettings()).revision;

  await first.updateSettings({ source: 'first' }, 'first', revision);
  await assert.rejects(second.updateSettings({ source: 'stale' }, 'second', revision), /settings conflict/);
  const persisted = await createLocalStore(file);
  assert.deepEqual((await persisted.getSettings()).settings, { source: 'first' });
  persisted.close();
  second.close();
  first.close();
});

test('local store persists pairing challenges and session metadata without raw secrets', async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'prismata-store-'));
  const file = path.join(directory, 'state.sqlite');
  const store = await createLocalStore(file);
  await store.addDevice({ deviceId: 'device-1', deviceName: 'Device', publicKey: 'public-key', createdAt: '2026-09-27T00:00:00.000Z' });
  await store.savePairingChallenge('challenge-1', '2026-09-27T00:00:00.000Z');
  await store.saveSession({ sessionId: 'session-1', deviceId: 'device-1', refreshHash: 'hash-only', expiresAt: '2026-09-27T01:00:00.000Z' });
  assert.equal(await store.getPairingChallenge('challenge-1'), '2026-09-27T00:00:00.000Z');
  assert.deepEqual(await store.getSession('session-1').then((session) => session && ({ sessionId: session.sessionId, deviceId: session.deviceId, refreshHash: session.refreshHash, expiresAt: session.expiresAt })), { sessionId: 'session-1', deviceId: 'device-1', refreshHash: 'hash-only', expiresAt: '2026-09-27T01:00:00.000Z' });
  assert.equal((await readFile(file)).includes(Buffer.from('raw-secret')), false);
  store.close();
});

test('local store persists only the connection code hash', async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'prismata-store-'));
  const file = path.join(directory, 'state.sqlite');
  const store = await createLocalStore(file);
  await store.saveConnectionRequest({ requestId: 'request-1', deviceId: 'device-1', deviceName: 'Device', publicKey: 'public-key', requestProofHash: 'proof-hash', codeHash: 'hash-only', expiresAt: '2026-09-27T01:00:00.000Z', status: 'pending', attempts: 0, createdAt: '2026-09-27T00:00:00.000Z' });
  assert.equal((await readFile(file)).includes(Buffer.from('ABCD23')), false);
  assert.equal((await store.getConnectionRequest('request-1'))?.codeHash, 'hash-only');
  store.close();
});
