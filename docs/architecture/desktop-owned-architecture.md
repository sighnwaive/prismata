# Prismata desktop-owned architecture

**Status:** authoritative target architecture  
**Scope:** Electron desktop, mobile companion, local persistence, LAN API, authentication, discovery, pairing, sync, and migration  
**Supersedes:** the backend/Postgres/Docker deployment model described in the PRD and earlier architecture notes

## 1. Decision summary

Prismata has no standalone backend application in the target architecture. The Electron desktop application is the local system of record and service host:

- Electron main process owns local persistence, authentication orchestration, encryption-key access, sync policy, and the LAN API.
- Mobile connects to a desktop on the same LAN for account/device operations and settings synchronization.
- There is no Postgres dependency, Docker-hosted Prismata API, or always-on cloud backend in the target runtime.
- The desktop may use Joystick's remote OAuth endpoints, but it owns the OAuth transaction and receives the provider callback.
- The desktop is a **public OAuth client**. A confidential client secret cannot safely ship in an Electron binary, packaged resources, renderer bundle, or obfuscated configuration. It must never be relied on as a desktop security boundary.
- Local data remains usable while offline. Remote Joystick availability and LAN availability are independent concerns.

The desktop's main process is trusted application code; the renderer and every LAN client are untrusted peers relative to the local data store.

## 2. Runtime topology and trust boundaries

```text
                         Joystick OAuth
                              ^
                              | PKCE + browser callback
                              v
  Electron renderer <-> Electron main process <-> embedded local store
                              ^                    (encrypted at rest)
                              |
                     authenticated LAN API
                              ^
                 mDNS/DNS-SD discovery / QR / manual pairing
                              ^
                       React Native mobile
```

### Components

1. **Desktop renderer:** presentation only. It uses a narrow, typed preload IPC API and never opens the database, reads OAuth tokens, binds a socket, or handles LAN bearer credentials.
2. **Desktop main process:** owns the database, migrations, key material, Joystick OAuth, session lifecycle, LAN listener, discovery advertisements, pairing, and sync jobs.
3. **Embedded persistence:** a local transactional store packaged with desktop (SQLite is the default implementation; the repository abstraction must keep the option open for another embedded engine). Database access is main-process-only.
4. **LAN API:** versioned HTTP API bound to the LAN interface by the main process. It is a narrow application protocol, not a general database or remote shell.
5. **Mobile client:** local cache first, then an explicitly paired desktop connection. It never receives database credentials or Joystick provider credentials.

### Non-goals

- No direct mobile-to-SQLite access.
- No generic remote administration endpoint, filesystem browsing, SQL endpoint, or arbitrary proxying.
- No UPnP, SSDP, NAT traversal, port mapping, or internet exposure by default.
- No assumption that mDNS is available or trustworthy enough to authenticate a peer.

## 3. Embedded local persistence

The desktop database is the canonical store for the desktop installation. All writes go through domain services in the main process; UI and LAN handlers cannot issue arbitrary SQL.

### Required properties

- SQLite in WAL mode (or equivalent embedded transactional mode), with schema migrations tracked in a migrations table.
- Database file in the platform application-data directory, not beside the executable or in a renderer-accessible directory.
- File permissions restricted to the OS user; sensitive columns additionally encrypted using a key held by the OS credential store/keychain where practical.
- Atomic transactions for settings, account/session metadata, devices, pairing records, and sync metadata.
- Backups/export are explicit user actions, versioned, and encrypted when they contain account or secret material.
- Corruption detection, safe startup recovery, and a read-only/degraded mode rather than destructive automatic reset.

### Initial logical model

- `schema_metadata`: schema version and migration bookkeeping.
- `settings`: canonical local settings document, revision, updated timestamp, and device/source metadata.
- `sync_outbox`: durable local changes awaiting delivery to a paired peer, with idempotency key and retry state.
- `sync_inbox` or sync cursor metadata: last accepted revision/event per peer.
- `account`: normalized Joystick identity and local account state; never provider client secrets.
- `oauth_transactions`: short-lived state, PKCE verifier, redirect details, expiry, and consumed marker.
- `sessions`: local desktop session metadata and revocation state; refresh material is stored through the secure-store abstraction, not plaintext SQLite.
- `devices`: known mobile devices, public transport keys, pairing status, display name, and last seen time.
- `pairing_codes`: short-lived one-time pairing challenge records, bound to a desktop installation and expiry.
- `audit_events`: security-relevant local events with bounded retention.

The desktop is authoritative for the initial settings scope. Conflict handling is deterministic last-write-wins by server/desktop revision and timestamp, with a stable tie-breaker; retain origin and revision metadata so a future field-level strategy can be added without changing the wire protocol.

## 4. Desktop-owned Joystick OAuth

Joystick identity normalization accepts direct profile fields and the sanitized
`{ channel, bot, permissions }` response family. Candidate precedence is
top-level/envelope user data, channel user identity, channel identity, then bot
identity. Within a source, `user_id`/`userId` precede `id`, `uuid`, account IDs,
channel IDs, and bot IDs; login fields prefer `login`, `username`, `handle`,
user-name aliases, display-name aliases, then `name`. Permissions, capability
metadata, and token fields are never identity. If no stable ID and login/display
name exist, configure `profileEndpoint` or `JOYSTICK_PROFILE_ENDPOINT` to a
real identity endpoint rather than inventing an identity.

### Public-client constraint

An Electron application is distributed to users and runs under a user-controlled environment. Any client secret embedded in the binary, asar, environment file, native module, or renderer bundle can be extracted. Obfuscation, code signing, and encrypted assets do not make it confidential. Therefore:

- Register the desktop integration as a public client if Joystick supports it.
- Use Authorization Code + PKCE with a cryptographically random verifier and challenge (`S256`).
- Bind state to the transaction, desktop installation, expected redirect, and expiry; make it single-use.
- Never put a client secret in desktop code and never design a flow that requires one to remain secret there.
- If Joystick only permits confidential clients, the desktop cannot safely perform that exchange as a standalone app. The product must then add a separately operated broker/service or obtain a Joystick-supported public/native-app flow; silently shipping a secret is rejected.

### Flow

1. Main process creates a transaction with random `state`, PKCE verifier, expiry, and a dynamic loopback redirect on `127.0.0.1`/`[::1]` where supported.
2. Main opens the system browser to Joystick's authorization URL. The renderer receives only progress state.
3. Main validates callback origin, exact state, transaction expiry, and one-time consumption before exchanging the code with PKCE. Callback listeners are closed after success, cancellation, timeout, or error.
4. Main normalizes the Joystick identity and stores only the minimum account/session material needed for the product. Provider access/refresh tokens, if issued, are protected by the OS secure store; they are never returned through IPC or LAN.
5. Main issues/maintains a local desktop account session and starts local sync. Sign-in must not block opening the offline shell.

The loopback listener accepts only the expected path, a single pending transaction, and local connections. Do not use URL fragments, renderer storage, or a fixed broad listener. Cancellation and replay are first-class outcomes.

## 5. LAN API boundaries

The API is served only by the desktop main process and is bound to a chosen LAN address/port. It must be explicit about API version (`/api/v1`) and return capability/version information before resource calls.

### Allowed surface (initial)

- `GET /api/v1/health`: liveness and protocol version; no account data.
- `GET /api/v1/instance`: non-secret instance identity, capabilities, and pairing requirement.
- `POST /api/v1/connection-requests`: creates an opaque, proof-bound pending request; it never returns the six-character confirmation code.
- `GET /api/v1/connection-requests/{id}`: proof-bound non-secret status polling only.
- `POST /api/v1/connection-requests/{id}/session`: proof-bound session retrieval only after desktop-local approval.
- `POST /api/v1/session/refresh` and `POST /api/v1/session/revoke`: device-scoped session lifecycle.
- `GET /api/v1/settings` and `PUT /api/v1/settings`: authenticated settings snapshot/update with revision and idempotency support.
- `POST /api/v1/devices/heartbeat` and `DELETE /api/v1/devices/{id}`: authenticated device registry operations.

The primary app flow does not expose approval or six-character codes through the LAN API. The desktop main process exposes pending metadata and the plaintext code only through its authenticated renderer IPC lifecycle, and requires an independently entered code before approval. Nonterminal requests expire on desktop restart. Legacy `/api/v1/pairing/start` and `/api/v1/pairing/complete` are disabled at the service boundary and cannot issue sessions.

The LAN API does **not** expose Joystick OAuth token exchange, the local database, arbitrary desktop commands, or the desktop's OS identity. OAuth is desktop-only. Mobile uses a paired desktop session.

### Request rules

- JSON, strict schemas, bounded body sizes, request timeouts, replay/idempotency keys for mutations, and structured errors.
- Origin is not an authentication mechanism. Validate method/path/content type and enforce authorization in the main-process service layer.
- Rate-limit pairing, authentication, and mutation endpoints; log security events without secrets.
- After explicit user consent, bind the HTTPS service to all IPv4 interfaces (`0.0.0.0`) by default so it is available through every network interface. `PRISMATA_LAN_HOST` may explicitly restrict the bind to a private RFC1918 IPv4 address, or intentionally select `0.0.0.0`.
- Binding all IPv4 interfaces can expose the service to public/WAN networks. The UI and operator documentation must warn about this; host firewall and network ACL controls remain the operator's responsibility.
- Never advertise `0.0.0.0` in mDNS or QR/manual payloads. Use a reachable interface address or hostname for metadata, and do not automatically open firewall ports or router mappings.
- The HTTPS bind host and discovery host are separate settings: LAN access binds `0.0.0.0` by default, while the main process enumerates eligible non-loopback, non-internal interface addresses for the user to select. The selected advertised address is persisted in desktop settings and is never allowed to be a wildcard or loopback address.

## 6. Discovery and pairing

### Discovery

Advertise the enabled service with **mDNS/DNS-SD** (Bonjour/Avahi-compatible), using a versioned service type such as `_prismata._tcp`, instance name, port, protocol version, and a non-secret instance identifier. The UI reports `advertising` only after publication resolves; publication failures remain visible with a retry action. Re-enabling or changing the selected address stops the old record before publishing exactly one current record. Do not advertise access tokens or pairing secrets.

mDNS is convenience discovery only: names and TXT records can be spoofed, stale, or absent across VLANs. A mobile client must authenticate the desktop transport identity before sending account data.

### Preferred pairing

1. User enables mobile access on desktop and sees a confirmation screen.
2. Desktop creates a short-lived, one-use pairing challenge and renders a QR code containing only the LAN endpoint, instance ID, protocol version, and opaque challenge (or an equivalent bootstrap payload).
3. Mobile scans it, validates the endpoint/instance details, and completes the challenge over the authenticated transport.
4. Both sides generate or retain device key pairs. Desktop records the mobile device public key and issues a device-scoped session/refresh credential.
5. Desktop displays the new device and requires explicit approval when policy/configuration calls for confirmation.

The current implementation has an explicit remaining integration blocker: the secure LAN boundary does not yet deliver the desktop-local code to mobile, so mobile instructs the user to read the desktop code rather than rendering the same value. Do not mark this flow complete until a reviewed encrypted code-delivery channel is implemented; never solve it by returning the code from an unauthenticated LAN response.

### Fallback


## 7. Device-scoped authentication and transport identity

Pairing establishes a device identity; account authentication and transport authentication are separate checks.

- Each installation has a long-lived transport identity key pair generated locally and protected by the OS secure store where possible. The desktop advertises its public-key fingerprint.
- Each mobile installation has its own device key pair. The desktop stores the public key, device ID, created/revoked timestamps, and last seen time.
- Use TLS on the LAN with a desktop certificate bound to the transport key, or an equivalent authenticated encrypted channel. The mobile pins the first approved desktop public key/fingerprint from QR/manual pairing and rejects changes unless the user explicitly re-pairs.
- A paired session is scoped to `(desktop installation, account, device ID)` and has short-lived access material plus a rotated/revocable refresh credential. Store mobile credentials in platform secure storage.
- Every authenticated request binds the session to the device and, where supported, signs or MACs method/path/body hash/timestamp/request ID to reduce replay and credential forwarding.
- Revoke one device without invalidating other devices. Re-pairing after key loss is an explicit user action; never auto-trust a changed key.
- LAN possession is not account authorization. A discovered endpoint without a valid device session has access only to non-sensitive health/instance metadata.

## 8. Local-first settings sync

The desktop and mobile each render local settings immediately. Network sync is an eventual consistency service, not a prerequisite for startup.

- Local writes commit first, then enqueue an outbox operation.
- Pull returns canonical document, revision, updated time, and origin metadata. Push includes base revision, complete document or supported patch, idempotency key, and client timestamp.
- Desktop serializes canonical writes and returns the resulting revision. A stale base revision returns a conflict response or applies the documented deterministic last-write-wins rule; clients must reconcile from the canonical response.
- Retries use exponential backoff and idempotency keys. Duplicate delivery must not duplicate effects.
- Offline changes remain queued across restart; logout/revoke clears only credentials, not user settings. A user-visible sync status distinguishes local-only, syncing, synced, and conflict/error.
- Device registry heartbeats are best effort and must not prevent settings use.

## 9. Lifecycle, failure, and security

### Startup/shutdown

1. Main process acquires/opens the database, runs non-destructive migrations, loads secure keys, and starts the renderer.
2. Renderer gets a state snapshot through preload; it never waits on network auth.
3. LAN service/discovery start only when enabled and after transport identity initialization.
4. Graceful shutdown stops discovery/listener, flushes bounded local transactions, and closes the database. Crash recovery replays WAL and resumes outbox work.

### Security requirements

- Context isolation, sandboxed renderer where feasible, no unrestricted Node integration, and a minimal allowlisted IPC surface.
- Secure-store failure means sensitive operations fail closed; do not fall back to plaintext token storage.
- Protect against CSRF where browser-based local flows exist, DNS rebinding/Host confusion, request smuggling, oversized payloads, and pairing brute force.
- Treat all LAN input as hostile. Validate schemas and enforce per-device authorization on every data route.
- Provide visible controls to enable/disable LAN access, list/revoke devices, rotate transport identity, and clear all paired credentials.
- Minimize and rotate logs; never log OAuth codes, PKCE verifiers, refresh tokens, pairing codes, session tokens, or full settings documents.
- Keep desktop releases signed and updateable, but do not treat signing as a replacement for public-client OAuth or transport authentication.

## 10. Migration and deprecation

The existing Node/Express backend, Postgres schema, Supabase paths, and Docker deployment are transitional and are not part of the target architecture.

### Migration strategy

1. Freeze new backend/Postgres features; inventory data, auth accounts, sessions, settings, and device records.
2. Add a one-time, user-consented export/import path that converts backend settings and account metadata into the desktop schema. Do not copy server password/secret material into the desktop database.
3. Complete desktop local persistence and migrations before removing remote reads. Preserve source revision/timestamps for deterministic reconciliation.
4. Introduce LAN API, discovery, pairing, and device-scoped sessions behind a feature flag; test with mobile against desktop while the old path remains available for rollback.
5. Migrate Joystick sign-in to desktop-owned PKCE. Existing backend sessions are not imported as trusted desktop credentials; require re-authentication or a separately verified migration handoff.
6. Move mobile settings sync to the LAN API and validate offline/restart/revocation behavior.
7. Announce deprecation, stop accepting new backend sessions, provide export/backup, then retire backend auth and sync endpoints.
8. Archive/remove Postgres migrations, Docker compose/deployment instructions, Supabase auth helpers, and backend-only environment requirements only after migration telemetry and rollback windows complete. Retain a read-only migration utility if support requires it.

No migration step may silently delete local data or weaken the transport trust model. If a desktop has no reachable legacy backend, it must still open and operate on imported/local data.

## 11. Implementation phases and exit criteria

### Phase 0 — contracts and threat model

Define schema migrations, API OpenAPI/types, error/revision semantics, key lifecycle, pairing UX, and threat model. Exit when desktop/mobile contracts and public-client OAuth decision are reviewed.

### Phase 1 — desktop persistence

Implement main-process repository, encrypted/secure-store adapter, migrations, backups, corruption handling, and local-first settings/outbox. Exit when the desktop works without any backend or network.

### Phase 2 — desktop Joystick auth

Implement public-client PKCE, loopback callback, transaction replay/expiry checks, secure session storage, sign-out/revocation, and offline startup. Exit when no provider secret or token exchange code is in renderer/mobile bundles.

### Phase 3 — LAN transport and pairing

Implement TLS/transport identity, fingerprint pinning, mDNS/DNS-SD, QR pairing, manual fallback, device-scoped sessions, rate limits, and revocation. Exit when spoofed discovery, changed keys, replayed codes, and revoked devices are rejected.

### Phase 4 — API and mobile sync

Implement the narrow `/api/v1` surface, mobile local cache/outbox, pull/push reconciliation, heartbeat, and capability negotiation. Exit when mobile can pair, work offline, sync settings idempotently, and recover after desktop restart.

### Phase 5 — migration and retirement

Ship consented import, dual-path validation, feature flags, support/export tooling, and deprecation notices. Exit when migrated users have verified local data and the standalone backend/Postgres/Docker path can be shut down without loss.

## 12. Architectural invariants

1. Electron main process, not renderer or mobile, owns local data and Joystick OAuth.
2. A confidential client secret never ships in a desktop binary.
3. LAN discovery never grants access; pairing and pinned transport identity do.
4. Every data request is device-scoped and revocable.
5. Local settings remain usable without Joystick, LAN, mDNS, or a running server.
6. The LAN API exposes application capabilities only, never database primitives.
7. No UPnP or automatic internet exposure is introduced.
