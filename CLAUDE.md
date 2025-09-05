# Ploinky Development Notes

## Known Issues and Fixes

### Cloud Login Interactive Mode Issue (Fixed)

**Problem**: When running `cloud login` in interactive mode, the session would exit after entering the password instead of returning to the Ploinky prompt.

**Cause**: The `promptPassword` function in `/cli/lib/cloudCommands.js` was calling `process.stdin.pause()` which completely stopped the stdin stream, causing the interactive session to terminate.

**Solution**: 
1. Removed `process.stdin.pause()` from the cleanup function
2. Only remove the event listener without pausing stdin
3. Properly save and restore the original stdin state (raw mode and encoding)

**Files Modified**:
- `/cli/lib/cloudCommands.js` - Modified `promptPassword` method to not pause stdin

### CloudCommands Constructor Error (Fixed)  

**Problem**: "CloudCommands is not a constructor" error when running cloud commands.

**Cause**: Module export/import mismatch - cloudCommands.js was exporting `{ CloudCommands }` but cli.js was importing it as `CloudCommands`.

**Solution**: Changed export in cloudCommands.js from `module.exports = { CloudCommands }` to `module.exports = CloudCommands`

**Files Modified**:
- `/cli/lib/cloudCommands.js` - Changed module export statement