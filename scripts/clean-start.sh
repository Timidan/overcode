#!/usr/bin/env bash
# Clean restart for Overcode dev.
#
# Wipes Vite + renderer-bundle caches (the things that cause stale UI),
# then launches either:
#   • dev (default) — vite + vite-plugin-electron (boots the Electron window)
#   • dev:browser    — vite + IPC bridge stub on the next available local port (no Electron)
#
# IMPORTANT: We never wipe dist-electron. The Electron launcher reads
# package.json's `main` (dist-electron/main.js) when starting; if the file
# is missing on a cold start, vite-plugin-electron loses the race against
# the launcher and the dev session exits with MODULE_NOT_FOUND. The main.js
# bundle from the *previous* session is re-used; vite-plugin-electron will
# overwrite it incrementally as files change.
#
# We also force ELECTRON_RUN_AS_NODE=unset (see below). Some agent runtimes
# set it to 1, which makes Electron's main process load as plain Node and
# crash with `TypeError: Cannot read properties of undefined (reading 'on')`
# when calling app.on(...). Forcing it off makes the script work from any
# parent environment.
#
# Flags:
#   --browser           Use dev:browser mode (no Electron, local Vite URL printed on start).
#   --reset-user-data   Also wipe ~/.config/overcode (auth tokens, settings).

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT="$(cd "${SCRIPT_DIR}/.." && pwd)"
cd "${ROOT}"

USE_BROWSER=0
KEEP_USER_DATA=1

for arg in "$@"; do
  case "$arg" in
    --browser)          USE_BROWSER=1 ;;
    --reset-user-data)  KEEP_USER_DATA=0 ;;
    -h|--help)
      cat <<EOF
Usage: scripts/clean-start.sh [--browser] [--reset-user-data]

  --browser           Skip Electron, run \`npm run dev:browser\` instead.
                      Renderer URL is printed on start with IPC stubs.
  --reset-user-data   Wipe ~/.config/overcode (auth tokens, electron-store).

Always:
  1. Kills running Overcode electron + vite processes
  2. Wipes dist/, node_modules/.vite, node_modules/.cache
  3. Leaves dist-electron alone (see comment in script for why)
  4. Launches the chosen dev script
EOF
      exit 0
      ;;
    *)
      echo "Unknown arg: $arg" >&2
      echo "Run with --help for usage." >&2
      exit 2
      ;;
  esac
done

# Some agent/sandbox environments set ELECTRON_RUN_AS_NODE=1 to prevent
# child processes from opening GUI windows. That makes `require("electron")`
# in the main process return a path string instead of the API module, so
# Electron crashes with TypeError at H.app.on(...). Force GUI mode here.
unset ELECTRON_RUN_AS_NODE

echo "→ killing running Overcode electron + vite processes"
pkill -f "${ROOT}/node_modules/electron/dist/electron" 2>/dev/null || true
pkill -f "${ROOT}/node_modules/.bin/vite" 2>/dev/null || true
pkill -f "${ROOT}/node_modules/vite/bin/vite.js" 2>/dev/null || true
pkill -f "scripts/dev-browser.mjs" 2>/dev/null || true
sleep 0.5

echo "→ wiping renderer dist + Vite caches (keeping dist-electron)"
rm -rf \
  "${ROOT}/dist" \
  "${ROOT}/node_modules/.vite" \
  "${ROOT}/node_modules/.cache"

if [[ "${KEEP_USER_DATA}" -eq 0 ]]; then
  echo "→ resetting Electron user data (~/.config/overcode)"
  rm -rf "${HOME}/.config/overcode"
fi

if [[ ! -f "${ROOT}/dist-electron/main.js" && "${USE_BROWSER}" -eq 0 ]]; then
  cat >&2 <<EOF
✘ dist-electron/main.js is missing.

  Electron boots before vite-plugin-electron finishes building main.ts
  on a cold start, so it will exit with MODULE_NOT_FOUND.

  Options:
    • Run \`npm run build\` once to bootstrap dist-electron/, then re-run this.
    • Or run with --browser to use the Electron-free dev mode.
EOF
  exit 3
fi

if [[ "${USE_BROWSER}" -eq 1 ]]; then
  echo "→ launching npm run dev:browser"
  exec npm run dev:browser
fi

echo "→ launching npm run dev"
exec npm run dev
