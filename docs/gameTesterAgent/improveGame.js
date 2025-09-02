#!/usr/bin/env node

const fs = require('fs').promises;
const path = require('path');
const gameLauncher = require('./lib/gameLauncher');
const gameTester = require('./lib/gameTester');
const codeFixer = require('./lib/codeFixer');

const CONFIG = {
  timeout: 60000, // Increased timeout for potentially complex AI generation
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
    
    if (result.jsErrors && result.jsErrors.length > 0) {
      issues.push(...result.jsErrors);
    }
    if (result.consoleErrors && result.consoleErrors.length > 0) {
      issues.push(...result.consoleErrors);
    }
    
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

async function improveGame(gamePath, improvementPrompt) {
  const gameName = path.basename(gamePath);
  const gameDir = path.dirname(gamePath);
  const gameBaseName = path.basename(gamePath, '.html');
  const backupPath = path.join(gameDir, `${gameBaseName}.html.backup`);
  
  console.log('========================================');
  console.log(`Improving: ${gameName}`);
  console.log(`Prompt: "${improvementPrompt}"`);
  console.log('========================================\n');
  
  try {
    await fs.access(gamePath);
  } catch (error) {
    console.error(`❌ File not found: ${gamePath}`);
    process.exit(1);
  }

  // First, test the original game to ensure it's not completely broken
  console.log('Testing original game...');
  const originalIssues = await testGame(gamePath);
  const originalCriticalErrors = originalIssues.filter(issue =>
    issue.type === 'javascript_error' || issue.type === 'runtime_error' || issue.type === 'launch_error'
  );

  if (originalCriticalErrors.length > 0) {
      console.error(`❌ Original game has ${originalCriticalErrors.length} critical errors. Please fix it first using fixGame.js.`);
      originalCriticalErrors.forEach(issue => console.log(`  - ${issue.type}: ${issue.message}`));
      return { success: false, finalIssues: originalCriticalErrors, improvementApplied: false };
  }
  console.log('✅ Original game seems to be working. Proceeding with improvement.');

  console.log(`\nCreating backup: ${path.basename(backupPath)}`);
  await fs.copyFile(gamePath, backupPath);
  
  console.log('\n🔧 Attempting to improve the game with AI...');
  const improvementApplied = await codeFixer.improve(gamePath, improvementPrompt);
  
  if (!improvementApplied) {
    console.error('❌ AI could not generate an improvement. The original file was not modified.');
    await fs.unlink(backupPath); // remove useless backup
    return { success: false, finalIssues: originalIssues, improvementApplied: false };
  }
  
  console.log('\n📊 Testing the improved version...');
  const finalIssues = await testGame(gamePath);
  const criticalErrors = finalIssues.filter(issue =>
    issue.type === 'javascript_error' || issue.type === 'runtime_error' || issue.type === 'launch_error'
  );
  
  if (criticalErrors.length === 0) {
    console.log('\n✅ SUCCESS! The improved game works correctly!');
    console.log(`✅ Improved file saved: ${path.basename(gamePath)}`);
    console.log(`📁 Backup of original saved as: ${path.basename(backupPath)}`);
    return {
      success: true,
      finalIssues: finalIssues,
      improvementApplied: true,
      improvedFile: gamePath,
      backupFile: backupPath
    };
  } else {
    console.log(`\n❌ FAILED: The improved version has ${criticalErrors.length} critical errors:`);
    criticalErrors.forEach(issue => {
      console.log(`  - ${issue.type}: ${issue.message}`);
    });
    
    console.log(`\n🔄 Restoring original from backup...`);
    await fs.copyFile(backupPath, gamePath);
    await fs.unlink(backupPath);
    console.log(`✅ Original file restored`);
    
    return {
      success: false,
      finalIssues: finalIssues,
      improvementApplied: true, // AI did something, but it was bad
      improvedFile: null
    };
  }
}

async function main() {
  const gamePath = process.argv[2];
  const improvementPrompt = process.argv[3];
  
  if (!gamePath || !improvementPrompt) {
    console.log('Usage: node improveGame.js <path-to-game.html> "<improvement-prompt>"');
    console.log('Example: node improveGame.js ./games/my-game.html "Add a scoring system and a timer"');
    process.exit(1);
  }
  
  const resolvedPath = path.resolve(gamePath);
  
  try {
    const result = await improveGame(resolvedPath, improvementPrompt);
    
    console.log('\n========================================');
    console.log('IMPROVEMENT COMPLETE');
    console.log('========================================');
    console.log(`Result: ${result.success ? 'SUCCESS' : 'FAILED'}`);
    if(result.finalIssues) {
        console.log(`Remaining issues: ${result.finalIssues.length}`);
    }
    
    const reportPath = path.join(path.dirname(resolvedPath), `${path.basename(resolvedPath, '.html')}-improvement-report.json`);
    await fs.writeFile(reportPath, JSON.stringify(result, null, 2));
    console.log(`\nReport saved to: ${reportPath}`);
    
    process.exit(result.success ? 0 : 1);
    
  } catch (error) {
    console.error('\n❌ Unexpected error:', error.message);
    process.exit(1);
  }
}

if (require.main === module) {
  main();
}

module.exports = { improveGame, testGame };
