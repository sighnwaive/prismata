# Prismata

Prismata is a pnpm monorepo for an Electron desktop app, a React Native mobile companion, a static website, and shared TypeScript packages.

## Target runtime

The Electron desktop main process is Prismata's local authority. It owns embedded local persistence, Joystick OAuth, the optional restricted LAN API, discovery, pairing, and sync policy. Mobile connects to a paired desktop on the same LAN.

- `apps/desktop`: Electron app and main-process authority
- `apps/mobile`: React Native mobile companion
- `apps/web`: static product website, built with Vite and hosted on GitHub Pages
- `packages/core`: shared non-UI TypeScript code
- `packages/sync`: shared local-first sync and protocol helpers
- `packages/ui`: shared UI-facing TypeScript exports
- `docs/architecture/desktop-owned-architecture.md`: authoritative architecture

The target runtime has no standalone backend app, Postgres dependency, Docker-hosted Prismata API, or always-on cloud service. Existing `apps/backend`, `db`, `supabase`, and compose files are transitional migration/history artifacts and are not required to run the target product.

## Getting started

1. Install `pnpm` and the native prerequisites for Electron and React Native.
2. Run `pnpm install` from the repo root.
3. Run `pnpm run check:workspaces` and the applicable package checks.
4. Start the desktop app using the workspace's Electron development command when available.
5. For mobile development, use the generated React Native platform workflow and pair with a desktop that has LAN access explicitly enabled.

### Website

Run `pnpm web:dev` to preview the website locally and `pnpm web:build` to create its static production site in `apps/web/dist/`. The `Deploy website to GitHub Pages` workflow builds and publishes it when changes are pushed to `main`. In the repository's **Settings → Pages**, set the build and deployment source to **GitHub Actions** before the first deployment. Project-site paths are configured from the repository name during the production build.

### Android debug setup

Run `pnpm --filter @prismata/mobile run android:prepare` before a local Android debug build. The command creates the standard ignored `apps/mobile/android/app/debug.keystore` only when absent; it never creates or changes release signing credentials. The `android` workflow invokes this preparation automatically.

Desktop development configuration is local-only. The Electron dev script loads `.env` through dotenvx. Set the public Joystick OAuth client ID as `JOYSTICK_CLIENT_ID`; desktop does not require or consume `JOYSTICK_CLIENT_SECRET`. The checked-in dotenvx fixture at `scripts/fixtures/dotenvx-desktop.env` is safe test data.

### Desktop production builds

Run `pnpm --filter @prismata/desktop build` on the target OS to type-check and create a production package in `apps/desktop/release/`. It creates a Windows NSIS installer, Linux AppImage, or macOS DMG, depending on the host. The explicit commands are `build:win`, `build:linux`, and `build:mac` (run each on its corresponding OS because Electron/native dependencies are platform-specific). The `Desktop production builds` GitHub Actions workflow builds all three targets on native runners when manually dispatched or when a `v*` tag is pushed. Set the `JOYSTICK_CLIENT_ID` Actions secret; the workflow validates it and injects Joystick runtime configuration into each packaged app. `JOYSTICK_SCOPES` and `JOYSTICK_PROFILE_ENDPOINT` are optional secrets that override their built-in defaults. The client ID is a public OAuth client identifier and is embedded in distributed installers; never provide `JOYSTICK_CLIENT_SECRET`. Configure the workflow's Windows and Apple signing secrets to sign installers; without certificates, packages are unsigned.

Desktop local settings must work without network access. Joystick sign-in is optional for opening and using the offline desktop shell. Mobile uses its local cache while the desktop, LAN, Joystick, or mDNS/DNS-SD is unavailable, then retries queued sync when connectivity returns.

### Development Joystick event diagnostics

Unpackaged desktop development builds append complete, unredacted Joystick gateway event envelopes (including viewer identifiers and message contents) to `logs/joystick-events-YYYY-MM-DD.jsonl` inside Electron's `userData` directory. This is **development-only**: local diagnostic files are not written by packaged/production builds and are pruned after 30 days. Protect them like private account data; normal operating-system app-data permissions apply. There is **no size cap**, so disk use depends on gateway event volume.

Unpackaged builds also emit structured console diagnostics for app-owned Joystick OAuth HTTP, public chat/whisper HTTP, and gateway WebSocket traffic. Console payloads are recursively redacted (including tokens, OAuth codes/state/PKCE verifier, credentials, header values, and sensitive URL query values); packaged builds emit no new traffic diagnostics. OAuth console entries cover only Prismata's browser handoff and loopback callback metadata—not HTTP requests made by the browser. These sanitized console diagnostics are separate from the intentionally unredacted local JSONL event log: raw event envelopes are never piped to the console.

The platform `userData` locations for the Prismata app are:

- **Windows:** `%APPDATA%\Prismata` (typically `%APPDATA%` is `C:\Users\<you>\AppData\Roaming`)
- **macOS:** `~/Library/Application Support/Prismata`
- **Linux:** `$XDG_CONFIG_HOME/Prismata`, or `~/.config/Prismata` when `XDG_CONFIG_HOME` is unset

Find the current path with Electron `app.getPath('userData')`; append `/logs/joystick-events-YYYY-MM-DD.jsonl` to that path. These logs can contain private event data and should be reviewed before sharing.

## Authentication and pairing

Desktop OAuth is allowed only if Joystick supports a public/native Authorization Code + PKCE client. A confidential client secret must never be placed in the desktop binary, packaged resources, renderer bundle, or desktop environment. If Joystick requires a secret, direct desktop OAuth is not a valid implementation.

The desktop client uses Joystick's authorize endpoint at `https://joystick.tv/api/oauth/authorize`, token endpoint at `https://api.joystick.tv/api/oauth/token`, and profile endpoint at `https://api.joystick.tv/api/v1/me`. The registered redirect URI must be exactly `http://127.0.0.1:43110/auth/callback`. The desktop main process stores the provider session in Electron OS-backed `safeStorage`; renderer snapshots never contain provider tokens. Live sign-in still requires a valid `JOYSTICK_CLIENT_ID` registered for that exact public-client redirect. The LAN certificate identity is unrelated and is never used for the Joystick OAuth callback.

When enabled by the user, desktop discovery uses mDNS/DNS-SD, not UPnP. Pair mobile using the displayed QR code or the manual endpoint/challenge fallback. Pairing pins the desktop transport identity and issues device-scoped credentials stored in platform secure storage; discovery alone never grants access.

LAN binding defaults to all IPv4 interfaces (`0.0.0.0`) so the desktop is reachable from every local network interface. Set `PRISMATA_LAN_HOST` to an explicit private RFC1918 IPv4 address to restrict the bind. The server still uses HTTPS, fingerprint pinning, short-lived one-use pairing, and device revocation; discovery and QR/manual endpoints use a reachable interface address or hostname, never `0.0.0.0`. Binding all interfaces can expose the service to public/WAN networks, so use an appropriate host firewall and network ACLs, and disable LAN access when it is not needed. Prismata never performs UPnP, NAT traversal, or router port mapping.

## Historical artifacts

The `supabase/`, `db/`, `apps/backend/`, and compose files may be retained for migration tooling and historical context. Do not add new runtime behavior or setup instructions based on them. Use the consented migration/export path described in `Prismata.prd` and the authoritative desktop-owned architecture instead.
