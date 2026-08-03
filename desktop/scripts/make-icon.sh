#!/bin/bash
# Builds build/icon.icns from the web app's src/app/icon.svg, so the Mac app and
# the browser tab never drift apart. Uses only macOS built-ins.
set -euo pipefail

cd "$(dirname "$0")/.."

SOURCE_SVG="../src/app/icon.svg"
WORK="$(mktemp -d)"
ICONSET="$WORK/icon.iconset"
trap 'rm -rf "$WORK"' EXIT

if [ ! -f "$SOURCE_SVG" ]; then
  echo "make-icon: $SOURCE_SVG not found" >&2
  exit 1
fi

# Everything between the source's <svg> tags — the artwork itself, on a 512 grid.
ARTWORK="$(awk '
  !started {
    if (sub(/^.*<svg[^>]*>/, "")) { started = 1 } else { next }
  }
  /<\/svg>/ { sub(/<\/svg>.*$/, ""); if ($0 ~ /[^ \t]/) print; exit }
  /[^ \t]/ { print }
' "$SOURCE_SVG")"
if ! printf '%s' "$ARTWORK" | grep -q '[^[:space:]]'; then
  echo "make-icon: could not read artwork out of $SOURCE_SVG" >&2
  echo "           (expected a single-line <svg ...> opening tag)" >&2
  exit 1
fi

# macOS icons sit on a transparent margin rather than filling the tile, so the
# 512-unit artwork is inset onto a 1024 canvas at the standard ~80% scale.
cat > "$WORK/padded.svg" <<SVG
<svg xmlns="http://www.w3.org/2000/svg" width="1024" height="1024" viewBox="0 0 1024 1024">
  <g transform="translate(100 100) scale(1.609375)">
$ARTWORK
  </g>
</svg>
SVG

qlmanage -t -s 1024 -o "$WORK" "$WORK/padded.svg" > /dev/null 2>&1
RASTER="$WORK/padded.svg.png"
if [ ! -f "$RASTER" ]; then
  echo "make-icon: failed to rasterize the SVG" >&2
  exit 1
fi

mkdir -p "$ICONSET"
for size in 16 32 128 256 512; do
  sips -z "$size" "$size" "$RASTER" --out "$ICONSET/icon_${size}x${size}.png" > /dev/null
  sips -z $((size * 2)) $((size * 2)) "$RASTER" \
    --out "$ICONSET/icon_${size}x${size}@2x.png" > /dev/null
done

mkdir -p build
iconutil -c icns "$ICONSET" -o build/icon.icns
echo "make-icon: wrote desktop/build/icon.icns"
