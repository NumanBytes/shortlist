#!/usr/bin/env bash
# Renders the PWA/home-screen PNGs in public/ from public/favicon.svg, the single source of
# the mark (docs/web-design.md §8.4.3). Uses headless Chrome as the rasterizer, so no
# image library is needed. Run after changing the mark: apps/web/icons/render.sh
set -euo pipefail

cd "$(dirname "$0")"
SOURCE=../public/favicon.svg
OUT=../public

die() { echo "render.sh: $*" >&2; exit 1; }

CHROME="${CHROME:-}"
if [ -z "$CHROME" ]; then
  for candidate in google-chrome chromium chromium-browser; do
    if command -v "$candidate" >/dev/null; then CHROME="$candidate"; break; fi
  done
fi
[ -n "$CHROME" ] || die "no Chrome/Chromium found; set CHROME=/path/to/chrome"
[ -s "$SOURCE" ] || die "$SOURCE is missing or empty"

# The tile colour, read from the source so it's never written down twice. Variants that
# need a full-bleed background use it.
TILE=$(grep -o 'fill="#[0-9a-fA-F]\{6\}"' "$SOURCE" | head -1 | cut -d'"' -f2 || true)
[ -n "$TILE" ] || die "couldn't read the tile colour from $SOURCE"

# Everything happens in a temp folder (no spaces or URL-special characters in its path);
# public/ is only touched once every render has succeeded.
tmp="$(mktemp -d)"
trap 'rm -rf "$tmp"' EXIT
cp "$SOURCE" "$tmp/icon.svg"

page() { # <size> <background> <mark size, % of the canvas>
  printf '<html><head><title>loading</title></head><body style="margin:0;width:%spx;height:%spx;display:grid;place-items:center;background:%s">' "$1" "$1" "$2"
  printf '<img src="icon.svg" style="width:%s%%;height:%s%%;display:block" onload="document.title=%s" onerror="document.title=%s"></body></html>' "$3" "$3" "'loaded'" "'failed'"
}

# Chrome exits 0 and screenshots a blank page when the image doesn't load, so check that
# it does before trusting any screenshot.
page 64 transparent 100 >"$tmp/check.html"
"$CHROME" --headless --disable-gpu --dump-dom "file://$tmp/check.html" 2>"$tmp/chrome.log" | grep -q '<title>loaded</title>' ||
  die "Chrome couldn't load $SOURCE (see its output below)
$(tail -5 "$tmp/chrome.log")"

render() { # <size> <background> <mark %> <name>
  page "$1" "$2" "$3" >"$tmp/page.html"
  "$CHROME" --headless --disable-gpu --hide-scrollbars --force-device-scale-factor=1 \
    --default-background-color=00000000 --window-size="$1,$1" \
    --screenshot="$tmp/$4" "file://$tmp/page.html" 2>>"$tmp/chrome.log"
  file "$tmp/$4" | grep -q "$1 x $1" || die "$4 didn't render at ${1}x$1"
}

render 192 transparent 100 pwa-192.png
render 512 transparent 100 pwa-512.png
# iOS rounds the corners itself and shows transparency as black: full-bleed tile colour.
render 180 "$TILE" 100 apple-touch-icon.png
# Android crops maskable icons to its own shape: full-bleed, with the mark scaled into the
# safe zone (the centre circle, 40% radius).
render 512 "$TILE" 85 pwa-maskable-512.png

mv "$tmp"/*.png "$OUT"/
echo "Rendered pwa-192, pwa-512, apple-touch-icon and pwa-maskable-512 from favicon.svg"
