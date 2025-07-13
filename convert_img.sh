#!/usr/bin/env zsh
# convert_for_macos.sh
#
# Batch-rename and resize camera photos to a Mac-friendly
# resolution (default 3840×2160) using only macOS-native tools.
#
# Usage:
#   convert_for_macos.sh /path/to/input_dir [/path/to/output_dir] [WIDTHxHEIGHT]
#
# Example:
#   convert_for_macos.sh ~/DCIM ~/Pictures/Wallpapers 5120x2880
#
# Requires: macOS (uses `sips` and `mdls`), zsh (default since macOS Catalina).

set -euo pipefail

# ---------- defaults ----------
in_dir="${1:-.}"
out_dir="${2:-"$in_dir/resized"}"
target_res="${3:-3840x2160}"     # widthxheight
mkdir -p "$out_dir"

echo "📸 Input  : $in_dir"
echo "💾 Output : $out_dir"
echo "🖥  Target : $target_res"
echo

for src in "$in_dir"/*.(jpg|jpeg|png|heic); do
  [[ -e "$src" ]] || continue   # skip if no matches
  # Grab capture date from metadata; fall back to file mtime.
  ts=$(mdls -name kMDItemContentCreationDate -raw "$src" 2>/dev/null \
        | sed -E 's/T/ /;s/Z$//') \
     || ts=$(date -r "$(stat -f %m "$src")" "+%Y-%m-%d %H:%M:%S")
  slug=$(date -j -f "%Y-%m-%d %H:%M:%S" "$ts" "+%Y%m%d_%H%M%S")
  ext="${src:t:e:l}"
  dest="$out_dir/$slug.$ext"

  echo "➡️  $src:t  →  $dest:t"
  # Resize *in place* into out_dir, preserving orientation/EXIF.
  sips -Z "${${target_res%%x*}}" "$src" --out "$dest" >/dev/null
done

echo "\n✅ Done: $(ls -1 "$out_dir" | wc -l | tr -d ' ') files processed."
