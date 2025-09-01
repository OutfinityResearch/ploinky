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
  const ignoredMessages = [
    'Failed to load resource', // Often a duplicate of a resource_error
    'favicon.ico',
  ];

  page.on('console', msg => {
    if (msg.type() === 'error') {
      const text = msg.text();
      if (!ignoredMessages.some(ignored => text.includes(ignored))) {
        errors.push({
          type: 'console_error',
          message: text,
          location: msg.location()
        });
      }
    }
  });

  await new Promise(resolve => setTimeout(resolve, 1000));
  return errors;
}

async function checkResourceErrors(page) {
  const errors = [];
  const ignoredHosts = [
    'google-analytics.com',
    'googletagmanager.com',
    'doubleclick.net',
    'facebook.net',
    'twitter.com',
  ];

  page.on('requestfailed', request => {
    const url = request.url();
    if (url.endsWith('favicon.ico')) {
      return;
    }
    const hostname = new URL(url).hostname;
    if (ignoredHosts.some(ignored => hostname.includes(ignored))) {
      return;
    }
    errors.push({
      type: 'resource_error',
      url: url,
      method: request.method(),
      failure: request.failure()
    });
  });

  // Check for 404s and other HTTP errors
  page.on('response', response => {
    const url = response.url();
    if (url.endsWith('favicon.ico') && response.status() === 404) {
      return;
    }
    if (response.status() >= 400) {
      errors.push({
        type: 'http_error',
        url: url,
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
    // Helper function to parse a CSS color string (rgb, rgba)
    function parseColor(colorString) {
      if (!colorString) return null;
      const rgb = colorString.match(/(\d+(\.\d+)?)/g);
      if (rgb) {
        return rgb.slice(0, 3).map(c => parseInt(c, 10));
      }
      return null;
    }

    // Helper function to calculate relative luminance
    function getLuminance(r, g, b) {
      const a = [r, g, b].map(v => {
        v /= 255;
        return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4);
      });
      return a[0] * 0.2126 + a[1] * 0.7152 + a[2] * 0.0722;
    }

    // Helper function to calculate contrast ratio
    function getContrastRatio(color1, color2) {
      const rgb1 = parseColor(color1);
      const rgb2 = parseColor(color2);

      if (!rgb1 || !rgb2) {
        return 1; // Not enough info to calculate
      }

      const lum1 = getLuminance(rgb1[0], rgb1[1], rgb1[2]);
      const lum2 = getLuminance(rgb2[0], rgb2[1], rgb2[2]);

      const brightest = Math.max(lum1, lum2);
      const darkest = Math.min(lum1, lum2);

      return (brightest + 0.05) / (darkest + 0.05);
    }

    const results = [];
    const elements = Array.from(document.querySelectorAll('body, button, p, span, div, a, h1, h2, h3'));

    elements.forEach((el, i) => {
      const style = window.getComputedStyle(el);
      const bgColor = style.backgroundColor;
      const textColor = style.color;
      
      // Only check elements with a non-transparent background
      if (bgColor && !bgColor.startsWith('rgba(0, 0, 0, 0)')) {
        const contrastRatio = getContrastRatio(bgColor, textColor);
        results.push({
          element: `${el.tagName.toLowerCase()}-${i}`,
          background: bgColor,
          foreground: textColor,
          contrastRatio: contrastRatio,
          text: el.innerText.substring(0, 50)
        });
      }
    });

    return results;
  });

  // Analyze results for accessibility issues
  colorAnalysis.forEach(item => {
    if (item.contrastRatio < 4.5) {
      issues.push({
        type: 'color_issue',
        subtype: 'low_contrast',
        message: `Low contrast ratio of ${item.contrastRatio.toFixed(2)} for ${item.element}`,
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
    const fixedElements = Array.from(document.querySelectorAll('*:not(html):not(body)')).filter(el => {
      const style = window.getComputedStyle(el);
      const width = parseInt(style.width);
      const maxWidth = style.maxWidth;
      if (width > 600 && style.width.includes('px') && !maxWidth) {
        console.log('Fixed-width element found:', el.outerHTML);
        return true;
      }
      return false;
    }).map(el => el.outerHTML);
    
    return {
      hasViewportMeta,
      viewportContent,
      isMobileFriendly,
      fixedElementsCount: fixedElements.length,
      fixedElements
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
    console.log('Fixed-width elements found:', viewportInfo.fixedElements);
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