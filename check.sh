#!/bin/bash
# This script scans for all .js and .mjs files, excluding the node_modules directory,
# and displays the line count for each file and the total, sorted from smallest to largest.

{ find . -path ./node_modules -prune -o -name "*.js" -type f -print0; find . -path ./node_modules -prune -o -name "*.mjs" -type f -print0; } | xargs -0 wc -l | sort -n
