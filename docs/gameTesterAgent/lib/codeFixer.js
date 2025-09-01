// Automated code fixing module for common game issues
const fs = require('fs').promises;
const path = require('path');
const { getAIHelper } = require('./aiHelper');

async function fix(gamePath, issues) {
  console.log(`Analyzing ${issues.length} issues for: ${gamePath}`);
  
  if (issues.length === 0) {
    console.log('No issues to fix.');
    return true;
  }
  
  try {
    let code = await fs.readFile(gamePath, 'utf8');
    let modified = false;
    
    // First, try AI-powered fixing if available
    const aiHelper = getAIHelper();
    if (aiHelper.enabled) {
      console.log('🤖 Using AI to fix the code...');
      const aiFixedCode = await aiHelper.fixCode(code, issues);
      
      if (aiFixedCode) {
        // Backup original file
        const backupPath = gamePath + '.backup';
        await fs.writeFile(backupPath, code);
        console.log(`Backup saved to: ${backupPath}`);
        
        // Write AI-fixed code
        await fs.writeFile(gamePath, aiFixedCode);
        console.log('✅ AI-fixed code written to file.');
        return true;
      } else {
        console.log('AI fixing failed, falling back to rule-based fixes...');
      }
    } else {
      console.log('🔧 Using rule-based fixing (AI not configured)...');
    }
    
    // Group issues by type for efficient fixing
    const issuesByType = groupIssuesByType(issues);
    
    // Apply fixes based on issue type
    if (issuesByType.javascript_error || issuesByType.runtime_error) {
      const result = await fixJavaScriptErrors(code, issuesByType.javascript_error || issuesByType.runtime_error);
      if (result.fixed) {
        code = result.code;
        modified = true;
      }
    }
    
    if (issuesByType.scroll_issue) {
      const result = await fixScrollIssues(code, issuesByType.scroll_issue);
      if (result.fixed) {
        code = result.code;
        modified = true;
      }
    }
    
    if (issuesByType.viewport_issue) {
      const result = await fixViewportIssues(code, issuesByType.viewport_issue);
      if (result.fixed) {
        code = result.code;
        modified = true;
      }
    }
    
    if (issuesByType.color_issue) {
      const result = await fixColorIssues(code, issuesByType.color_issue);
      if (result.fixed) {
        code = result.code;
        modified = true;
      }
    }
    
    if (issuesByType.performance_issue) {
      const result = await fixPerformanceIssues(code, issuesByType.performance_issue);
      if (result.fixed) {
        code = result.code;
        modified = true;
      }
    }
    
    // Save the fixed code
    if (modified) {
      // Backup original file
      const backupPath = gamePath + '.backup';
      const originalCode = await fs.readFile(gamePath, 'utf8');
      await fs.writeFile(backupPath, originalCode);
      console.log(`Backup saved to: ${backupPath}`);
      
      // Write fixed code
      await fs.writeFile(gamePath, code);
      console.log('Fixed code written to file.');
      return true;
    } else {
      console.log('No automatic fixes could be applied.');
      return false;
    }
    
  } catch (error) {
    console.error('Error fixing code:', error);
    return false;
  }
}

function groupIssuesByType(issues) {
  const grouped = {};
  issues.forEach(issue => {
    if (!grouped[issue.type]) {
      grouped[issue.type] = [];
    }
    grouped[issue.type].push(issue);
  });
  return grouped;
}

async function fixJavaScriptErrors(code, errors) {
  console.log('Attempting to fix JavaScript errors...');
  let fixed = false;
  
  errors.forEach(error => {
    // Common fix patterns
    if (error.message && error.message.includes('is not defined')) {
      // Extract variable name
      const match = error.message.match(/(\w+) is not defined/);
      if (match) {
        const varName = match[1];
        
        // Common undefined variables and their fixes
        const commonFixes = {
          'getCTX': 'getContext',
          'getElementByID': 'getElementById',
          'addEventListner': 'addEventListener',
          'removeEventListner': 'removeEventListener'
        };
        
        if (commonFixes[varName]) {
          code = code.replace(new RegExp(`\\b${varName}\\b`, 'g'), commonFixes[varName]);
          fixed = true;
          console.log(`Fixed: ${varName} -> ${commonFixes[varName]}`);
        }
      }
    }
    
    // Fix common typos
    const typoFixes = [
      { from: /\.getCTX\(/g, to: '.getContext(' },
      { from: /getElementByID/g, to: 'getElementById' },
      { from: /addEventListner/g, to: 'addEventListener' },
      { from: /removeEventListner/g, to: 'removeEventListener' },
      { from: /documnet/g, to: 'document' },
      { from: /windwo/g, to: 'window' },
      { from: /consol\./g, to: 'console.' },
      { from: /\.lenght/g, to: '.length' }
    ];
    
    typoFixes.forEach(fix => {
      if (code.match(fix.from)) {
        code = code.replace(fix.from, fix.to);
        fixed = true;
        console.log(`Fixed typo: ${fix.from} -> ${fix.to}`);
      }
    });
  });
  
  return { code, fixed };
}

async function fixScrollIssues(code, issues) {
  console.log('Attempting to fix scroll issues...');
  let fixed = false;
  
  // Check if there's a style section
  if (!code.includes('<style>') && code.includes('</head>')) {
    // Add style section
    code = code.replace('</head>', `  <style>
    /* Auto-fixed scroll issues */
    html, body {
      margin: 0;
      padding: 0;
      overflow: hidden;
      width: 100%;
      height: 100%;
    }
    canvas {
      display: block;
      max-width: 100%;
      max-height: 100vh;
    }
  </style>
</head>`);
    fixed = true;
  } else if (code.includes('<style>')) {
    // Add to existing style section
    const scrollFix = `
    /* Auto-fixed scroll issues */
    html, body {
      margin: 0;
      padding: 0;
      overflow: hidden;
      width: 100%;
      height: 100%;
    }
    canvas {
      display: block;
      max-width: 100%;
      max-height: 100vh;
    }`;
    
    code = code.replace('</style>', scrollFix + '\n  </style>');
    fixed = true;
  }
  
  // Fix canvas size in JavaScript
  issues.forEach(issue => {
    if (issue.subtype === 'canvas_overflow') {
      // Look for canvas size settings
      const canvasPatterns = [
        { 
          from: /canvas\.width\s*=\s*(\d+);/g,
          to: (match, width) => {
            if (parseInt(width) > 1920) {
              return `canvas.width = Math.min(${width}, window.innerWidth);`;
            }
            return match;
          }
        },
        {
          from: /canvas\.height\s*=\s*(\d+);/g,
          to: (match, height) => {
            if (parseInt(height) > 1080) {
              return `canvas.height = Math.min(${height}, window.innerHeight);`;
            }
            return match;
          }
        }
      ];
      
      canvasPatterns.forEach(pattern => {
        if (code.match(pattern.from)) {
          code = code.replace(pattern.from, pattern.to);
          fixed = true;
        }
      });
    }
  });
  
  return { code, fixed };
}

async function fixViewportIssues(code, issues) {
  console.log('Attempting to fix viewport issues...');
  let fixed = false;
  
  issues.forEach(issue => {
    if (issue.subtype === 'missing_viewport') {
      // Add viewport meta tag
      if (!code.includes('viewport') && code.includes('</head>')) {
        code = code.replace('</head>', 
          '  <meta name="viewport" content="width=device-width, initial-scale=1, user-scalable=no" />\n</head>');
        fixed = true;
        console.log('Added viewport meta tag');
      }
    }
    
    if (issue.subtype === 'not_mobile_friendly') {
      // Update existing viewport tag
      code = code.replace(
        /<meta\s+name="viewport"[^>]*>/gi,
        '<meta name="viewport" content="width=device-width, initial-scale=1, user-scalable=no" />'
      );
      fixed = true;
      console.log('Updated viewport meta tag for mobile');
    }
  });
  
  return { code, fixed };
}

async function fixColorIssues(code, issues) {
  console.log('Attempting to fix color contrast issues...');
  let fixed = false;
  
  // Define high-contrast color schemes
  const darkTheme = {
    background: '#0b0f17',
    text: '#e5e7eb',
    accent: '#60a5fa',
    error: '#ef4444',
    success: '#10b981'
  };
  
  const lightTheme = {
    background: '#ffffff',
    text: '#1f2937',
    accent: '#3b82f6',
    error: '#dc2626',
    success: '#059669'
  };
  
  // Check if dark theme is used
  const isDarkTheme = code.includes('#0b0f17') || code.includes('#1a1a1a') || code.includes('#000000');
  const theme = isDarkTheme ? darkTheme : lightTheme;
  
  // Fix low contrast issues
  if (code.includes('<style>')) {
    let styleFixed = false;
    
    // Common low-contrast patterns to fix
    const colorFixes = [
      { from: /color:\s*#[0-9a-f]{6}/gi, check: (color) => {
        // Check if it's a low contrast color
        return false; // Simplified - would need proper contrast calculation
      }},
    ];
    
    // Add CSS variables for consistent theming
    if (!code.includes(':root')) {
      const cssVars = `
    :root {
      --bg-color: ${theme.background};
      --text-color: ${theme.text};
      --accent-color: ${theme.accent};
      --error-color: ${theme.error};
      --success-color: ${theme.success};
    }`;
      
      code = code.replace('<style>', '<style>' + cssVars);
      fixed = true;
    }
  }
  
  return { code, fixed };
}

async function fixPerformanceIssues(code, issues) {
  console.log('Attempting to fix performance issues...');
  let fixed = false;
  
  issues.forEach(issue => {
    if (issue.subtype === 'high_memory') {
      // Add memory cleanup patterns
      if (code.includes('setInterval') && !code.includes('clearInterval')) {
        console.log('Warning: setInterval without clearInterval detected');
        // Would need more context to fix properly
      }
      
      if (code.includes('addEventListener') && !code.includes('removeEventListener')) {
        console.log('Warning: Event listeners might not be cleaned up');
        // Would need more context to fix properly
      }
    }
    
    if (issue.subtype === 'slow_load') {
      // Defer non-critical scripts
      code = code.replace(
        /<script src="([^"]+)"><\/script>/g,
        (match, src) => {
          if (!src.includes('critical')) {
            return `<script src="${src}" defer></script>`;
          }
          return match;
        }
      );
      
      // Add loading="lazy" to images
      code = code.replace(
        /<img([^>]+)>/g,
        (match, attrs) => {
          if (!attrs.includes('loading=')) {
            return `<img${attrs} loading="lazy">`;
          }
          return match;
        }
      );
      
      fixed = true;
    }
  });
  
  return { code, fixed };
}

// Generate fix report
async function generateFixReport(gamePath, issues, fixedIssues) {
  const report = {
    game: gamePath,
    timestamp: new Date().toISOString(),
    totalIssues: issues.length,
    fixedIssues: fixedIssues.length,
    unfixedIssues: issues.length - fixedIssues.length,
    issues: issues.map(issue => ({
      type: issue.type,
      subtype: issue.subtype,
      message: issue.message,
      fixed: fixedIssues.includes(issue)
    }))
  };
  
  const reportPath = gamePath.replace('.html', '_fix_report.json');
  await fs.writeFile(reportPath, JSON.stringify(report, null, 2));
  console.log(`Fix report saved to: ${reportPath}`);
  
  return report;
}

module.exports = { fix, generateFixReport };