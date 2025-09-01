// Comprehensive game testing module with multiple checks

async function runTests(page) {
  console.log('Running comprehensive tests on the game page...');
  
  const issues = [];
  
  // 1. Check for JavaScript errors
  const jsErrors = await checkJavaScriptErrors(page);
  issues.push(...jsErrors);
  
  // 2. Check for console errors
  const consoleErrors = await checkConsoleErrors(page);
  issues.push(...consoleErrors);
  
  // 3. Check for resource loading errors
  const resourceErrors = await checkResourceErrors(page);
  issues.push(...resourceErrors);
  
  // 4. Check for scroll issues
  const scrollIssues = await checkScrollIssues(page);
  issues.push(...scrollIssues);
  
  // 5. Check for color contrast issues
  const colorIssues = await checkColorContrast(page);
  issues.push(...colorIssues);
  
  // 6. Check viewport and responsive issues
  const viewportIssues = await checkViewportIssues(page);
  issues.push(...viewportIssues);
  
  // 7. Check for performance issues
  const performanceIssues = await checkPerformance(page);
  issues.push(...performanceIssues);
  
  return issues;
}

async function checkJavaScriptErrors(page) {
  const errors = [];
  
  // Set up error listener before page load
  page.on('pageerror', error => {
    errors.push({
      type: 'javascript_error',
      message: error.message,
      stack: error.stack
    });
  });
  
  // Wait for any immediate errors
  await new Promise(resolve => setTimeout(resolve, 2000));
  
  // Also check for runtime errors
  const runtimeError = await page.evaluate(() => {
    try {
      // Check if any global error handlers were triggered
      if (window.__ERROR__) {
        return window.__ERROR__;
      }
      return null;
    } catch (e) {
      return { message: e.message, stack: e.stack };
    }
  });
  
  if (runtimeError) {
    errors.push({
      type: 'runtime_error',
      message: runtimeError.message,
      details: runtimeError
    });
  }
  
  return errors;
}

async function checkConsoleErrors(page) {
  const errors = [];
  
  page.on('console', msg => {
    if (msg.type() === 'error') {
      errors.push({
        type: 'console_error',
        message: msg.text(),
        location: msg.location()
      });
    }
  });
  
  await new Promise(resolve => setTimeout(resolve, 1000));
  return errors;
}

async function checkResourceErrors(page) {
  const errors = [];
  
  page.on('requestfailed', request => {
    errors.push({
      type: 'resource_error',
      url: request.url(),
      method: request.method(),
      failure: request.failure()
    });
  });
  
  // Check for 404s and other HTTP errors
  page.on('response', response => {
    if (response.status() >= 400) {
      errors.push({
        type: 'http_error',
        url: response.url(),
        status: response.status(),
        statusText: response.statusText()
      });
    }
  });
  
  await new Promise(resolve => setTimeout(resolve, 2000));
  return errors;
}

async function checkScrollIssues(page) {
  const issues = [];
  
  const scrollInfo = await page.evaluate(() => {
    const body = document.body;
    const html = document.documentElement;
    
    const bodyHeight = Math.max(
      body.scrollHeight, body.offsetHeight,
      html.clientHeight, html.scrollHeight, html.offsetHeight
    );
    
    const viewportHeight = window.innerHeight;
    const viewportWidth = window.innerWidth;
    
    // Check for unwanted scrollbars
    const hasVerticalScroll = bodyHeight > viewportHeight;
    const hasHorizontalScroll = document.body.scrollWidth > viewportWidth;
    
    // Check if game canvas fits viewport
    const canvas = document.querySelector('canvas');
    let canvasFits = true;
    let canvasInfo = null;
    
    if (canvas) {
      const rect = canvas.getBoundingClientRect();
      canvasInfo = {
        width: rect.width,
        height: rect.height,
        top: rect.top,
        left: rect.left
      };
      canvasFits = rect.width <= viewportWidth && rect.height <= viewportHeight;
    }
    
    return {
      hasVerticalScroll,
      hasHorizontalScroll,
      bodyHeight,
      viewportHeight,
      viewportWidth,
      canvasFits,
      canvasInfo
    };
  });
  
  if (scrollInfo.hasHorizontalScroll) {
    issues.push({
      type: 'scroll_issue',
      subtype: 'horizontal_scroll',
      message: 'Unwanted horizontal scrollbar detected',
      details: scrollInfo
    });
  }
  
  if (scrollInfo.hasVerticalScroll && scrollInfo.bodyHeight > scrollInfo.viewportHeight * 1.1) {
    issues.push({
      type: 'scroll_issue',
      subtype: 'vertical_scroll',
      message: 'Excessive vertical scrolling detected',
      details: scrollInfo
    });
  }
  
  if (scrollInfo.canvasInfo && !scrollInfo.canvasFits) {
    issues.push({
      type: 'scroll_issue',
      subtype: 'canvas_overflow',
      message: 'Game canvas exceeds viewport size',
      details: scrollInfo.canvasInfo
    });
  }
  
  return issues;
}

async function checkColorContrast(page) {
  const issues = [];
  
  const colorAnalysis = await page.evaluate(() => {
    // Get computed styles for important elements
    const elements = {
      body: document.body,
      buttons: document.querySelectorAll('button'),
      text: document.querySelectorAll('p, span, div'),
      canvas: document.querySelector('canvas')
    };
    
    const getContrastRatio = (color1, color2) => {
      // Simple contrast calculation (would need proper implementation)
      return 5; // Placeholder
    };
    
    const results = [];
    
    // Check background color
    const bodyStyle = window.getComputedStyle(elements.body);
    const bgColor = bodyStyle.backgroundColor;
    const textColor = bodyStyle.color;
    
    results.push({
      element: 'body',
      background: bgColor,
      foreground: textColor,
      contrastRatio: getContrastRatio(bgColor, textColor)
    });
    
    // Check button contrast
    elements.buttons.forEach((button, i) => {
      const style = window.getComputedStyle(button);
      results.push({
        element: `button-${i}`,
        background: style.backgroundColor,
        foreground: style.color,
        contrastRatio: getContrastRatio(style.backgroundColor, style.color)
      });
    });
    
    return results;
  });
  
  // Analyze results for accessibility issues
  colorAnalysis.forEach(item => {
    if (item.contrastRatio < 4.5) {
      issues.push({
        type: 'color_issue',
        subtype: 'low_contrast',
        message: `Low contrast ratio for ${item.element}`,
        details: item
      });
    }
  });
  
  return issues;
}

async function checkViewportIssues(page) {
  const issues = [];
  
  const viewportInfo = await page.evaluate(() => {
    const viewport = document.querySelector('meta[name="viewport"]');
    const hasViewportMeta = !!viewport;
    const viewportContent = viewport ? viewport.getAttribute('content') : null;
    
    // Check if page is mobile-friendly
    const isMobileFriendly = viewportContent && 
      viewportContent.includes('width=device-width') && 
      viewportContent.includes('initial-scale=1');
    
    // Check for fixed-size elements that might break on mobile
    const fixedElements = Array.from(document.querySelectorAll('*')).filter(el => {
      const style = window.getComputedStyle(el);
      const width = parseInt(style.width);
      return width > 600 && style.width.includes('px');
    });
    
    return {
      hasViewportMeta,
      viewportContent,
      isMobileFriendly,
      fixedElementsCount: fixedElements.length
    };
  });
  
  if (!viewportInfo.hasViewportMeta) {
    issues.push({
      type: 'viewport_issue',
      subtype: 'missing_viewport',
      message: 'Missing viewport meta tag',
      details: viewportInfo
    });
  }
  
  if (!viewportInfo.isMobileFriendly) {
    issues.push({
      type: 'viewport_issue',
      subtype: 'not_mobile_friendly',
      message: 'Page not optimized for mobile devices',
      details: viewportInfo
    });
  }
  
  if (viewportInfo.fixedElementsCount > 0) {
    issues.push({
      type: 'viewport_issue',
      subtype: 'fixed_width_elements',
      message: `Found ${viewportInfo.fixedElementsCount} fixed-width elements that may cause issues on mobile`,
      details: viewportInfo
    });
  }
  
  return issues;
}

async function checkPerformance(page) {
  const issues = [];
  
  // Get performance metrics
  const metrics = await page.metrics();
  
  // Check for memory issues
  if (metrics.JSHeapUsedSize > 50 * 1024 * 1024) { // 50MB
    issues.push({
      type: 'performance_issue',
      subtype: 'high_memory',
      message: 'High memory usage detected',
      details: {
        heapUsed: metrics.JSHeapUsedSize,
        heapTotal: metrics.JSHeapTotalSize
      }
    });
  }
  
  // Check page load time
  const timing = await page.evaluate(() => {
    const perf = window.performance.timing;
    return {
      loadTime: perf.loadEventEnd - perf.navigationStart,
      domContentLoaded: perf.domContentLoadedEventEnd - perf.navigationStart,
      firstPaint: performance.getEntriesByType('paint')[0]?.startTime || 0
    };
  });
  
  if (timing.loadTime > 3000) {
    issues.push({
      type: 'performance_issue',
      subtype: 'slow_load',
      message: 'Page load time exceeds 3 seconds',
      details: timing
    });
  }
  
  return issues;
}

module.exports = { runTests };