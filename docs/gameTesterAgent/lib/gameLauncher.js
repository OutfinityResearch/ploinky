// Enhanced game launcher with better configuration and error handling
const puppeteer = require('puppeteer');
const path = require('path');

async function launch(gamePath, options = {}) {
  console.log('Launching game in browser...');
  
  const defaultOptions = {
    headless: options.headless !== false, // Default to headless
    viewport: {
      width: options.width || 1280,
      height: options.height || 720
    },
    deviceScaleFactor: options.deviceScaleFactor || 1,
    isMobile: options.isMobile || false,
    hasTouch: options.hasTouch || false,
    waitUntil: options.waitUntil || 'networkidle2',
    timeout: options.timeout || 30000
  };
  
  try {
    // Launch browser with optimized settings
    const browser = await puppeteer.launch({
      headless: defaultOptions.headless,
      args: [
        '--no-sandbox',
        '--disable-setuid-sandbox',
        '--disable-dev-shm-usage',
        '--disable-accelerated-2d-canvas',
        '--no-first-run',
        '--no-zygote',
        '--disable-gpu'
      ]
    });
    
    const page = await browser.newPage();
    
    // Set viewport
    await page.setViewport({
      width: defaultOptions.viewport.width,
      height: defaultOptions.viewport.height,
      deviceScaleFactor: defaultOptions.deviceScaleFactor,
      isMobile: defaultOptions.isMobile,
      hasTouch: defaultOptions.hasTouch
    });
    
    // Set up error tracking before navigation
    await page.evaluateOnNewDocument(() => {
      window.__ERRORS__ = [];
      window.__CONSOLE_ERRORS__ = [];
      
      // Capture unhandled errors
      window.addEventListener('error', (e) => {
        window.__ERRORS__.push({
          message: e.message,
          filename: e.filename,
          lineno: e.lineno,
          colno: e.colno,
          error: e.error ? e.error.stack : null,
          timestamp: new Date().toISOString()
        });
      });
      
      // Capture unhandled promise rejections
      window.addEventListener('unhandledrejection', (e) => {
        window.__ERRORS__.push({
          message: 'Unhandled Promise Rejection: ' + e.reason,
          error: e.reason,
          timestamp: new Date().toISOString()
        });
      });
      
      // Override console.error
      const originalError = console.error;
      console.error = function(...args) {
        window.__CONSOLE_ERRORS__.push({
          message: args.join(' '),
          timestamp: new Date().toISOString()
        });
        originalError.apply(console, args);
      };
    });
    
    // Set up error listeners BEFORE navigation
    const jsErrors = [];
    const consoleErrors = [];
    
    page.on('pageerror', error => {
      jsErrors.push({
        type: 'javascript_error',
        message: error.message,
        stack: error.stack
      });
    });
    
    page.on('console', msg => {
      if (msg.type() === 'error') {
        consoleErrors.push({
          type: 'console_error',
          message: msg.text(),
          location: msg.location()
        });
      }
    });
    
    // Handle different URL types
    let url;
    if (gamePath.startsWith('http://') || gamePath.startsWith('https://')) {
      url = gamePath;
    } else {
      // Convert to file:// URL
      const absolutePath = path.resolve(gamePath);
      url = `file://${absolutePath}`;
    }
    
    console.log(`Loading: ${url}`);
    
    // Navigate to the game
    try {
      await page.goto(url, {
        waitUntil: defaultOptions.waitUntil,
        timeout: defaultOptions.timeout
      });
    } catch (error) {
      console.error('Navigation error:', error.message);
      // Continue anyway to capture what we can
    }
    
    // Wait a bit for any async initialization
    await new Promise(resolve => setTimeout(resolve, 2000));
    
    // Take a screenshot for debugging
    if (options.screenshot) {
      const screenshotPath = options.screenshotPath || 'game_screenshot.png';
      await page.screenshot({ path: screenshotPath, fullPage: true });
      console.log(`Screenshot saved to: ${screenshotPath}`);
    }
    
    return { browser, page, url, jsErrors, consoleErrors };
    
  } catch (error) {
    console.error('Failed to launch browser:', error);
    throw error;
  }
}

// Test different viewport sizes
async function launchWithMultipleViewports(gamePath, viewports) {
  const results = [];
  
  for (const viewport of viewports) {
    console.log(`Testing with viewport: ${viewport.name} (${viewport.width}x${viewport.height})`);
    
    const { browser, page } = await launch(gamePath, {
      width: viewport.width,
      height: viewport.height,
      isMobile: viewport.isMobile || false,
      hasTouch: viewport.hasTouch || false
    });
    
    results.push({
      viewport: viewport.name,
      browser,
      page
    });
  }
  
  return results;
}

// Common viewport presets
const VIEWPORT_PRESETS = {
  desktop: { name: 'Desktop', width: 1920, height: 1080 },
  laptop: { name: 'Laptop', width: 1366, height: 768 },
  tablet: { name: 'Tablet', width: 768, height: 1024, isMobile: true, hasTouch: true },
  mobile: { name: 'Mobile', width: 375, height: 667, isMobile: true, hasTouch: true },
  mobileL: { name: 'Mobile Landscape', width: 667, height: 375, isMobile: true, hasTouch: true }
};

module.exports = { 
  launch, 
  launchWithMultipleViewports,
  VIEWPORT_PRESETS 
};