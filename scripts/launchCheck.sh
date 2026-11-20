#!/usr/bin/env bash
# The launch check (6.27l, Kevin Nov 20; docs/briefs/launch-check.md): starts the app just built in its self-check mode
# (STORIIBOARD_LAUNCH_CHECK=1, src-tauri/src/launch_check.rs), waits for it to quit by itself, and says how it ended.
# Run in both installer jobs of .github/workflows/checkpoint.yml, after the installers are uploaded:
#
#   bash scripts/launchCheck.sh <path to the app's executable>
#
# Bash, LF line endings: Git Bash on the Windows runner, and the Mac's own bash, which is 3.2, so nothing newer here.
# It passes only when the app's exit code is 0 and its output holds the line "launch check: passed". Without the
# variable the app would open this computer's real projects, so the app is never started here without it.

set -u

app="${1:-}"
# The steps in order, as launch_check.rs's STEPS (a Rust test fails when the two differ): step n failed is 10 + n,
# the time limit while waiting for step n is 30 + n.
steps="window loaded page policy-watch pdf-text accents worker-policy no-violation"
# Longer than the app's own 90 s, so the app's own time limit speaks first.
wait_limit=150

say() { printf 'launch check: %s\n' "$*"; }

# The name of step n, from 1.
step_name() {
  local n=$1 i=1 name
  for name in $steps; do
    if [ "$i" -eq "$n" ]; then
      printf '%s' "$name"
      return
    fi
    i=$((i + 1))
  done
}

# What an exit code means, from the same table as Rust's.
meaning() {
  local code=$1 count
  count=$(printf '%s\n' $steps | wc -l | tr -d ' ')
  if [ "$code" = killed ]; then
    printf 'the app had not quit after %s s, so this script ended it' "$wait_limit"
  elif [ "$code" -eq 0 ]; then
    printf 'every step passed'
  elif [ "$code" -eq 3 ]; then
    printf 'the app was asked to quit before the check ended'
  elif [ "$code" -ge 11 ] && [ "$code" -le $((10 + count)) ]; then
    printf 'step %s (%s) failed' "$((code - 10))" "$(step_name $((code - 10)))"
  elif [ "$code" -ge 31 ] && [ "$code" -le $((30 + count)) ]; then
    printf 'the time limit ended while waiting for step %s (%s)' "$((code - 30))" "$(step_name $((code - 30)))"
  elif [ "$code" -eq 39 ]; then
    printf 'every step passed but the app had not quit when the time limit ended'
  elif [ "$code" -eq 101 ]; then
    printf 'the app panicked'
  elif [ "$code" -ge 129 ] && [ "$code" -le 159 ]; then
    printf 'the app was ended by signal %s' "$((code - 128))"
  else
    printf 'not a code the launch check gives'
  fi
}

# Anything of the app's still running, for a failure's log. This script's own line is left out: on the Mac its command
# line holds the app's path, so it would always be listed.
still_running() {
  echo 'Processes whose name holds storiiboard:'
  { ps -A -o pid,stat,etime,command 2>/dev/null || tasklist 2>/dev/null; } |
    grep -i storiiboard | grep -v grep | grep -v launchCheck.sh || echo '(none)'
}

if [ -z "$app" ] || [ ! -f "$app" ]; then
  say "FAILED: no app at \"$app\""
  echo "What its folder holds:"
  ls -la "$(dirname "${app:-.}")" 2>&1 || true
  exit 1
fi

windows=false
case "$(uname -s)" in
  MINGW* | MSYS* | CYGWIN*) windows=true ;;
esac

# The WebView2 runtime the Windows app needs, as Microsoft says to find it: the machine-wide install, then the user's.
if [ "$windows" = true ]; then
  runtime=""
  for key in \
    'HKLM\SOFTWARE\WOW6432Node\Microsoft\EdgeUpdate\Clients\{F3017226-FE2A-4295-8BDF-00C3A9A7E4C5}' \
    'HKCU\Software\Microsoft\EdgeUpdate\Clients\{F3017226-FE2A-4295-8BDF-00C3A9A7E4C5}'; do
    # No path conversion: Git Bash would turn /v into a folder.
    found=$(MSYS_NO_PATHCONV=1 reg query "$key" /v pv 2>/dev/null | tr -d '\r' | awk '$1 == "pv" { print $3 }')
    if [ -n "$found" ] && [ "$found" != "0.0.0.0" ]; then
      runtime=$found
      break
    fi
  done
  # None found is a warning, not a failure: the app's own result is the better evidence.
  if [ -z "$runtime" ]; then
    say "warning: no WebView2 runtime found in the registry (neither key has a version); starting the app anyway"
  else
    say "WebView2 runtime $runtime"
  fi
fi

# The runner's temp folder in CI; on a developer's computer the repo's own test-results, never the system's temp
# folder.
log_dir="${RUNNER_TEMP:-test-results/launch-check}"
mkdir -p "$log_dir"
log="$log_dir/storiiboard-launch-check.log"
: >"$log"

say "starting $app"
STORIIBOARD_LAUNCH_CHECK=1 "$app" >"$log" 2>&1 &
pid=$!

# Polled, never a watcher left behind: at most wait_limit seconds, every half second.
code=""
polls=$((wait_limit * 2))
while [ "$polls" -gt 0 ] && kill -0 "$pid" 2>/dev/null; do
  sleep 0.5
  polls=$((polls - 1))
done
if kill -0 "$pid" 2>/dev/null; then
  kill -KILL "$pid" 2>/dev/null || true
  wait "$pid" 2>/dev/null
  code=killed
else
  wait "$pid"
  code=$?
fi

echo '--- the app said:'
tr -d '\r' <"$log"
echo '---'
say "exit code $code: $(meaning "$code")"

if [ "$code" = 0 ] && tr -d '\r' <"$log" | grep -qx 'launch check: passed'; then
  exit 0
fi
if [ "$code" = 0 ]; then
  say 'FAILED: the app quit with 0 but never said "launch check: passed"'
fi
still_running
exit 1
