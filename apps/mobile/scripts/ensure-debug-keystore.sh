#!/usr/bin/env sh
set -eu

script_dir=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
keystore=${1:-"$script_dir/../android/app/debug.keystore"}

if [ -e "$keystore" ]; then
    [ -f "$keystore" ] || {
        printf '%s\n' "Debug keystore path is not a regular file: $keystore" >&2
        exit 1
    }
    exit 0
fi

command -v keytool >/dev/null 2>&1 || {
    printf '%s\n' 'Java keytool is required to generate the Android debug keystore' >&2
    exit 1
}

umask 077
mkdir -p "$(dirname -- "$keystore")"
keytool -genkeypair \
    -alias androiddebugkey \
    -keyalg RSA \
    -keysize 2048 \
    -validity 10000 \
    -keystore "$keystore" \
    -storetype JKS \
    -storepass android \
    -keypass android \
    -dname 'CN=Android Debug,O=Android,C=US' \
    -noprompt >/dev/null 2>&1

chmod 600 "$keystore"
printf '%s\n' "Created local Android debug keystore: $keystore"
