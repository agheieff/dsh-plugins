#!/bin/sh
# Test, build and pack this plugin, then install the packed copy into a dsh profile, so the profile
# never runs this working folder. Settings come from the environment or ./release.env (not tracked):
#   DSH          dsh command (default: dsh)
#   DSH_PROFILE  profile to install into (default: web)
#   DSH_PACKS    where packed copies are kept (default: ~/.local/share/dsh/plugins)
#   DSH_RESTART  command run afterwards, e.g. "systemctl --user restart dsh-web" (default: none)
set -eu
cd "$(dirname "$0")/.."
[ -f release.env ] && . ./release.env
DSH="${DSH:-dsh}"
OUT="${DSH_PACKS:-$HOME/.local/share/dsh/plugins}"
pnpm test
pnpm build
mkdir -p "$OUT"
NAME=$(node -p "const p=require('./package.json'); p.name.replace('@','').replace('/','-')+'-'+p.version")
rm -f "${OUT:?}/${NAME:?}.tgz"
pnpm pack --pack-destination "$OUT" >/dev/null
$DSH plugin --profile "${DSH_PROFILE:-web}" add "$OUT/$NAME.tgz"
if [ -n "${DSH_RESTART:-}" ]; then sh -c "$DSH_RESTART"; fi
