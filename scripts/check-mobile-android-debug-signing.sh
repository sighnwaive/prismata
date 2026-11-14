#!/usr/bin/env sh
set -eu

repo_root=$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)
setup_script="$repo_root/apps/mobile/scripts/ensure-debug-keystore.sh"
gradle_config="$repo_root/apps/mobile/android/app/build.gradle"
temp_dir=$(mktemp -d)
trap 'rm -rf "$temp_dir"' EXIT
keystore="$temp_dir/debug.keystore"

[ -x "$setup_script" ] || {
    printf '%s\n' "Debug keystore setup script is missing or not executable: $setup_script" >&2
    exit 1
}

"$setup_script" "$keystore"
first_hash=$(sha256sum "$keystore" | cut -d ' ' -f 1)
"$setup_script" "$keystore"
second_hash=$(sha256sum "$keystore" | cut -d ' ' -f 1)
[ "$first_hash" = "$second_hash" ] || {
    printf '%s\n' 'Debug keystore setup is not idempotent' >&2
    exit 1
}

keytool -list -v -keystore "$keystore" -storepass android -alias androiddebugkey 2>/dev/null |
    grep -q 'Alias name: androiddebugkey'
keytool -list -keystore "$keystore" -storepass android -alias androiddebugkey >/dev/null 2>&1
keytool -importkeystore \
    -srckeystore "$keystore" \
    -srcstoretype JKS \
    -srcstorepass android \
    -srckeypass android \
    -srcalias androiddebugkey \
    -destkeystore "$temp_dir/key-password-check.keystore" \
    -deststoretype JKS \
    -deststorepass verify \
    -destkeypass verify \
    -destalias androiddebugkey \
    -noprompt >/dev/null 2>&1

grep -q "storeFile file('debug.keystore')" "$gradle_config"
grep -q "storePassword 'android'" "$gradle_config"
grep -q "keyAlias 'androiddebugkey'" "$gradle_config"
grep -q "keyPassword 'android'" "$gradle_config"
grep -q 'signingConfig signingConfigs.debug' "$gradle_config"
! sed -n '/release[[:space:]]*{/,/^[[:space:]]*}/p' "$gradle_config" | grep -q 'signingConfig signingConfigs.debug'

printf '%s\n' 'Mobile Android debug signing check passed'
