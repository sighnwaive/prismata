# Architecture

`docs/architecture/**` is the source of truth for architecture in this repository.

Use this directory as the main working area for architectural notes, decisions, and plans that other agents can read later.

## Authoritative handoff

- [`desktop-owned-architecture.md`](./desktop-owned-architecture.md) defines the target architecture: Electron-owned local persistence and Joystick PKCE, the LAN API, pairing/discovery, device-scoped transport security, local-first sync, migration, and implementation phases.
- `desktop-joystick-auth.md` is a historical backend-owned plan and must not be used for new implementation work; its backend/Postgres assumptions are superseded by the handoff above.
