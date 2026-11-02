# ZeroTier Indicator for GNOME

GNOME Shell extension that shows ZeroTier status in the top bar.

![Top bar menu](screenshot.png)

The screenshot comes from a private headless GNOME Shell with demo data.

## Requirements

- GNOME Shell 46, 47 or 48
- `ip` from `iproute2`
- `glib-compile-schemas` from `libglib2.0-bin`

## Install

```sh
git clone https://github.com/Jamir-boop/zerotier-indicator-gnome-extension.git
cd zerotier-indicator-gnome-extension
./install.sh
gnome-extensions enable zerotier-indicator@jamir-boop.github.io
```

If GNOME cannot find the extension, log out and log in. Then enable it again.

## Use

The extension reads network interfaces with names that start with `zt`. It shows **Connected** when one of these interfaces is up and has an IPv4 address. It does not use `zerotier-cli` or the ZeroTier API.

The menu shows each `zt` interface, its IPv4 addresses, and the peer checks. **Check now** starts a check. **Settings** opens the preferences.

## Check cost

The extension runs `ip -j address show` at startup, when the menu opens, and on
**Check now**. It also listens for `Gio.NetworkMonitor` changes. It combines events
within 1 second into one interface check. A 60-second safety check covers interface
or address changes with no route signal. It does not change your network.
GLib 2.84 watches routes, not link or address events. See the
[GLib netlink source](https://gitlab.gnome.org/GNOME/glib/-/blob/2.84.4/gio/gnetworkmonitornetlink.c).

Peer checks run when the menu opens, on **Check now**, and every 300 seconds by
default. Each check opens and closes one TCP connection per peer. Port 22 checks
can make `sshd` start a process and log a pre-authentication close. With the menu
closed, the default is at most 288 checks per peer per day, not 8,640. Set the peer
interval to 0 to stop background peer checks. Peers are **Not checked** when no
`zt` interface is connected. No peer checks run at startup with the menu closed.

Between events and timers, the extension runs no subprocesses or TCP checks. The
60-second safety check still runs with the menu closed. No peer timer runs when
the peer list is empty. The extension keeps results in memory and changes menu
rows only when the menu is open and the results change. It creates each icon once.

## Settings

- Peer check interval: 300 seconds by default. Use 0 or at least 60 seconds.
  Values from 1 to 59 use 60 seconds. The maximum is 3,600 seconds.
- Peers: one `label=host` or `label=host:port` value per line. The list is empty by default.
- Default TCP port: 22 by default.

A peer is reachable when a TCP connection opens in 2 seconds. You can also set peers with `gsettings`:

```sh
gsettings --schemadir ~/.local/share/gnome-shell/extensions/zerotier-indicator@jamir-boop.github.io/schemas \
  set org.gnome.shell.extensions.zerotier-indicator peers "['server=192.0.2.2']"
```

## Tests

```sh
gjs -m tests/core.test.js
glib-compile-schemas --strict --dry-run schemas
eslint .
tests/e2e/run.sh
```

`tests/e2e/run.sh` starts a private headless GNOME Shell. It does not use your
desktop session or your settings. It also writes `screenshot.png` with demo data.
It checks idle work, route events, peer checks, menu rows, preferences, and cleanup.
For a 2-minute idle measurement, use:

```sh
ZT_TEST_IDLE_SECONDS=120 ZT_TEST_KEEP_LOG=/tmp/zerotier-test.log tests/e2e/run.sh
grep MEASURE /tmp/zerotier-test.log
```

After an update on X11, restart GNOME Shell with **Alt+F2**, `r`, **Enter**.
The installer does not restart GNOME Shell or reset your peers.

## License

MIT. See `LICENSE`.
