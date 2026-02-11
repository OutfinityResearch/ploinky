#!/bin/bash
set -euo pipefail

# Scan JavaScript, HTML, and Markdown sources while ignoring most node_modules entries.
# Adjust INCLUDED_NODE_MODULES to keep specific dependencies in the report.

# Try to detect terminal width for nicer formatting
TERM_COLS=$(tput cols 2>/dev/null || echo "${COLUMNS:-80}")

# Shorten a path to fit in a given width by keeping only the tail
shorten_path() {
  local path="$1"
  local max="$2"
  local len=${#path}
  if (( len <= max || max <= 4 )); then
    printf "%s" "$path"
    return
  fi
  local keep=$((max - 1))
  if (( keep < 1 )); then
    keep=1
  fi
  printf "…%s" "${path: -keep}"
}

# Add module folder names (relative to node_modules) to include in the count.
# Example: INCLUDED_NODE_MODULES=(my-shared-lib another-lib)
INCLUDED_NODE_MODULES=()

# Collect all JS/MJS, HTML and MD files, pruning node_modules entirely for speed.
files_to_process=()
while IFS= read -r -d '' file; do
  files_to_process+=("$file")
done < <(find . -path "*/node_modules" -prune -o -type f \( -name "*.js" -o -name "*.mjs" -o -name "*.html" -o -name "*.md" \) -print0)

# Collect explicitly included node_modules (if any).
if [[ ${#INCLUDED_NODE_MODULES[@]} -gt 0 ]]; then
  for module in "${INCLUDED_NODE_MODULES[@]}"; do
    while IFS= read -r -d '' module_path; do
      while IFS= read -r -d '' file; do
        files_to_process+=("$file")
      done < <(find "$module_path" -type f -name "*.*js" -print0)
    done < <(find . -type d -path "*/node_modules/${module}" -print0)
  done
fi

if [[ ${#files_to_process[@]} -eq 0 ]]; then
  echo "No JavaScript, HTML, or Markdown files found."
  exit 0
fi

js_files=()
html_files=()
md_files=()
for file in "${files_to_process[@]}"; do
  case "$file" in
    *.js|*.mjs) js_files+=("$file") ;;
    *.html) html_files+=("$file") ;;
    *.md) md_files+=("$file") ;;
  esac
done

total_js_lines=0
total_html_lines=0
total_md_lines=0

# Render a category as a 3-column table, preserving original sort order
render_category() {
  local title="$1"
  local -n lines_arr="$2"

  local cols=3
  local count=${#lines_arr[@]}
  if (( count == 0 )); then
    return
  fi

  echo "--- $title ---"

  # Compute cell width based on terminal width
  local cell_width=$(( (TERM_COLS - (cols - 1) * 2) / cols ))
  if (( cell_width < 16 )); then
    cell_width=16
  fi
  local path_max=$((cell_width - 8))
  if (( path_max < 8 )); then
    path_max=8
  fi

  local rows=$(( (count + cols - 1) / cols ))
  local i c idx

  for ((i = 0; i < rows; i++)); do
    local row_line=""
    for ((c = 0; c < cols; c++)); do
      # Column-major assignment: smallest în prima coloană, cele mai mari în ultima
      idx=$((i + c * rows))
      local cell=""
      if (( idx < count )); then
        local line="${lines_arr[idx]}"
        # Extract line count and path from wc output
        local line_count path
        line_count=$(awk '{print $1}' <<<"$line")
        path=$(awk '{ $1=""; sub(/^ +/,""); print }' <<<"$line")
        local display_path
        display_path=$(shorten_path "$path" "$path_max")
        printf -v cell "%6s %s" "$line_count" "$display_path"
        printf -v cell "%-*s" "$cell_width" "$cell"
      else
        printf -v cell "%-*s" "$cell_width" ""
      fi
      row_line+="$cell"
      if (( c < cols - 1 )); then
        row_line+="  "
      fi
    done
    echo "$row_line"
  done

  echo ""
}

# HTML section first
if [[ ${#html_files[@]} -gt 0 ]]; then
  html_lines_output=$(printf '%s\0' "${html_files[@]}" | xargs -0 wc -l | sort -n)
  total_html_lines_raw=$(echo "$html_lines_output" | tail -n 1 | awk '{print $1}')
  if [[ -n "$total_html_lines_raw" ]]; then
    total_html_lines=$total_html_lines_raw
  fi
  # Drop the "total" line for per-file display
  mapfile -t html_rows < <(echo "$html_lines_output" | sed '$d')
  render_category "HTML Files" html_rows
fi

# Markdown section second
if [[ ${#md_files[@]} -gt 0 ]]; then
  md_lines_output=$(printf '%s\0' "${md_files[@]}" | xargs -0 wc -l | sort -n)
  total_md_lines_raw=$(echo "$md_lines_output" | tail -n 1 | awk '{print $1}')
  if [[ -n "$total_md_lines_raw" ]]; then
    total_md_lines=$total_md_lines_raw
  fi
  mapfile -t md_rows < <(echo "$md_lines_output" | sed '$d')
  render_category "Markdown Files" md_rows
fi

# JS section last (cele mai importante)
if [[ ${#js_files[@]} -gt 0 ]]; then
  js_lines_output=$(printf '%s\0' "${js_files[@]}" | xargs -0 wc -l | sort -n)
  total_js_lines_raw=$(echo "$js_lines_output" | tail -n 1 | awk '{print $1}')
  if [[ -n "$total_js_lines_raw" ]]; then
    total_js_lines=$total_js_lines_raw
  fi
  mapfile -t js_rows < <(echo "$js_lines_output" | sed '$d')
  render_category "JS Files" js_rows
fi

echo "--- Summary ---"
echo "Total HTML lines: ${total_html_lines:-0}"
echo "Total MD lines:   ${total_md_lines:-0}"
echo "Total JS lines:   ${total_js_lines:-0}"
grand_total=$((total_js_lines + total_html_lines + total_md_lines))
echo "Grand Total lines: $grand_total"
