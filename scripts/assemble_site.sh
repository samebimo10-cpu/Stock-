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
#   _site/tycoon/   Tycoon Rush, the wealth planner    -> /Stock-/tycoon/
#   _site/formfill/ FormFill, the form autofill app    -> /Stock-/formfill/
#
# All the apps reference their assets with relative paths, so the farm app works
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

# The planner is optional in the same way as the farm app. It reads the stock
# app's data-pack.json from the site root for live prices.
if [ -d "$root/tycoon" ]; then
  mkdir -p "$out/tycoon"
  cp "$root/tycoon/index.html" "$root/tycoon/sw.js" "$root/tycoon/manifest.webmanifest" "$root/tycoon/icon.svg" "$out/tycoon/"
  # App icons for the home screen; the service worker caches these too, so a
  # missing one would stop the offline install.
  cp "$root"/tycoon/*.png "$out/tycoon/" 2>/dev/null || true
  cp -R "$root/tycoon/js" "$out/tycoon/js"
  cp -R "$root/tycoon/fonts" "$out/tycoon/fonts"
  echo "Planner    -> $(find "$out/tycoon" -type f | wc -l | tr -d ' ') files under /tycoon/"
fi

# FormFill is optional in the same way. Its tests and the Apps Script proxy
# source stay out of the site; the app, its icons and bundled libraries go in.
if [ -d "$root/formfill" ]; then
  mkdir -p "$out/formfill"
  cp "$root/formfill/index.html" "$root/formfill/sw.js" "$root/formfill/manifest.webmanifest" "$root/formfill/icon.svg" "$out/formfill/"
  cp "$root"/formfill/*.png "$out/formfill/"
  cp -R "$root/formfill/js" "$out/formfill/js"
  cp -R "$root/formfill/vendor" "$out/formfill/vendor"
  echo "FormFill   -> $(find "$out/formfill" -type f | wc -l | tr -d ' ') files under /formfill/"
fi

# Pages built through Actions does not run Jekyll, but this makes that explicit
# and keeps any future underscore-prefixed path from being dropped.
touch "$out/.nojekyll"

echo "Site assembled at $out"
