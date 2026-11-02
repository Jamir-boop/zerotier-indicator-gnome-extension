#!/bin/sh
set -eu
SOURCE=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
TARGET="${XDG_DATA_HOME:-$HOME/.local/share}/gnome-shell/extensions/zerotier-indicator@jamir-boop.github.io"
mkdir -p "$TARGET/schemas" "$TARGET/icons"
for file in metadata.json extension.js prefs.js core.js LICENSE; do
    cp "$SOURCE/$file" "$TARGET/$file"
done
cp "$SOURCE"/schemas/*.gschema.xml "$TARGET/schemas/"
cp "$SOURCE"/icons/*.svg "$TARGET/icons/"
glib-compile-schemas --strict "$TARGET/schemas"
printf 'Installed to %s\n' "$TARGET"
printf 'Enable with: gnome-extensions enable zerotier-indicator@jamir-boop.github.io\n'
printf 'If GNOME cannot find the extension, log out and log in. Then enable it again.\n'
