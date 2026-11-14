# TODO: QR and Manual Pairing UI

Scope: UI work only. Do not move persistence, pairing authority, credentials, TLS, or discovery into a renderer or mobile UI.

Legend:

- [x] Implemented in the current desktop-owned service/discovery/TLS foundation.
- [ ] Remaining UI or UI-integration work.

## Desktop enable-LAN flow

- [x] Keep LAN disabled by default; the lifecycle requires an explicit enable action and a private LAN host.
- [x] Start the restricted HTTPS service only after LAN enablement and advertise `_prismata._tcp` through mDNS/DNS-SD.
- [x] Expose typed desktop status, LAN enable/disable, device listing, and device revocation operations through preload IPC.
- [ ] Add the desktop Settings > Mobile access entry point with clear disabled, starting, enabled, stopping, and failed states.
- [ ] Explain that enabling access exposes only the private LAN interface, never WAN/UPnP/router mappings, and requires pairing.
- [ ] Show the selected host, HTTPS endpoint, protocol version, discovery status, and transport fingerprint after enablement.
- [ ] Provide retry guidance when the host is unavailable, binding fails, mDNS fails, or TLS identity loading fails; do not imply that discovery failure disables the LAN service.
- [ ] Add explicit disable confirmation and explain that disabling stops new connections while existing device credentials must be revoked separately when appropriate.

## QR payload and expiry

- [x] The service creates an opaque, one-use pairing challenge with a 120-second expiry and consumes it on completion.
- [x] The desktop exposes the instance ID and transport fingerprint through the instance/discovery metadata needed for verification.
- [ ] Define and version the QR payload contract: HTTPS LAN endpoint, instance ID, protocol version, opaque challenge, and desktop fingerprint or equivalent identity metadata only.
- [ ] Do not put access tokens, refresh tokens, private keys, OAuth material, settings, or other secrets in the QR payload.
- [ ] Render the QR only while LAN pairing is enabled; show its expiry countdown and the exact expiration time in accessible text.
- [ ] Add a refresh/regenerate action that invalidates the prior challenge and clearly states that the old QR can no longer be used.
- [ ] Handle expired, already-used, malformed, unsupported-version, mismatched-instance, and mismatched-fingerprint payloads with actionable errors.
- [ ] Make the QR payload copyable/exportable only through an intentional user action and avoid logging or analytics capture of its challenge.

## Manual pairing fallback

- [x] The service accepts the same short-lived challenge at `/api/v1/pairing/complete`; discovery is not required for the service contract.
- [ ] Add a desktop "Use manual pairing" view showing the short-lived endpoint/challenge in a copy-friendly, human-readable format.
- [ ] Add mobile manual entry for endpoint plus code/challenge, with formatting that tolerates spaces or hyphens but submits the canonical value.
- [ ] Use the exact same expiry, one-use, instance validation, fingerprint verification, explicit approval, and device-credential rules as QR pairing.
- [ ] Never make manual pairing a plaintext HTTP or no-fingerprint fallback; reject non-HTTPS endpoints and missing identity verification.
- [ ] Provide copy, paste, clear, retry, and expired-code recovery actions without exposing credentials in screenshots, logs, or clipboard history longer than necessary.

## Mobile discovery and pairing screens

- [ ] Build a discovery screen that searches mDNS/DNS-SD for `_prismata._tcp`, lists display name/instance/host/status, and labels discovery as convenience rather than trust.
- [ ] Add scan screen with camera preview, QR parsing, payload validation, scan cancellation, flashlight control where supported, and a manual-entry link.
- [ ] Add manual endpoint/code entry screen with field-level validation and a clear offline/discovery-unavailable explanation.
- [ ] Add a desktop details screen before connection: display name, endpoint/host, instance ID, protocol version, challenge expiry, and fingerprint.
- [ ] Add a pairing progress screen for connect, challenge completion, key exchange, desktop approval, credential receipt, and finalization.
- [ ] Add success screen showing the paired desktop and device name, then route to local-first settings without blocking on sync.
- [ ] Add cancel/back behavior that does not leave a pending challenge or partially stored credential.
- [ ] Support multiple discovered desktops and make the selected instance unambiguous before pairing.
- [ ] Treat a missing or stale mDNS record as expected; preserve QR/manual entry when discovery is unavailable or networks are segmented.

## Fingerprint confirmation

- [x] Desktop transport identity is persisted, served over HTTPS, and represented by a SHA-256 certificate fingerprint.
- [x] Shared transport code requires HTTPS and a certificate pin verifier, and rejects a changed fingerprint.
- [ ] Present the fingerprint in a human-verifiable grouped format with a copy action and accessible text alternative.
- [ ] Require explicit mobile confirmation that the displayed fingerprint matches the desktop before sending account data or accepting credentials.
- [ ] Show a prominent changed-key warning and offer only cancel/re-pair/explicit identity reset; never silently accept a new key.
- [ ] Explain that mDNS, IP address, LAN possession, and Origin are not authentication.
- [ ] Handle the architecture's manual-identity-verification marker with a blocking verification screen rather than an auto-trust path.

## Loading, error, and offline states

- [ ] Cover loading states for LAN enablement, challenge generation, discovery, camera startup, endpoint validation, TLS verification, pairing, approval, and device refresh.
- [ ] Disable duplicate submissions and make retry actions idempotent from the user's perspective.
- [ ] Distinguish expired challenge, rejected challenge, wrong desktop, changed fingerprint, unsupported protocol, permission denied, timeout, refused connection, TLS failure, rate limit, and generic service failure.
- [ ] Provide offline/local-only states on mobile: local settings remain usable, queued changes remain queued, and sync resumes when the desktop is reachable.
- [ ] Show desktop discovery/mDNS unavailable separately from desktop LAN service unavailable.
- [ ] Preserve entered non-secret form values where safe, but clear challenges and credentials on cancellation, expiry, logout, or failed verification.
- [ ] Ensure every error has recovery guidance and does not reveal tokens, private keys, full settings, or sensitive server details.

## Device list and revoke UI

- [x] The desktop-owned service stores device records, lists devices, tracks heartbeat metadata, and supports independent device revocation.
- [x] Desktop preload exposes typed list and revoke operations.
- [ ] Build desktop paired-devices list with device name, platform when available, created/last-seen status, and current/revoked state.
- [ ] Add per-device revoke action with confirmation, clear consequences, success state, and retry/error handling.
- [ ] Refresh the list after pairing, revocation, restart, and reconnect; do not treat heartbeat failure as revocation.
- [ ] Add mobile self-revoke/sign-out UI and explain that revocation invalidates that device's sessions without removing other devices.
- [ ] Add recovery UX for lost mobile keys, changed desktop keys, and the need to explicitly re-pair.

## Platform permissions

- [ ] Request camera permission only when the scan screen is entered; explain why it is needed and provide a manual fallback when denied.
- [ ] Handle camera unavailable, restricted, revoked, simulator, and hardware failure states on iOS and Android.
- [ ] Document and configure Android/iOS camera permission declarations and any local-network/nearby-device permissions required by mDNS/DNS-SD.
- [ ] Handle desktop firewall/private-network prompts without suggesting automatic port opening; explain that the user may need to allow the app on the private network.
- [ ] Provide platform-specific settings links or recovery instructions when a previously granted permission is later denied.

## Accessibility and security constraints

- [ ] Make all pairing steps keyboard, screen-reader, switch, and large-text accessible; do not make QR scanning the only path.
- [ ] Announce countdown, discovery updates, validation errors, pairing progress, completion, and revocation results through accessible status regions.
- [ ] Provide a high-contrast, scalable fingerprint and code presentation; do not rely on color, camera focus rings, or visual QR state alone.
- [ ] Use safe clipboard behavior, redact secrets from UI telemetry, and prevent screenshots/screen capture where platform policy and product requirements allow.
- [ ] Keep renderer/mobile UI limited to typed commands and protocol data; never expose database access, OAuth tokens, private transport keys, or unrestricted IPC.
- [ ] Enforce HTTPS, fingerprint pinning, strict payload/version validation, bounded inputs, expiry, one-use challenges, rate-limit feedback, and explicit approval in the UI contract.
- [ ] Confirm that no UI copy or diagnostics instruct users to disable TLS, use HTTP, trust an unknown fingerprint, or expose the service to WAN.
- [ ] Review QR/manual pairing copy and telemetry for accidental collection of endpoints, challenges, fingerprints, credentials, or full settings documents.

## Tests

- [ ] Add desktop UI tests for LAN enable/disable, private-host failure, service-start failure, mDNS failure, status transitions, QR rendering, countdown, regeneration, and expiry.
- [ ] Add QR contract tests for required fields, versioning, no-secret payloads, malformed input, wrong instance, replay, one-use, and expiry behavior.
- [ ] Add manual fallback tests for normalization, invalid endpoint/code, HTTPS-only enforcement, expiry, replay, and equivalent fingerprint checks.
- [ ] Add mobile discovery tests for valid/invalid mDNS records, duplicate desktops, no discovery, stale records, and manual fallback.
- [ ] Add scanner/permission tests for grant, deny, revoke, unavailable camera, malformed QR, cancel, and retry.
- [ ] Add fingerprint tests for first approval, matching key, changed key, missing identity, explicit re-pair, and no auto-trust.
- [ ] Add device-management tests for list refresh, independent revoke, self sign-out, revoked-session failure, and other-device continuity.
- [ ] Add loading/error/offline tests covering timeouts, TLS errors, rate limits, desktop restart, LAN loss, mDNS loss, queued local edits, and recovery.
- [ ] Add accessibility tests for keyboard navigation, focus order, labels, announcements, contrast, text scaling, and non-QR alternatives.
- [ ] Add platform smoke tests on supported desktop/mobile OSes for camera, local-network permissions, firewall guidance, QR scanning, and manual pairing.
- [ ] Run existing desktop service, discovery, TLS, lifecycle, and sync transport tests as regression coverage; keep UI tests separate from service authority tests.
