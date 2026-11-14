# Mobile TLS Pinning

The Android certificate-pin request contract requires `connect()`, peer certificate fingerprint validation, and only then request-body transmission. The executable mobile test validates that source ordering and the production JS transport selection, while Kotlin compilation validates the native implementation.

The test environment does not provide an Android device or a live TLS server, so it cannot observe encrypted bytes on the wire or prove a real server-side mismatch response. Device-level validation with a mismatched certificate remains an operational test requirement.
