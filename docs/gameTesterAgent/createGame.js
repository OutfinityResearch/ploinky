#!/usr/bin/env node

const fs = require('fs').promises;
const path = require('path');
const gameLauncher = require('./lib/gameLauncher');
const gameTester = require('./lib/gameTester');
const codeFixer = require('./lib/codeFixer');
const { getAIHelper } = require('./lib/aiHelper');

const CONFIG = {
  maxAttempts: 5,
  timeout: 30000,
  headless: true,
};

function generateFileName(prompt) {
    const sanitized = prompt.toLowerCase().replace(/[^a-z0-9\s-]/g, '').trim();
    const name = sanitized.split(/\s+/).slice(0, 4).join('-');
    if (!name) {
        return `game-${Date.now()}.html`;
    }
    return `${name}.html`;
}

async function testGame(gamePath) {
  let browser;
  let issues = [];
  
  try {
    const result = await gameLauncher.launch(gamePath, {
      headless: CONFIG.headless,
      timeout: CONFIG.timeout
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

async function createGame(destinationFolder, gamePrompt) {
  console.log('========================================');
  console.log(`Creating new game in: ${destinationFolder}`);
  console.log(`Prompt: "${gamePrompt}"`);
  console.log('========================================\n');

  try {
    await fs.access(destinationFolder);
  } catch (error) {
    console.error(`❌ Destination folder not found: ${destinationFolder}`);
    process.exit(1);
  }

  const fileName = generateFileName(gamePrompt);
  const gamePath = path.join(destinationFolder, fileName);

  console.log('🤖 Calling AI to generate the game code...');
  const aiHelper = getAIHelper();
  if (!aiHelper.enabled) {
      console.error('❌ AI Helper is not enabled. Please check your API key.');
      return { success: false };
  }

  const gameCode = await aiHelper.createGame(gamePrompt);

  if (!gameCode || gameCode.trim() === '') {
    console.error('❌ AI failed to generate game code.');
    return { success: false };
  }

  console.log(`📦 AI returned code. Saving to: ${fileName}`);
  await fs.writeFile(gamePath, gameCode);

  let attempt = 0;
  let lastIssues = [];

  while (attempt < CONFIG.maxAttempts) {
    attempt++;
    console.log(`\n📝 Attempt ${attempt}/${CONFIG.maxAttempts} to validate and fix the new game`);
    console.log('-'.repeat(40));

    const issues = await testGame(gamePath);
    const criticalErrors = issues.filter(issue =>
        issue.type === 'javascript_error' || 
        issue.type === 'runtime_error' || 
        issue.type === 'launch_error'
    );

    if (criticalErrors.length === 0) {
      console.log('\n✅ SUCCESS! The generated game is working correctly!');
      return {
        success: true,
        gamePath: gamePath,
        finalIssues: issues
      };
    }

    console.log(`\nFound ${criticalErrors.length} critical issues:`);
    criticalErrors.forEach(issue => {
      console.log(`  - ${issue.type}: ${issue.message}`);
    });

    if (JSON.stringify(criticalErrors) === JSON.stringify(lastIssues)) {
        console.log('\n⚠️  No progress made in last attempt. Stopping.');
        break;
    }
    lastIssues = criticalErrors;

    console.log('\n🔧 Attempting to fix issues...');
    const fixApplied = await codeFixer.fix(gamePath, criticalErrors, "The game you just generated has some bugs. Please fix them so it's playable and meets all technical requirements.");

    if (!fixApplied) {
      console.log('❌ Code fixer could not apply fixes. Stopping.');
      break;
    }
  }

  console.error(`\n❌ FAILED to create a working game after ${attempt} attempts.`);
  try {
    await fs.unlink(gamePath);
    console.log(`🗑️  Removed broken game file: ${fileName}`);
  } catch (e) {
    console.error(`Could not remove broken file: ${e.message}`);
  }
  
  return { success: false };
}

async function main() {
  const destinationFolder = process.argv[2];
  const gamePrompt = process.argv[3];

  if (!destinationFolder || !gamePrompt) {
    console.log('Usage: node createGame.js <path-to-destination-folder> "<game-prompt>"');
    console.log('Example: node createGame.js ./sources/allAges "a simple breakout game with a blue paddle and red bricks"');
    process.exit(1);
  }

  const resolvedPath = path.resolve(destinationFolder);

  try {
    const result = await createGame(resolvedPath, gamePrompt);

    console.log('\n========================================');
    console.log('CREATION COMPLETE');
    console.log('========================================');
    console.log(`Result: ${result.success ? 'SUCCESS' : 'FAILED'}`);

    if (result.success) {
      console.log(`✅ Game created at: ${result.gamePath}`);
    }

    process.exit(result.success ? 0 : 1);

  } catch (error) {
    console.error('\n❌ Unexpected error during game creation:', error.message);
    process.exit(1);
  }
}

if (require.main === module) {
  main();
}

module.exports = { createGame };
