# Historical: desktop Joystick authentication plan

> **Superseded.** Read [`desktop-owned-architecture.md`](./desktop-owned-architecture.md) for the authoritative architecture. This document describes the rejected backend-owned OAuth/session model and is retained only as migration history.

## Decision

Make the Electron main process the desktop auth orchestrator. The renderer gets a small typed IPC surface and never handles provider secrets, refresh tokens, or database access. The backend remains the owner of Joystick OAuth, account linking, and application sessions.

The desktop flow is:

1. Main process asks `POST /auth/providers/joystick/start` for an authorize URL and one-time state.
2. Main process opens the system browser and starts a loopback listener on a registered localhost redirect.
3. Joystick returns `code` and `state` to the loopback listener. Main forwards the callback to the backend finalize/callback endpoint; the backend validates state, exchanges the code, resolves/creates the user, and issues the Prismata session.
4. Main stores the returned session/refresh material in OS secure storage, publishes an authenticated session snapshot to the renderer, and triggers device registration plus settings sync.
5. On launch, main restores the session, refreshes when needed, and falls back to a signed-out/offline state without blocking the shell.

Use the existing backend session cookie contract initially, but hide cookie persistence behind a desktop session store. If the API moves to explicit JWT access and refresh tokens, only that adapter should change.

## Target boundaries

- `apps/backend`: real Joystick provider adapter, persisted auth state, callback/finalize handling, session issuance/refresh/revocation, and authenticated sync endpoints. Replace in-memory/demo callback behavior before calling the desktop flow complete.
- `packages/sync`: backend auth client and provider-neutral contracts (`start`, `complete`, `restore`, `refresh`, `signOut`), plus settings/device API calls. Remove desktop use of Supabase-era helpers and client-side Joystick token exchange.
- `apps/desktop`: Electron main-process auth coordinator, loopback callback server, secure session store, browser launch, and startup state machine. Keep provider credentials out of renderer code.
- `apps/desktop/electron/preload.mjs`: expose only typed IPC methods/events such as `auth.getSnapshot`, `auth.signInWithJoystick`, `auth.signOut`, and `auth.onStateChanged`.
- Renderer/UI: sign-in, pending, authenticated, error, and offline states; it consumes snapshots and requests actions through IPC only.
- `supabase/**`: transitional only; do not add new auth or sync behavior. Retire anonymous/Supabase paths after backend auth parity is verified.

## Backend contract to implement

- `POST /auth/providers/joystick/start`: accepts platform and registered redirect URI; returns authorize URL and correlation/state identifier. Validate desktop redirects as loopback only.
- `GET`/`POST /auth/providers/joystick/callback` (or a dedicated finalize endpoint): single-use state validation, code exchange, identity normalization/linking, and session issuance. Return a safe success page/redirect for browser callbacks; never return provider tokens to the renderer.
- `POST /auth/sessions/refresh` and `POST /auth/sessions/revoke`: rotate/revoke server-tracked sessions.
- `POST /auth/sign-out`: revoke the presented bearer/refresh session and clear the compatibility cookie.
- `GET /auth/session`: restore the current application session.
- Existing `PUT /sync/devices/self` and settings endpoints: require the authenticated session and run after sign-in/restore.

Successful Joystick completion and refresh return `{ id, userId, accessToken, refreshToken, expiresAt }`. Access tokens are short-lived JWTs; refresh tokens are opaque, stored only as hashes, and each refresh invalidates the previous token. The `prismata_session` HttpOnly cookie remains an adapter for existing clients.

`GET /sync/settings` returns the canonical `{ settings, version, updatedAt }` snapshot. `PUT /sync/settings` accepts `{ settings }` and applies last-write-wins. `PUT /sync/devices/self` accepts `{ deviceId, platform, deviceName, appInstanceId }`, upserts by `(userId, deviceId)`, and updates `lastSeenAt`.

Persist users, linked Joystick accounts, OAuth transactions/state, sessions, devices, and settings in Postgres. Encrypt provider refresh tokens at rest where retained; keep client session material in platform secure storage.

## Implementation sequence

1. Stabilize backend auth storage and Joystick adapter against the Postgres schema; add state expiry/replay protection, identity linking, and session refresh/revocation.
2. Add provider-neutral sync auth contracts and a backend client; preserve anonymous bootstrap only as a temporary compatibility path.
3. Implement desktop loopback/browser/main-process orchestration and secure session persistence.
4. Add preload IPC and a minimal renderer auth screen/status surface; connect authenticated device registration and settings pull/push.
5. Add integration coverage for successful login, cancellation, invalid/expired state, provider failure, restart/session restore, refresh rotation, sign-out, and backend-unavailable/offline startup.
6. Remove or quarantine Supabase auth/token code and update environment/configuration and Docker documentation.

## Completion criteria

Launching the desktop app shows a usable shell without auth, “Sign in with Joystick” opens the system browser, a successful callback produces a backend-owned authenticated session, restart restores that session from secure storage, and authenticated device/settings requests work without any Supabase dependency or provider secret in the desktop renderer.
