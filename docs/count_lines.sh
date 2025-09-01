#!/bin/bash

# Find and count lines of HTML files
html_lines=$(find . -name "*.html" -not -path "./node_modules/*" -print0 | xargs -0 wc -l | awk '{total += $1} END {print total}')
html_files=$(find . -name "*.html" -not -path "./node_modules/*" | wc -l)

# Find and count lines of CSS files
css_lines=$(find . -name "*.css" -not -path "./node_modules/*" -print0 | xargs -0 wc -l | awk '{total += $1} END {print total}')
css_files=$(find . -name "*.css" -not -path "./node_modules/*" | wc -l)

# Find and count lines of JavaScript files
js_lines=$(find . -name "*.js" -not -path "./node_modules/*" -print0 | xargs -0 wc -l | awk '{total += $1} END {print total}')
js_files=$(find . -name "*.js" -not -path "./node_modules/*" | wc -l)

# Calculate total lines
total_lines=$((html_lines + css_lines + js_lines))

# Print the results
echo "Line counts per file type:"
echo "--------------------------"
echo "HTML: $html_lines lines in $html_files files"
echo "CSS:  $css_lines lines in $css_files files"
echo "JS:   $js_lines lines in $js_files files"
echo "--------------------------"
echo "Total: $total_lines lines"
