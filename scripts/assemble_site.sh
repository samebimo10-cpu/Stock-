#!/usr/bin/env bash
#
# Build the directory that GitHub Pages publishes.
#
# The repository holds two unrelated web apps and Pages serves one site per
# repository, so they are combined into a single tree rather than each trying to
# deploy its own. A second deployment would not sit alongside the first; it would
# replace it.
#
#   _site/          the stock selector and allocator   -> /Stock-/
#   _site/farm/     DouValue Farm Manager              -> /Stock-/farm/
#
# Both apps reference their assets with relative paths, so the farm app works
# from a sub-path with no rewriting.

set -euo pipefail

root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
out="${1:-$root/_site}"

rm -rf "$out"
mkdir -p "$out"

if [ ! -d "$root/web" ]; then
  echo "error: web/ is missing, so there is no stock app to publish" >&2
  exit 1
fi
cp -R "$root/web/." "$out/"
echo "Stock app  -> $(find "$out" -maxdepth 1 -type f | wc -l | tr -d ' ') files at the site root"

# The farm app is optional on purpose. If it is ever removed from a branch, the
# stock site must still publish rather than the whole deployment failing.
if [ -d "$root/douvalue/web" ]; then
  mkdir -p "$out/farm"
  cp -R "$root/douvalue/web/." "$out/farm/"
  echo "Farm app   -> $(find "$out/farm" -type f | wc -l | tr -d ' ') files under /farm/"
  # The sync server is published alongside the app, as .js so Deno will accept
  # it as a module, plus a page that tells the farm exactly what to paste and
  # where. Copying 600 lines off a phone is not a setup step anyone completes.
  if [ -f "$root/douvalue/server/deno-sync.ts" ]; then
    mkdir -p "$out/farm/server"
    cp "$root/douvalue/server/deno-sync.ts" "$out/farm/server/deno-entry.js"
    cp "$root/douvalue/server/page/index.html" "$out/farm/server/index.html"
    echo "Sync server -> /farm/server/ (one-line import and setup page)"
  fi
else
  echo "::warning::douvalue/web is missing, so the farm app was not published."
fi

# Pages built through Actions does not run Jekyll, but this makes that explicit
# and keeps any future underscore-prefixed path from being dropped.
touch "$out/.nojekyll"

echo "Site assembled at $out"
