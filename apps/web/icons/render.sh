#!/usr/bin/env bash
# Renders the PWA/home-screen PNGs in public/ from the SVG sources (Agents.md §8.4.3).
# Uses headless Chrome as the rasterizer, so no image library is needed.
# Run after changing the mark: apps/web/icons/render.sh
set -euo pipefail

cd "$(dirname "$0")"
CHROME="${CHROME:-google-chrome}"
tmp="$(mktemp -d)"
trap 'rm -rf "$tmp"' EXIT

render() { # <svg> <size> <out.png>
  local html="$tmp/page.html"
  printf '<html><body style="margin:0"><img src="file://%s" width="%s" height="%s" style="display:block"></body></html>' \
    "$PWD/$1" "$2" "$2" >"$html"
  "$CHROME" --headless --disable-gpu --hide-scrollbars --force-device-scale-factor=1 \
    --default-background-color=00000000 --window-size="$2,$2" \
    --screenshot="$PWD/$3" "file://$html" 2>/dev/null
}

render ../public/favicon.svg 192 ../public/pwa-192.png
render ../public/favicon.svg 512 ../public/pwa-512.png
render icon-maskable.svg 512 ../public/pwa-maskable-512.png
# iOS rounds the corners itself and shows transparency as black, so this one is full-bleed.
render icon-square.svg 180 ../public/apple-touch-icon.png
