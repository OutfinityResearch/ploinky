# cli/services/multilineNavigation.js - Multiline Navigation

## Overview

Enables vertical cursor navigation (up/down arrow keys) for multiline input in readline interfaces. Handles line wrapping, ANSI escape sequence stripping, and cursor position calculation across terminal rows.

## Source File

`cli/services/multilineNavigation.js`

## Constants

```javascript
// ANSI escape sequence pattern for stripping colors/formatting
const ANSI_ESCAPE_PATTERN = /\x1B\[[0-?]*[ -/]*[@-~]/g;

// Symbol to mark readline as patched (prevents double patching)
const MULTILINE_FLAG = Symbol('ploinkyMultilineNav');
```

## Data Structures

```javascript
/**
 * @typedef {Object} RowInfo
 * @property {number} start - Start index in the line string
 * @property {number} end - End index in the line string
 * @property {number} offset - Column offset (for first row with prompt)
 */

/**
 * @typedef {Object} CursorLocation
 * @property {number} rowIndex - Row index (0-based)
 * @property {number} column - Column within the row
 */
```

## Internal Functions

### stripAnsi(value)

**Purpose**: Removes ANSI escape sequences from a string

**Parameters**:
- `value` (string): String with potential ANSI codes

**Returns**: (string) Clean string without ANSI codes

**Implementation**:
```javascript
function stripAnsi(value) {
    if (!value) return '';
    return value.replace(ANSI_ESCAPE_PATTERN, '');
}
```

### getTerminalColumns(rl)

**Purpose**: Gets terminal column width

**Parameters**:
- `rl` (readline.Interface): Readline interface

**Returns**: (number) Terminal columns (default: 80)

**Implementation**:
```javascript
function getTerminalColumns(rl) {
    const candidate = rl?.output?.columns ?? process.stdout?.columns;
    if (typeof candidate === 'number' && Number.isFinite(candidate) && candidate > 0) {
        return candidate;
    }
    return 80;
}
```

### getPromptColumnOffset(rl, columns)

**Purpose**: Calculates column offset from prompt text

**Parameters**:
- `rl` (readline.Interface): Readline interface
- `columns` (number): Terminal column count

**Returns**: (number) Prompt offset in columns

**Implementation**:
```javascript
function getPromptColumnOffset(rl, columns) {
    if (!rl) return 0;
    const prompt = typeof rl._prompt === 'string' ? rl._prompt : '';

    // Try using readline's internal measurement
    if (typeof rl._getDisplayPos === 'function') {
        try {
            const measurement = rl._getDisplayPos(prompt);
            if (measurement && typeof measurement.cols === 'number') {
                return measurement.cols;
            }
        } catch (_) {}
    }

    // Fallback: visible length modulo columns
    const visibleLength = stripAnsi(prompt).length;
    if (!columns || !Number.isFinite(columns) || columns <= 0) {
        return visibleLength;
    }
    return visibleLength % columns;
}
```

### buildRowLayout(line, firstRowOffset, columns, tabSize)

**Purpose**: Builds row information for cursor navigation

**Parameters**:
- `line` (string): Input line text
- `firstRowOffset` (number): Column offset for first row
- `columns` (number): Terminal width
- `tabSize` (number): Tab width (default: 8)

**Returns**: (RowInfo[]) Array of row information

**Handles**:
- Line wrapping at terminal width
- Newline characters (`\r`, `\n`)
- Tab expansion

**Implementation**:
```javascript
function buildRowLayout(line, firstRowOffset, columns, tabSize = 8) {
    const rows = [{
        start: 0,
        end: 0,
        offset: firstRowOffset,
    }];
    let col = firstRowOffset;
    const wrapEnabled = Number.isFinite(columns) && columns > 0;

    for (let i = 0; i < line.length; i += 1) {
        const ch = line[i];

        // Handle explicit newlines
        if (ch === '\r' || ch === '\n') {
            rows[rows.length - 1].end = i;
            rows.push({ start: i + 1, end: i + 1, offset: 0 });
            col = 0;
            continue;
        }

        // Handle wrapping at terminal width
        if (wrapEnabled && col >= columns) {
            rows[rows.length - 1].end = i;
            rows.push({ start: i, end: i, offset: 0 });
            col = 0;
        }

        // Handle tab expansion
        if (ch === '\t') {
            const spaces = tabSize - (col % tabSize) || tabSize;
            col += spaces;
        } else {
            col += 1;
        }
    }

    rows[rows.length - 1].end = line.length;
    return rows;
}
```

### locateCursor(rows, cursor)

**Purpose**: Finds cursor position within row layout

**Parameters**:
- `rows` (RowInfo[]): Row layout
- `cursor` (number): Cursor position in line

**Returns**: (CursorLocation|null) Row index and column

**Implementation**:
```javascript
function locateCursor(rows, cursor) {
    if (!Array.isArray(rows) || rows.length === 0) {
        return null;
    }
    const position = typeof cursor === 'number' ? cursor : 0;

    for (let i = rows.length - 1; i >= 0; i -= 1) {
        const row = rows[i];
        if (position >= row.start) {
            const end = Math.max(row.end, row.start);
            const clamped = Math.min(position, end);
            return {
                rowIndex: i,
                column: clamped - row.start,
            };
        }
    }
    return { rowIndex: 0, column: 0 };
}
```

### getCursorForRow(rows, rowIndex, desiredColumn)

**Purpose**: Gets cursor position for target row and column

**Parameters**:
- `rows` (RowInfo[]): Row layout
- `rowIndex` (number): Target row index
- `desiredColumn` (number): Desired column in row

**Returns**: (number|null) Cursor position

**Implementation**:
```javascript
function getCursorForRow(rows, rowIndex, desiredColumn) {
    const row = rows[rowIndex];
    if (!row) return null;
    const length = Math.max(row.end - row.start, 0);
    const column = Math.max(0, Math.min(desiredColumn, length));
    return row.start + column;
}
```

### handleVerticalNavigation(rl, direction)

**Purpose**: Handles up/down arrow key navigation

**Parameters**:
- `rl` (readline.Interface): Readline interface
- `direction` (string): 'up' or 'down'

**Returns**: (boolean) True if navigation handled

**Implementation**:
```javascript
function handleVerticalNavigation(rl, direction) {
    if (!rl || typeof rl.line !== 'string' || rl.line.length === 0) {
        return false;
    }

    const columns = getTerminalColumns(rl);
    const promptOffset = getPromptColumnOffset(rl, columns);
    const tabSize = typeof rl.tabSize === 'number' && rl.tabSize > 0 ? rl.tabSize : 8;
    const rows = buildRowLayout(rl.line, promptOffset, columns, tabSize);

    if (!rows || rows.length <= 1) {
        return false;
    }

    const cursorInfo = locateCursor(rows, rl.cursor);
    if (!cursorInfo) return false;

    const targetRow = direction === 'up'
        ? cursorInfo.rowIndex - 1
        : cursorInfo.rowIndex + 1;

    if (targetRow < 0 || targetRow >= rows.length) {
        return false;
    }

    const nextCursor = getCursorForRow(rows, targetRow, cursorInfo.column);
    if (typeof nextCursor !== 'number') {
        return false;
    }

    rl.cursor = nextCursor;
    if (typeof rl._refreshLine === 'function') {
        rl._refreshLine();
    }
    return true;
}
```

## Public API

### enableMultilineNavigation(rl)

**Purpose**: Enables vertical navigation for a readline interface

**Parameters**:
- `rl` (readline.Interface): Readline interface to patch

**Behavior**:
1. Checks if already patched (via MULTILINE_FLAG symbol)
2. Wraps `_ttyWrite` method to intercept up/down keys
3. Delegates to `handleVerticalNavigation` for multiline handling
4. Falls back to original behavior for single-line or boundary cases

**Implementation**:
```javascript
export function enableMultilineNavigation(rl) {
    if (!rl || typeof rl._ttyWrite !== 'function' || rl[MULTILINE_FLAG]) {
        return;
    }

    const originalTtyWrite = rl._ttyWrite;
    rl[MULTILINE_FLAG] = true;

    rl._ttyWrite = function patchedTtyWrite(s, key) {
        if (key && (key.name === 'up' || key.name === 'down')
            && !key.ctrl && !key.meta && !key.shift) {
            const handled = handleVerticalNavigation(this, key.name);
            if (handled) {
                return;
            }
        }
        return originalTtyWrite.call(this, s, key);
    };
}
```

## Exports

```javascript
export { enableMultilineNavigation };
```

## Navigation Behavior

| Condition | Up Arrow | Down Arrow |
|-----------|----------|------------|
| Single line | History navigation (original) | History navigation (original) |
| Multiline, on first row | History navigation (original) | Move to next row |
| Multiline, middle rows | Move to previous row | Move to next row |
| Multiline, on last row | Move to previous row | History navigation (original) |

## Column Preservation

When navigating up/down, the column position is preserved when possible:
- If target row is shorter, cursor moves to end of row
- Column offset from prompt is accounted for on first row

## Usage Example

```javascript
import readline from 'readline';
import { enableMultilineNavigation } from './multilineNavigation.js';

const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout
});

// Enable vertical navigation for multiline input
enableMultilineNavigation(rl);

rl.question('Enter multiline text:\n', (answer) => {
    console.log('You entered:', answer);
    rl.close();
});
```

## Related Modules

- [service-input-state.md](./service-input-state.md) - Input state management
- [shell-integration.md](../../shell-integration.md) - Shell integration
