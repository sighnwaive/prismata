import { createHash, randomBytes, randomUUID } from 'node:crypto';

const hash = (value) => createHash('sha256').update(value).digest('hex');
const pkceS256 = (value) => createHash('sha256').update(value).digest('base64url');
const expiry = () => new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString();

export const createPostgresAuthStorage = ({ databaseUrl = process.env.DATABASE_URL, pool } = {}) => {
  let clientPool = pool;
  let jwtSigner = null;
  const getPool = async () => {
    if (clientPool) return clientPool;
    let pg;
    try { pg = await import('pg'); } catch {
      throw new Error('Postgres auth storage requires the pg package or an injected pool');
    }
    clientPool = new pg.Pool({ connectionString: databaseUrl });
    return clientPool;
  };
  const query = async (text, values) => (await getPool()).query(text, values);

  return {
    configureJwt(jwt) { jwtSigner = jwt; },
    async persistAuthState(state) {
      await query(`insert into public.oauth_transactions
        (state, provider, platform, redirect_uri, code_challenge, code_challenge_method, expires_at)
        values ($1,$2,$3,$4,$5,$6,now() + interval '10 minutes')`,
      [state.state, state.provider, state.platform, state.redirectUri, state.codeChallenge ?? null, state.codeChallengeMethod ?? null]);
    },
    async consumeAuthState(state, expected = {}) {
      const result = await query(`select * from public.oauth_transactions
        where state = $1 and expires_at > now()
          and ($2::text is null or platform = $2)
          and ($3::text is null or redirect_uri = $3)`, [state, expected.platform ?? null, expected.redirectUri ?? null]);
      const record = result.rows[0];
      if (!record) return false;
      if (record.code_challenge) {
        const verifier = expected.codeVerifier;
        if (!verifier) return false;
        const actual = record.code_challenge_method === 'S256' ? pkceS256(verifier) : verifier;
        if (actual !== record.code_challenge) return false;
      }
      await query('delete from public.oauth_transactions where state = $1', [state]);
      return true;
    },
    async createSession({ provider = 'anonymous' } = {}) {
      const user = await query('insert into public.users default values returning id');
      const session = await query(`insert into public.sessions (user_id, refresh_token_hash, expires_at)
        values ($1,$2,$3) returning id, user_id, expires_at`, [user.rows[0].id, hash(randomUUID()), expiry()]);
      return { id: session.rows[0].id, userId: session.rows[0].user_id, state: provider, expiresAt: session.rows[0].expires_at };
    },
    async createAuthenticatedSession({ subject, provider = 'joystick' }) {
      const existing = await query('select user_id from public.auth_accounts where provider = $1 and provider_subject = $2', [provider, subject]);
      const userId = existing.rows[0]?.user_id ?? (await query('insert into public.users default values returning id')).rows[0].id;
      await query(`insert into public.auth_accounts (user_id, provider, provider_subject)
        values ($1,$2,$3) on conflict (provider, provider_subject) do update set updated_at = now()
        returning user_id`, [userId, provider, subject]);
      const refreshToken = randomBytes(32).toString('base64url');
      const session = await query(`insert into public.sessions (user_id, refresh_token_hash, expires_at)
        values ($1,$2,$3) returning id, user_id, expires_at`, [userId, hash(refreshToken), expiry()]);
      return { id: session.rows[0].id, userId, accessToken: jwtSigner.sign({ sid: session.rows[0].id, sub: userId }), refreshToken, expiresAt: session.rows[0].expires_at };
    },
    async getSession(id) {
      const result = await query(`select id, user_id as "userId", expires_at as "expiresAt" from public.sessions
        where id = $1 and revoked_at is null and expires_at > now()`, [id]);
      return result.rows[0] ?? null;
    },
    async rotateRefreshSession(token) {
      const client = await getPool();
      const result = await client.query(`update public.sessions set revoked_at = now(), updated_at = now()
        where refresh_token_hash = $1 and revoked_at is null and expires_at > now()
        returning user_id`, [hash(token)]);
      if (!result.rows[0]) return null;
      return this.createAuthenticatedSession({ subject: `session:${result.rows[0].user_id}` });
    },
    async revokeRefreshToken(token) {
      const result = await query('update public.sessions set revoked_at = now(), updated_at = now() where refresh_token_hash = $1 and revoked_at is null', [hash(token)]);
      return result.rowCount === 1;
    },
    async revokeSession(id) {
      const result = await query('update public.sessions set revoked_at = now(), updated_at = now() where id = $1 and revoked_at is null', [id]);
      return result.rowCount === 1;
    },
    async getUserSettings(userId) {
      const result = await query(`insert into public.user_settings (user_id) values ($1) on conflict (user_id) do update set user_id = excluded.user_id returning settings, version, updated_at as "updatedAt"`, [userId]);
      return result.rows[0];
    },
    async saveUserSettings({ userId, settings }) {
      const result = await query(`insert into public.user_settings (user_id, settings, version) values ($1,$2,1)
        on conflict (user_id) do update set settings = excluded.settings, version = public.user_settings.version + 1, updated_at = now()
        returning settings, version, updated_at as "updatedAt"`, [userId, settings]);
      return result.rows[0];
    },
    async upsertDevice({ userId, device }) {
      const result = await query(`insert into public.devices (user_id, device_id, platform, device_name, app_instance_id, last_seen_at)
        values ($1,$2,$3,$4,$5,now()) on conflict (user_id, device_id) do update set platform=excluded.platform, device_name=excluded.device_name, app_instance_id=excluded.app_instance_id, last_seen_at=now(), updated_at=now()
        returning device_id as "deviceId", platform, device_name as "deviceName", app_instance_id as "appInstanceId", last_seen_at as "lastSeenAt"`, [userId, device.deviceId, device.platform, device.deviceName ?? null, device.appInstanceId ?? null]);
      return result.rows[0];
    },
  };
};
