#!/usr/bin/env node

const fs = require('fs').promises;
const path = require('path');
const gameLauncher = require('./lib/gameLauncher');
const gameTester = require('./lib/gameTester');
const codeFixer = require('./lib/codeFixer');

// Configuration
const CONFIG = {
  maxAttempts: 5,
  timeout: 30000,
  headless: true,
  useAI: process.env.OPENAI_API_KEY ? true : false
};

async function testGame(gamePath) {
  let browser;
  let issues = [];
  
  try {
    const result = await gameLauncher.launch(gamePath, {
      headless: CONFIG.headless,
      timeout: CONFIG.timeout,
      screenshot: false
    });
    
    browser = result.browser;
    const page = result.page;
    
    // Add errors detected during page load
    if (result.jsErrors && result.jsErrors.length > 0) {
      issues.push(...result.jsErrors);
    }
    if (result.consoleErrors && result.consoleErrors.length > 0) {
      issues.push(...result.consoleErrors);
    }
    
    // Run additional tests to detect issues
    const testIssues = await gameTester.runTests(page);
    issues.push(...testIssues);
    
  } catch (error) {
    issues.push({
      type: 'launch_error',
      message: error.message
    });
  } finally {
    if (browser) {
      await browser.close();
    }
  }
  
  return issues;
}

async function fixGame(gamePath) {
  const gameName = path.basename(gamePath);
  const gameDir = path.dirname(gamePath);
  const gameBaseName = path.basename(gamePath, '.html');
  const fixedGamePath = path.join(gameDir, `${gameBaseName}_fixed.html`);
  
  console.log('========================================');
  console.log(`Fixing: ${gameName}`);
  console.log('========================================\n');
  
  // Check if file exists
  try {
    await fs.access(gamePath);
  } catch (error) {
    console.error(`❌ File not found: ${gamePath}`);
    process.exit(1);
  }
  
  // Create a copy to work with
  console.log(`Creating working copy: ${path.basename(fixedGamePath)}`);
  await fs.copyFile(gamePath, fixedGamePath);
  
  let attempt = 0;
  let lastIssues = [];
  
  while (attempt < CONFIG.maxAttempts) {
    attempt++;
    console.log(`\n📝 Attempt ${attempt}/${CONFIG.maxAttempts}`);
    console.log('-'.repeat(40));
    
    // Test the fixed game
    console.log('Testing fixed game...');
    const issues = await testGame(fixedGamePath);
    
    if (issues.length === 0) {
      console.log('\n✅ SUCCESS! Game is now working correctly!');
      return {
        success: true,
        attempts: attempt,
        finalIssues: []
      };
    }
    
    console.log(`\nFound ${issues.length} issues:`);
    issues.forEach(issue => {
      console.log(`  - ${issue.type}: ${issue.message}`);
    });
    
    // Check if we're making progress
    if (JSON.stringify(issues) === JSON.stringify(lastIssues)) {
      console.log('\n⚠️  No progress made in last attempt.');
      if (attempt >= 2) {
        console.log('Stopping to avoid infinite loop.');
        break;
      }
    }
    lastIssues = issues;
    
    // Try to fix the issues
    console.log('\n🔧 Attempting to fix issues...');
    
    try {
      const fixApplied = await codeFixer.fix(fixedGamePath, issues);
      
      if (fixApplied) {
        console.log(`✅ Fixes applied successfully`);
        // Continue to next iteration to test if it works
        continue;
      } else {
        console.log('❌ Could not apply fixes automatically');
        
        // AI already tried inside codeFixer.fix, so no need to try again
        
        // No more fixes available
        if (attempt >= 2) {
          console.log('\n❌ Unable to fix all issues automatically.');
          break;
        }
      }
      
    } catch (error) {
      console.error('Error during fix attempt:', error.message);
      break;
    }
  }
  
  // Final test
  console.log('\n📊 Final test...');
  const finalIssues = await testGame(fixedGamePath);
  
  if (finalIssues.length === 0) {
    console.log('\n✅ SUCCESS! Game is now working correctly!');
    console.log(`✅ Fixed version saved as: ${path.basename(fixedGamePath)}`);
    return {
      success: true,
      attempts: attempt,
      finalIssues: [],
      fixedFile: fixedGamePath
    };
  } else {
    console.log(`\n❌ FAILED: Still ${finalIssues.length} issues remaining:`);
    finalIssues.forEach(issue => {
      console.log(`  - ${issue.type}: ${issue.message}`);
    });
    
    // If we couldn't fix it, delete the broken fixed file
    console.log(`\n🗑️  Removing unsuccessful fix attempt: ${path.basename(fixedGamePath)}`);
    await fs.unlink(fixedGamePath);
    
    return {
      success: false,
      attempts: attempt,
      finalIssues: finalIssues,
      fixedFile: null
    };
  }
}

async function main() {
  // Get game path from command line
  const gamePath = process.argv[2];
  
  if (!gamePath) {
    console.log('Usage: node fixGame.js <path-to-game.html>');
    console.log('Example: node fixGame.js ./games/my-game.html');
    process.exit(1);
  }
  
  const resolvedPath = path.resolve(gamePath);
  
  try {
    const result = await fixGame(resolvedPath);
    
    console.log('\n========================================');
    console.log('FIX COMPLETE');
    console.log('========================================');
    console.log(`Result: ${result.success ? 'SUCCESS' : 'FAILED'}`);
    console.log(`Attempts: ${result.attempts}`);
    console.log(`Remaining issues: ${result.finalIssues.length}`);
    
    // Save result to file
    const reportPath = path.join(path.dirname(resolvedPath), `${path.basename(resolvedPath, '.html')}-fix-report.json`);
    await fs.writeFile(reportPath, JSON.stringify(result, null, 2));
    console.log(`\nReport saved to: ${reportPath}`);
    
    process.exit(result.success ? 0 : 1);
    
  } catch (error) {
    console.error('\n❌ Unexpected error:', error.message);
    process.exit(1);
  }
}

// Run if called directly
if (require.main === module) {
  main();
}

module.exports = { fixGame, testGame };