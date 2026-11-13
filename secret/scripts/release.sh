#!/bin/sh
# Release this plugin into the PC's dsh web profile: test, build, pack, install the packed copy with
# the pinned dsh, restart the service. The profile runs the packed copy, never this working folder.
set -eu
cd "$(dirname "$0")/.."
DSH="${DSH:-$HOME/.local/bin/dsh-pinned}"
OUT="$HOME/.local/share/dsh/plugins"
pnpm test
pnpm build
mkdir -p "$OUT"
NAME=$(node -p "const p=require('./package.json'); p.name.replace('@','').replace('/','-')+'-'+p.version")
rm -f "${OUT:?}/${NAME:?}.tgz"
pnpm pack --pack-destination "$OUT" >/dev/null
"$DSH" plugin --profile web add "$OUT/$NAME.tgz"
systemctl --user restart dsh-web
sleep 8
systemctl --user is-active dsh-web
