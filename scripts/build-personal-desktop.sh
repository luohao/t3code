#!/bin/bash
# Build the committed checkout as an unsigned arm64 DMG, without an update feed.
set -euo pipefail

if [[ "${1:-}" == "--help" || "${1:-}" == "-h" ]]; then
  printf 'Usage: %s [revision]\n' "$0"
  printf 'Revision defaults to a UTC timestamp. Artifacts go to release/.\n'
  exit 0
fi

revision="${1:-$(date -u +%Y%m%d%H%M%S)}"
if [[ $# -gt 1 || ! "$revision" =~ ^[1-9][0-9]*$ ]]; then
  printf 'Expected one positive integer revision, or no arguments.\n' >&2
  exit 1
fi

cd "$(dirname "$0")/.."

# Use the dedicated installation on this Mac when vp is not already on PATH.
if ! command -v vp >/dev/null 2>&1 && [[ -x "$HOME/.local/share/t3code-vite/bin/vp" ]]; then
  export VP_HOME="$HOME/.local/share/t3code-vite"
  export PATH="$VP_HOME/bin:$PATH"
fi
if ! command -v vp >/dev/null 2>&1; then
  printf 'Install Vite+ and put vp on PATH before building.\n' >&2
  exit 1
fi

# The app embeds HEAD; require it to identify the actual source being packaged.
if [[ -n "$(git status --porcelain)" ]]; then
  printf 'Commit or stash source changes before making a personal build.\n' >&2
  exit 1
fi

base_version="$(node -p "require('./apps/desktop/package.json').version")"
if [[ "$base_version" == *-* ]]; then
  build_version="$base_version.personal.$revision"
else
  build_version="$base_version-personal.$revision"
fi
artifact_stem="release/T3-Code-$build_version-arm64"
if [[ -e "$artifact_stem.dmg" || -e "$artifact_stem.zip" ]]; then
  printf 'Artifacts already exist for %s; choose a new revision.\n' "$build_version" >&2
  exit 1
fi

printf 'Building %s from %s\n' "$build_version" "$(git rev-parse --short HEAD)"
vp install --frozen-lockfile
if [[ -n "$(git status --porcelain)" ]]; then
  printf 'Dependency installation changed source; review and commit it before building.\n' >&2
  exit 1
fi

# A personal build must keep its patches when upstream publishes a new release.
exec env -u T3CODE_DESKTOP_UPDATE_REPOSITORY -u GITHUB_REPOSITORY \
  NODE_USE_SYSTEM_CA=1 \
  T3CODE_DESKTOP_SIGNED=false \
  T3CODE_DESKTOP_SKIP_BUILD=false \
  T3CODE_DESKTOP_MOCK_UPDATES=false \
  vp run dist:desktop:dmg:arm64 \
  --build-version "$build_version" --output-dir release --keep-stage
