#!/bin/bash
# Starts Benji GTM on this Mac and opens it in your browser.
# Run it from Terminal:   bash start.command
# The first start installs what the app needs and prepares it (a few minutes). So does the first
# start after an update (git pull). Other starts take a few seconds.
set -euo pipefail
cd "$(dirname "$0")"
ROOT="$(pwd)"
LOG="$ROOT/start-log.txt"
# While the app runs from this folder: its process id, then (once chosen) its port. A second start
# reads it and opens the running app instead of preparing the app again underneath it.
LOCK="$ROOT/.app-running"

say() { printf '\n%s\n' "$1"; }
fail() { printf '\nThe app could not start: %s\n' "$1" >&2; exit 1; }

# 1. Node.js 22 or newer
if ! command -v node >/dev/null 2>&1; then
  fail "Node.js is not installed.
What to do: open https://nodejs.org, download the LTS version, open the downloaded file and click through it.
Then close this window, open a new Terminal window and run the same line again."
fi
NODE_MAJOR="$(node -p 'process.versions.node.split(".")[0]' 2>/dev/null || echo 0)"
case "$NODE_MAJOR" in ''|*[!0-9]*) NODE_MAJOR=0 ;; esac
if [ "$NODE_MAJOR" -lt 22 ]; then
  fail "Node.js $(node -v 2>/dev/null) is too old. Version 22 or newer is needed.
What to do: open https://nodejs.org, download the LTS version, open the downloaded file and click through it.
Then close this window, open a new Terminal window and run the same line again."
fi
if ! command -v npm >/dev/null 2>&1; then
  fail "npm, which comes with Node.js, was not found.
What to do: install the LTS version of Node.js again from https://nodejs.org, then run the same line again."
fi
if [ ! -d "$ROOT/studio" ] || [ ! -d "$ROOT/supabase/migrations" ]; then
  fail "part of the app's folder is missing.
What to do: run start.command from inside the app's folder (the one you cloned from GitHub, with the studio and supabase folders in it).
If those folders really are missing, clone your copy again (see \"Clone it\" in README.md)."
fi

# 2. Already running (or starting) from this folder? A second window must not install or prepare the
#    app again: that rebuilds it while it is in use and empties start-log.txt.
answers() { curl -s -o /dev/null --max-time 2 "http://127.0.0.1:$1/" >/dev/null 2>&1; }
if [ -f "$LOCK" ]; then
  RUNNING_PID="$(sed -n 1p "$LOCK" 2>/dev/null || true)"
  RUNNING_PORT="$(sed -n 2p "$LOCK" 2>/dev/null || true)"
  case "$RUNNING_PID" in ''|*[!0-9]*) RUNNING_PID="" ;; esac
  case "$RUNNING_PORT" in ''|*[!0-9]*) RUNNING_PORT="" ;; esac
  if [ -n "$RUNNING_PID" ] && [ "$RUNNING_PID" != "$$" ] && kill -0 "$RUNNING_PID" 2>/dev/null; then
    if [ -n "$RUNNING_PORT" ]; then
      # The app was started: it answers within a few seconds of starting.
      for _ in 1 2 3 4 5; do
        if answers "$RUNNING_PORT"; then
          say "It's already running at http://localhost:$RUNNING_PORT
Your browser opens it now. Use the Terminal window it runs in; to stop it, press Control-C there."
          open "http://localhost:$RUNNING_PORT" >/dev/null 2>&1 || true
          exit 0
        fi
        sleep 1
      done
    elif ps -p "$RUNNING_PID" -o command= 2>/dev/null | grep -q "start.command"; then
      say "The app is already starting in another Terminal window from this folder.
Wait for it: your browser opens it when it is ready. You can close this window."
      exit 0
    fi
  fi
  # Left behind by a start that ended without cleaning up: carry on.
  rm -f "$LOCK"
fi
printf '%s\n' "$$" > "$LOCK"
# Removed when this start ends before the app runs (an error, Control-C). Once the app runs, the
# watcher below removes it when the app stops.
release_lock() { if [ -f "$LOCK" ] && [ "$(sed -n 1p "$LOCK" 2>/dev/null)" = "$$" ]; then rm -f "$LOCK"; fi; }
trap release_lock EXIT

cd "$ROOT/studio"
VERSION="$(node -p 'require("./package.json").version')"
STAMP=".next/.start-fingerprint"
# The app's own tooling sends nothing about this computer anywhere.
export NEXT_TELEMETRY_DISABLED=1

# What the app was last prepared from: every file in studio/ (name, size, last change) except
# installed packages and the prepared app itself. A git pull changes it, so the next start prepares
# the app again; nothing else does.
fingerprint() {
  node -e '
const fs = require("fs"), path = require("path"), crypto = require("crypto");
const skip = new Set(["node_modules", ".next", ".vercel", ".turbo", "next-env.d.ts"]);
const hash = crypto.createHash("sha1");
const walk = (dir) => {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true }).sort((a, b) => (a.name < b.name ? -1 : 1))) {
    if (skip.has(entry.name) || entry.name.endsWith(".tsbuildinfo")) continue;
    const file = path.join(dir, entry.name);
    if (entry.isDirectory()) walk(file);
    else if (entry.isFile()) { const s = fs.statSync(file); hash.update(file + "\0" + s.size + "\0" + s.mtimeMs + "\n"); }
  }
};
walk(".");
process.stdout.write(hash.digest("hex"));'
}

CHILD=""
trap 'if [ -n "$CHILD" ]; then kill "$CHILD" 2>/dev/null || true; fi; printf "\nStopped. Run the same line again to carry on where it left off.\n"; exit 130' INT TERM

# Runs one long step. Its output goes to start-log.txt; this window shows a dot every two seconds.
quietly() {
  printf '\n===== %s: %s =====\n' "$(date '+%Y-%m-%d %H:%M:%S')" "$*" >> "$LOG"
  "$@" >> "$LOG" 2>&1 &
  CHILD=$!
  while kill -0 "$CHILD" 2>/dev/null; do printf '.'; sleep 2; done
  printf '\n'
  local status=0
  wait "$CHILD" || status=$?
  CHILD=""
  return "$status"
}
# Says what went wrong with a step, shows the end of the log, and stops.
stopped() {
  printf '\n%s\n' "$1" >&2
  printf 'What to do: check that this Mac is online, then run the same line again. It carries on where it stopped.\n' >&2
  printf 'If it stops the same way again, see "The start command" in docs/TROUBLESHOOTING.md.\n' >&2
  printf '\nThe full details are in this file: %s\nIts last lines:\n\n' "$LOG" >&2
  tail -n 15 "$LOG" >&2 || true
  exit 1
}

: > "$LOG"

# 3. Install (the first start, and after an update that changes what the app needs)
if [ ! -d node_modules ] || [ package-lock.json -nt node_modules/.package-lock.json ]; then
  say "Step 1 of 2: installing what the app needs. This happens on the first start and after some updates, and takes about 2 minutes."
  printf 'A dot appears every two seconds while it works '
  quietly npm ci --no-audit --no-fund || stopped "The install did not finish."
fi

# 4. Build (the first start, and after every update)
if [ ! -f "$STAMP" ] || [ "$(cat "$STAMP")" != "$(fingerprint)" ]; then
  say "Step 2 of 2: preparing the app. This happens on the first start and after every update, and takes about 2 minutes."
  printf 'A dot appears every two seconds while it works '
  quietly npm run build || stopped "Preparing the app did not finish."
  # Taken after the build, which may touch a file or two in studio/ itself.
  fingerprint > "$STAMP"
fi
trap - INT TERM

# 5. A free port, starting at 3000
WANTED="${PORT:-3000}"
PORT="$WANTED"
while lsof -iTCP:"$PORT" -sTCP:LISTEN >/dev/null 2>&1; do PORT=$((PORT + 1)); done
if [ "$PORT" != "$WANTED" ]; then
  say "Note: something on this Mac already uses address $WANTED. If the app is already running in another Terminal window, use that one and close this one. Otherwise carry on: this start uses $PORT."
fi

say "Benji GTM $VERSION is starting at http://localhost:$PORT
Your browser opens it in a moment. If it does not, open that address yourself.
It can be opened on this Mac only. Keep this window open while you use the app.
To stop the app, click this window and press Control-C."
( sleep 3; open "http://localhost:$PORT" >/dev/null 2>&1 || true ) &
# The lock now names the port too. `exec` keeps this process id for the app, so a small watcher removes
# the lock when the app stops (Control-C, the window closed).
printf '%s\n%s\n' "$$" "$PORT" > "$LOCK"
APP_PID=$$
( while kill -0 "$APP_PID" 2>/dev/null; do sleep 2; done; if [ "$(sed -n 1p "$LOCK" 2>/dev/null)" = "$APP_PID" ]; then rm -f "$LOCK"; fi ) >/dev/null 2>&1 &
# This computer only: the app listens on 127.0.0.1, so no other device on the network can reach it,
# and it is told so, which is what lets first-run setup happen.
export INSTALL_SETUP_LOCAL=1
exec npm run --silent start -- --hostname 127.0.0.1 --port "$PORT"
