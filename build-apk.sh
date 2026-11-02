#!/bin/bash
# Unsigned Android release build. Signing is optional; see README.
set -euo pipefail

ROOT="$(cd "$(dirname "$0")" && pwd)"
cd "$ROOT"

if [[ -z "${JAVA_HOME:-}" ]]; then
  if [[ -d /usr/lib/jvm/java-17-openjdk-amd64 ]]; then
    export JAVA_HOME=/usr/lib/jvm/java-17-openjdk-amd64
  fi
fi

echo "JAVA_HOME=${JAVA_HOME:-unset}"
node --version

if [[ ! -d node_modules ]]; then
  yarn install
fi

cd "$ROOT/android"
./gradlew assembleRelease --no-daemon

APK="$(find app/build/outputs/apk/release -name '*.apk' | head -n 1 || true)"
if [[ -z "$APK" ]]; then
  echo "assembleRelease finished without an APK" >&2
  exit 1
fi

echo "APK: $APK"
