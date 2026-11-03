#!/bin/bash
# Mac: drag an exported character (.fbx or .glb) onto this file, or double
# click it and pick the file. It tidies the character for Dingba and writes
# <name>-tidy.glb next to the original.
cd "$(dirname "$0")"
IN="$1"
if [ -z "$IN" ]; then
  IN=$(osascript -e 'POSIX path of (choose file with prompt "Pick the exported character (.fbx or .glb)")' 2>/dev/null)
fi
if [ -z "$IN" ]; then echo "No file chosen."; exit 1; fi
BLENDER=$(command -v blender || ls /Applications/Blender.app/Contents/MacOS/Blender 2>/dev/null | head -1)
if [ -z "$BLENDER" ]; then echo "Blender was not found. Install it from blender.org, then try again."; exit 1; fi
OUT="${IN%.*}-tidy.glb"
"$BLENDER" -b -P "$(pwd)/prepare-character.py" -- --in "$IN" --out "$OUT"
echo
echo "Done. Your tidy file is: $OUT"
echo "Now drag it onto dingba.ai/studio to check it."
