#!/bin/sh
# Run a private headless GNOME Shell. Do not use the owner desktop.
set -eu

ROOT=$(CDPATH= cd -- "$(dirname -- "$0")/../.." && pwd)
DRIVER=zerotier-test-driver@example.invalid

for tool in gnome-shell gjs gsettings dbus-run-session dbus-daemon glib-compile-schemas timeout; do
    command -v "$tool" >/dev/null 2>&1 || { echo "Missing tool: $tool" >&2; exit 2; }
done

WORK=$(mktemp -d)
SYSTEM_BUS_PID=
cleanup() {
    [ -z "$SYSTEM_BUS_PID" ] || kill "$SYSTEM_BUS_PID" 2>/dev/null || true
    rm -rf "${WORK:?}"
}
trap cleanup EXIT

export HOME="$WORK/home"
export XDG_CONFIG_HOME="$WORK/config"
export XDG_DATA_HOME="$WORK/data"
export XDG_CACHE_HOME="$WORK/cache"
export XDG_STATE_HOME="$WORK/state"
export XDG_RUNTIME_DIR="$WORK/runtime"
mkdir -p "$HOME" "$XDG_CONFIG_HOME" "$XDG_DATA_HOME" "$XDG_CACHE_HOME" "$XDG_STATE_HOME" "$XDG_RUNTIME_DIR"
chmod 700 "$XDG_RUNTIME_DIR"
unset DISPLAY DBUS_SESSION_BUS_ADDRESS
export GSETTINGS_BACKEND=keyfile
export WAYLAND_DISPLAY=zerotier-test
export GDK_BACKEND=wayland
export NO_AT_BRIDGE=1
export GTK_A11Y=none
export ZT_TEST_RESULT="$WORK/result.txt"
export ZT_TEST_SCREENSHOT="$ROOT/screenshot.png"

# Containers often have no system bus. GNOME Shell needs one to start,
# so provide an empty private stand-in. Desktops keep their real bus.
# ZT_TEST_PRIVATE_SYSTEM_BUS=1 forces the stand-in.
if [ -n "${ZT_TEST_PRIVATE_SYSTEM_BUS:-}" ] ||
    { [ -z "${DBUS_SYSTEM_BUS_ADDRESS:-}" ] && [ ! -S /run/dbus/system_bus_socket ]; }; then
    SYSTEM_BUS_PID=$(dbus-daemon --session --fork --print-pid \
        --address="unix:path=$WORK/system_bus_socket")
    export DBUS_SYSTEM_BUS_ADDRESS="unix:path=$WORK/system_bus_socket"
fi

"$ROOT/install.sh" >/dev/null
mkdir -p "$XDG_DATA_HOME/gnome-shell/extensions/$DRIVER"
cp "$ROOT/tests/e2e/driver/metadata.json" "$ROOT/tests/e2e/driver/extension.js" \
    "$XDG_DATA_HOME/gnome-shell/extensions/$DRIVER/"

gsettings set org.gnome.shell disable-extension-version-validation true
gsettings set org.gnome.shell enabled-extensions "['$DRIVER']"
gsettings set org.gnome.shell welcome-dialog-last-shown-version '999'

status=0
timeout 240 dbus-run-session -- gnome-shell --headless --wayland --no-x11 \
    --wayland-display="$WAYLAND_DISPLAY" --virtual-monitor 1024x768 >"$WORK/shell.log" 2>&1 || status=$?

if grep -E "JS ERROR|JS WARNING|Gjs-CRITICAL" "$WORK/shell.log" | grep -iE "zerotier" >"$WORK/js-errors.txt"; then
    echo "JavaScript errors from ZeroTier Indicator:" >&2
    cat "$WORK/js-errors.txt" >&2
    status=1
fi

if [ ! -s "$ZT_TEST_RESULT" ]; then
    echo "No test result (gnome-shell exit $status). Shell log tail:" >&2
    tail -n 60 "$WORK/shell.log" >&2
    exit 1
fi

cat "$ZT_TEST_RESULT"
if [ -n "${ZT_TEST_KEEP_LOG:-}" ]; then
    cp "$WORK/shell.log" "$ZT_TEST_KEEP_LOG"
fi
grep -q '^PASS$' "$ZT_TEST_RESULT" && [ "$status" -eq 0 ]
