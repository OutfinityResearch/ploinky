#!/usr/bin/env node

const fs = require('fs').promises;
const path = require('path');
const gameLauncher = require('./lib/gameLauncher');
const gameTester = require('./lib/gameTester');

// Configuration
const CONFIG = {
  timeout: 30000,
  headless: true,
  screenshot: true,
  generateHtmlReport: true,
  outputDir: path.join(__dirname, 'scan-results')
};

async function scanGame(gamePath) {
  const gameName = path.basename(gamePath);
  console.log(`\nScanning: ${gameName}`);
  
  let browser;
  let issues = [];
  
  try {
    // Launch browser and load game
    const screenshotPath = CONFIG.screenshot ? 
      path.join(CONFIG.outputDir, 'screenshots', `${gameName}.png`) : null;
    
    const result = await gameLauncher.launch(gamePath, {
      headless: CONFIG.headless,
      timeout: CONFIG.timeout,
      screenshot: CONFIG.screenshot,
      screenshotPath: screenshotPath
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
    console.log(`❌ ${gameName}: Failed to scan - ${error.message}`);
    issues.push({
      type: 'scan_error',
      message: error.message
    });
  } finally {
    if (browser) {
      await browser.close();
    }
  }
  
  // Separate critical errors from warnings
  const criticalErrors = issues.filter(issue => 
    issue.type === 'javascript_error' || 
    issue.type === 'console_error' ||
    issue.type === 'runtime_error' ||
    issue.type === 'launch_error' ||
    issue.type === 'scan_error'
  );
  
  const warnings = issues.filter(issue => 
    issue.type === 'viewport_issue' ||
    issue.type === 'performance_issue' ||
    issue.type === 'color_contrast'
  );
  
  // Display results
  if (criticalErrors.length === 0 && warnings.length === 0) {
    console.log(`✅ ${gameName}: No issues detected`);
  } else if (criticalErrors.length > 0) {
    console.log(`❌ ${gameName}: Found ${criticalErrors.length} ERRORS and ${warnings.length} warnings`);
    criticalErrors.forEach(error => {
      console.log(`   - ERROR: ${error.type}: ${error.message}`);
    });
    warnings.forEach(warning => {
      console.log(`   - WARNING: ${warning.type}: ${warning.message}`);
    });
  } else {
    console.log(`⚠️  ${gameName}: Found ${warnings.length} warnings (no critical errors)`);
    warnings.forEach(warning => {
      console.log(`   - WARNING: ${warning.type}: ${warning.message}`);
    });
  }
  
  return {
    game: gamePath,
    name: gameName,
    hasErrors: criticalErrors.length > 0,
    hasCriticalErrors: criticalErrors.length > 0,
    hasWarnings: warnings.length > 0,
    criticalErrorCount: criticalErrors.length,
    warningCount: warnings.length,
    errorCount: issues.length,
    criticalErrors: criticalErrors,
    warnings: warnings,
    errors: issues // Keep for backwards compatibility
  };
}

async function findHtmlFiles(dir) {
  const files = [];
  
  async function scanDir(currentDir) {
    const entries = await fs.readdir(currentDir, { withFileTypes: true });
    
    for (const entry of entries) {
      const fullPath = path.join(currentDir, entry.name);
      
      if (entry.isDirectory()) {
        await scanDir(fullPath);
      } else if (entry.isFile() && entry.name.endsWith('.html')) {
        files.push(fullPath);
      }
    }
  }
  
  await scanDir(dir);
  return files;
}

function generateHtmlReport(results) {
  const gamesWithCriticalErrors = results.filter(r => r.hasCriticalErrors);
  const gamesWithWarnings = results.filter(r => r.hasWarnings && !r.hasCriticalErrors);
  const totalCriticalErrors = results.reduce((sum, r) => sum + r.criticalErrorCount, 0);
  const totalWarnings = results.reduce((sum, r) => sum + r.warningCount, 0);
  
  const html = `<!DOCTYPE html>
<html>
<head>
  <title>Game Scan Report</title>
  <style>
    body { font-family: Arial, sans-serif; margin: 20px; background: #f5f5f5; }
    h1 { color: #333; }
    .summary { background: white; padding: 20px; border-radius: 8px; margin-bottom: 20px; }
    .stats { display: flex; gap: 20px; margin: 20px 0; }
    .stat { flex: 1; padding: 15px; background: #f8f9fa; border-radius: 8px; text-align: center; }
    .stat.success { background: #d4edda; color: #155724; }
    .stat.error { background: #f8d7da; color: #721c24; }
    .stat.warning { background: #fff3cd; color: #856404; }
    table { width: 100%; background: white; border-collapse: collapse; }
    th, td { padding: 10px; text-align: left; border-bottom: 1px solid #ddd; }
    th { background: #f8f9fa; }
    .status { padding: 4px 8px; border-radius: 4px; font-size: 12px; font-weight: bold; }
    .status.passed { background: #28a745; color: white; }
    .status.failed { background: #dc3545; color: white; }
    .status.warning { background: #ffc107; color: #333; }
    .screenshot { max-width: 200px; height: auto; cursor: pointer; }
    .modal { display: none; position: fixed; z-index: 1; left: 0; top: 0; width: 100%; height: 100%; background: rgba(0,0,0,0.9); }
    .modal-content { margin: auto; display: block; max-width: 90%; max-height: 90%; }
    .close { position: absolute; top: 15px; right: 35px; color: #f1f1f1; font-size: 40px; font-weight: bold; cursor: pointer; }
  </style>
</head>
<body>
  <h1>Game Scan Report</h1>
  <div class="summary">
    <h2>Summary</h2>
    <p>Generated: ${new Date().toISOString()}</p>
    <div class="stats">
      <div class="stat">
        <h3>${results.length}</h3>
        <p>Total Games</p>
      </div>
      <div class="stat ${gamesWithCriticalErrors.length === 0 ? 'success' : 'error'}">
        <h3>${gamesWithCriticalErrors.length}</h3>
        <p>Failed (Errors)</p>
      </div>
      <div class="stat ${gamesWithWarnings.length > 0 ? 'warning' : ''}">
        <h3>${gamesWithWarnings.length}</h3>
        <p>Warning Only</p>
      </div>
      <div class="stat success">
        <h3>${results.filter(r => !r.hasCriticalErrors && !r.hasWarnings).length}</h3>
        <p>Passed Clean</p>
      </div>
    </div>
  </div>
  
  <div class="summary">
    <h2>Game Results</h2>
    <table>
      <tr>
        <th>Game</th>
        <th>Status</th>
        <th>Errors</th>
        <th>Details</th>
        <th>Screenshot</th>
      </tr>
      ${results.map(game => {
        let statusClass = 'passed';
        let statusText = 'PASSED';
        if (game.hasCriticalErrors) {
          statusClass = 'failed';
          statusText = 'FAILED';
        } else if (game.hasWarnings) {
          statusClass = 'warning';
          statusText = 'WARNING';
        }
        
        const issuesList = [
          ...game.criticalErrors.map(e => `<b style="color:red">ERROR:</b> ${e.type}: ${e.message}`),
          ...game.warnings.map(w => `<b style="color:orange">WARNING:</b> ${w.type}: ${w.message}`)
        ].join('<br>');
        
        return `
        <tr>
          <td>${game.name}</td>
          <td><span class="status ${statusClass}">${statusText}</span></td>
          <td>${game.criticalErrorCount} / ${game.warningCount}</td>
          <td>${issuesList || 'No issues'}</td>
          <td>${CONFIG.screenshot ? `<img src="screenshots/${game.name}.png" class="screenshot" onclick="openModal(this.src)">` : 'N/A'}</td>
        </tr>
      `;
      }).join('')}
    </table>
  </div>
  
  <div id="myModal" class="modal" onclick="closeModal()">
    <span class="close">&times;</span>
    <img class="modal-content" id="modalImg">
  </div>
  
  <script>
    function openModal(src) {
      document.getElementById('myModal').style.display = "block";
      document.getElementById('modalImg').src = src;
    }
    function closeModal() {
      document.getElementById('myModal').style.display = "none";
    }
  </script>
</body>
</html>`;
  
  return html;
}

async function main() {
  // Get directory from command line or use current directory
  const targetDir = process.argv[2] ? path.resolve(process.argv[2]) : process.cwd();
  
  console.log('========================================');
  console.log('HTML Game Error Scanner');
  console.log('========================================');
  console.log(`Scanning directory: ${targetDir}\n`);
  
  try {
    // Create output directories
    await fs.mkdir(CONFIG.outputDir, { recursive: true });
    if (CONFIG.screenshot) {
      await fs.mkdir(path.join(CONFIG.outputDir, 'screenshots'), { recursive: true });
    }
    
    // Find all HTML files
    const htmlFiles = await findHtmlFiles(targetDir);
    
    if (htmlFiles.length === 0) {
      console.log('No HTML files found in the specified directory.');
      process.exit(0);
    }
    
    console.log(`Found ${htmlFiles.length} HTML files to scan.\n`);
    
    // Scan each file
    const results = [];
    for (const file of htmlFiles) {
      const result = await scanGame(file);
      results.push(result);
    }
    
    // Summary
    console.log('\n========================================');
    console.log('SCAN COMPLETE');
    console.log('========================================');
    
    const gamesWithCriticalErrors = results.filter(r => r.hasCriticalErrors);
    const gamesWithOnlyWarnings = results.filter(r => r.hasWarnings && !r.hasCriticalErrors);
    const totalCriticalErrors = results.reduce((sum, r) => sum + r.criticalErrorCount, 0);
    const totalWarnings = results.reduce((sum, r) => sum + r.warningCount, 0);
    
    console.log(`Total files scanned: ${results.length}`);
    console.log(`Files with CRITICAL ERRORS: ${gamesWithCriticalErrors.length}`);
    console.log(`Files with warnings only: ${gamesWithOnlyWarnings.length}`);
    console.log(`Total critical errors: ${totalCriticalErrors}`);
    console.log(`Total warnings: ${totalWarnings}`);
    
    if (gamesWithCriticalErrors.length > 0) {
      console.log('\nGames with CRITICAL ERRORS:');
      gamesWithCriticalErrors.forEach(game => {
        console.log(`  - ${game.name} (${game.criticalErrorCount} critical errors, ${game.warningCount} warnings)`);
      });
    }
    
    if (gamesWithOnlyWarnings.length > 0) {
      console.log('\nGames with warnings only:');
      gamesWithOnlyWarnings.forEach(game => {
        console.log(`  - ${game.name} (${game.warningCount} warnings)`);
      });
    }
      
    if (gamesWithCriticalErrors.length > 0 || gamesWithOnlyWarnings.length > 0) {
      // Save JSON results
      const jsonPath = path.join(CONFIG.outputDir, 'scan-results.json');
      await fs.writeFile(jsonPath, JSON.stringify(results, null, 2));
      console.log(`\nDetailed results saved to: ${jsonPath}`);
      
      // Generate and save HTML report
      if (CONFIG.generateHtmlReport) {
        const htmlReport = generateHtmlReport(results);
        const htmlPath = path.join(CONFIG.outputDir, 'report.html');
        await fs.writeFile(htmlPath, htmlReport);
        console.log(`HTML report saved to: ${htmlPath}`);
      }
      
    }
    
    // Exit with error code only if critical errors found
    if (gamesWithCriticalErrors.length > 0) {
      process.exit(1);
    } else {
      console.log('\n✅ No critical errors found!');
      process.exit(0);
    }
    
  } catch (error) {
    console.error('Error during scan:', error.message);
    process.exit(1);
  }
}

// Run if called directly
if (require.main === module) {
  main();
}

module.exports = { scanGame, findHtmlFiles };