import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { createServer } from 'node:http';
import path from 'node:path';
import test from 'node:test';

const repoRoot = path.resolve(import.meta.dirname, '../../..');
const composeFilePath = path.join(repoRoot, 'docker-compose.local-postgres.yml');
const databaseUrl =
  process.env.DATABASE_URL ??
  'postgresql://postgres:postgres@127.0.0.1:5434/prismata';

const closeServer = (server) =>
  new Promise((resolve, reject) => {
    server.close((error) => {
      if (error) {
        reject(error);
        return;
      }

      resolve();
    });
  });

const runPostgresSql = (sql) => {
  const result = spawnSync(
    'docker',
    [
      'compose',
      '-f',
      composeFilePath,
      'exec',
      '-T',
      'postgres',
      'psql',
      '-U',
      'postgres',
      '-d',
      'prismata',
      '-t',
      '-A',
      '-c',
      sql,
    ],
    {
      cwd: repoRoot,
      encoding: 'utf8',
    },
  );

  if (result.status !== 0) {
    throw new Error(result.stderr || result.stdout || 'psql failed');
  }

  return result.stdout.trim();
};

test('anonymous session bootstrap persists a session and backing user row in Postgres', async () => {
  const [{ createApp }, { createPostgresAuthStorage }] = await Promise.all([
    import('../src/app.mjs'),
    import('../src/auth/postgres-auth-storage.mjs'),
  ]);

  runPostgresSql('truncate table public.sessions, public.users restart identity cascade;');

  const authStorage = createPostgresAuthStorage({
    databaseUrl,
  });

  const server = createServer(createApp({ authStorage }));

  await new Promise((resolve) => {
    server.listen(0, '127.0.0.1', resolve);
  });

  try {
    const address = server.address();

    assert.ok(address && typeof address === 'object');

    const response = await fetch(`http://127.0.0.1:${address.port}/auth/sessions/anonymous`, {
      method: 'POST',
    });

    assert.equal(response.status, 200);

    const body = await response.json();

    assert.equal(body.session.state, 'anonymous');
    assert.match(body.session.id, /^[0-9a-f-]{36}$/i);
    assert.match(body.session.userId, /^[0-9a-f-]{36}$/i);
    assert.equal(
      response.headers.get('set-cookie')?.includes(`prismata_session=${body.session.id}`),
      true,
    );

    const persistedSessionJson = runPostgresSql(
      `select json_build_object('id', id::text, 'userId', user_id::text) from public.sessions where id = '${body.session.id}';`,
    );
    const persistedUserCount = runPostgresSql(
      `select count(*) from public.users where id = '${body.session.userId}';`,
    );
    const persistedSessionCount = runPostgresSql(
      `select count(*) from public.sessions where id = '${body.session.id}' and user_id = '${body.session.userId}';`,
    );

    assert.deepEqual(JSON.parse(persistedSessionJson), {
      id: body.session.id,
      userId: body.session.userId,
    });
    assert.equal(persistedUserCount, '1');
    assert.equal(persistedSessionCount, '1');
  } finally {
    await closeServer(server);
  }
});
