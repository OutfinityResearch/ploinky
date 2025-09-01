// AI Helper module for intelligent code fixing
const OpenAI = require('openai');

class AIHelper {
  constructor() {
    // First check environment variables directly (priority)
    const apiKey = process.env.OPENAI_API_KEY || process.env.OPENAI_KEY || process.env.API_KEY;
    
    if (!apiKey) {
      console.warn('⚠️  OpenAI API key not found in environment!');
      console.warn('Please set one of these environment variables:');
      console.warn('  export OPENAI_API_KEY=your-key-here');
      console.warn('  export OPENAI_KEY=your-key-here');
      console.warn('  export API_KEY=your-key-here\n');
      this.enabled = false;
      return;
    }
    
    // Initialize OpenAI client
    this.openai = new OpenAI({
      apiKey: apiKey
    });
    
    // Use GPT-5 (latest model released August 2025)
    // Available models: gpt-5, gpt-5-mini, gpt-5-nano
    this.model = process.env.OPENAI_MODEL || 'gpt-5';
    
    // Allow model selection through environment
    if (process.env.USE_GPT5_MINI === 'true') {
      this.model = 'gpt-5-mini'; // Faster, cheaper option
    } else if (process.env.USE_GPT5_NANO === 'true') {
      this.model = 'gpt-5-nano'; // Fastest, most economical
    } else if (process.env.MODEL) {
      this.model = process.env.MODEL; // Custom model selection
    }
    
    this.maxTokens = parseInt(process.env.MAX_TOKENS) || 16000; // Generous limit for full game code
    this.temperature = parseFloat(process.env.TEMPERATURE) || 1.0; // Default value required by model
    this.enabled = true;
    
    console.log(`✅ AI Helper initialized!`);
    console.log(`   Model: ${this.model} (GPT-5 - Latest OpenAI model)`);
    console.log(`   API Key: ${apiKey.substring(0, 7)}...${apiKey.substring(apiKey.length - 4)}`);
    
    // GPT-5 capabilities
    console.log(`   Features: Advanced reasoning, 80% less hallucination, superior coding`);
  }
  
  async fixCode(code, issues) {
    if (!this.enabled) {
      console.log('AI Helper not available (no API key)');
      return null;
    }
    
    try {
      // Prepare the prompt
      const prompt = this.createFixPrompt(code, issues);
      
      console.log('🤖 Asking AI to fix the code...');
      
      // Call OpenAI API
      const response = await this.openai.chat.completions.create({
        model: this.model,
        messages: [
          {
            role: 'system',
            content: `You are an expert web developer specializing in fixing HTML5 games. 
Your task is to fix the provided code based on the issues detected.
Return ONLY the complete fixed HTML code without any explanations or markdown.
The code should be production-ready and properly formatted.`
          },
          {
            role: 'user',
            content: prompt
          }
        ],
        // Note: temperature parameter removed - model only supports default value
        max_completion_tokens: this.maxTokens
      });
      
      const fixedCode = response.choices[0].message.content;
      
      // Validate that we got HTML code back
      if (!fixedCode.includes('<!') && !fixedCode.includes('<html')) {
        console.error('AI response does not appear to be HTML code');
        return null;
      }
      
      console.log('✅ AI generated fixed code');
      return fixedCode;
      
    } catch (error) {
      console.error('Error calling OpenAI API:', error.message);
      if (error.message.includes('401')) {
        console.error('Invalid API key. Please check your OPENAI_API_KEY in .env file');
      } else if (error.message.includes('429')) {
        console.error('Rate limit exceeded. Please wait and try again');
      } else if (error.message.includes('insufficient_quota')) {
        console.error('OpenAI API quota exceeded. Please check your account');
      }
      return null;
    }
  }
  
  createFixPrompt(code, issues) {
    // Group issues by type for better organization
    const issuesByType = {};
    issues.forEach(issue => {
      const type = issue.type;
      if (!issuesByType[type]) {
        issuesByType[type] = [];
      }
      issuesByType[type].push(issue);
    });
    
    let issueDescription = 'Issues found in the game:\n\n';
    
    Object.entries(issuesByType).forEach(([type, typeIssues]) => {
      issueDescription += `${type.toUpperCase()}:\n`;
      typeIssues.forEach(issue => {
        issueDescription += `- ${issue.message}`;
        if (issue.subtype) {
          issueDescription += ` (${issue.subtype})`;
        }
        if (issue.details) {
          issueDescription += `\n  Details: ${JSON.stringify(issue.details, null, 2)}`;
        }
        issueDescription += '\n';
      });
      issueDescription += '\n';
    });
    
    return `Fix the following HTML5 game code based on the issues detected and transform it into a modern, mobile-first game.

${issueDescription}

CRITICAL REQUIREMENTS - THE GAME MUST:

1. **MOBILE-FIRST DESIGN** (Primary platform is mobile/tablet):
   - Add comprehensive viewport meta tag with viewport-fit=cover for edge-to-edge display
   - Implement safe area insets for notched devices (env(safe-area-inset-*))
   - Use responsive units (vw, vh, rem, %) instead of fixed pixels
   - Ensure all UI elements are large enough for touch (minimum 44x44px touch targets)
   - Prevent pinch-zoom and unwanted scrolling/bouncing
   - Test layout works in both portrait and landscape orientations

2. **DUAL INPUT SUPPORT** (Touch AND Mouse):
   - Add BOTH touch events (touchstart, touchmove, touchend) AND mouse events (click, mousedown, mousemove, mouseup)
   - Use pointer events where appropriate for unified handling
   - Add touch-action: manipulation to interactive elements
   - Prevent ghost clicks and double-tap zoom on mobile
   - Ensure swipe gestures work alongside click/tap actions

3. **BEAUTIFUL, COLORFUL UI** (Modern and Elegant):
   - Use vibrant gradient backgrounds (avoid plain solid colors)
   - Implement smooth animations and transitions
   - Add subtle shadows and depth to UI elements
   - Use modern CSS features (gradients, transforms, filters)
   - Choose a beautiful, high-contrast color palette
   - Add visual feedback for all interactions (hover, active, focus states)
   - Use system fonts with proper fallbacks for consistency

4. **RESPONSIVE CANVAS/GAME AREA**:
   - Canvas must auto-resize to fit viewport
   - Use CSS max-width: 100% and height: auto
   - Implement proper scaling for different screen sizes
   - Maintain aspect ratio on all devices
   - Handle window resize events dynamically

5. **PERFORMANCE & ACCESSIBILITY**:
   - Fix all JavaScript errors and typos
   - Use requestAnimationFrame for smooth animations
   - Add proper ARIA labels and roles
   - Ensure keyboard navigation where applicable
   - Use CSS containment for better performance
   - Optimize images and assets

6. **MODERN BEST PRACTICES**:
   - Use CSS custom properties (CSS variables) for theming
   - Implement proper error boundaries
   - Add loading states and smooth transitions
   - Use semantic HTML5 elements
   - Include proper meta tags for mobile web apps
   - Add manifest.json properties if applicable

7. **USER EXPERIENCE ENHANCEMENTS**:
   - Add haptic feedback for mobile (if supported)
   - Include sound on/off toggle (with visual feedback)
   - Show score/progress with modern UI components
   - Add smooth page transitions and micro-interactions
   - Implement pull-to-refresh prevention
   - Handle offline states gracefully

Original code:
\`\`\`html
${code}
\`\`\`

Return the complete fixed HTML code with ALL requirements implemented. Make the game visually stunning, fully responsive, and optimized for mobile devices while maintaining desktop compatibility:`;
  }
  
  async suggestImprovements(code) {
    if (!this.enabled) {
      return null;
    }
    
    try {
      console.log('🤖 Asking AI for improvement suggestions...');
      
      const response = await this.openai.chat.completions.create({
        model: this.model,
        messages: [
          {
            role: 'system',
            content: 'You are an expert game developer. Analyze the code and suggest improvements.'
          },
          {
            role: 'user',
            content: `Analyze this HTML5 game and suggest improvements for:
- Performance optimization
- Mobile compatibility
- Accessibility
- Code quality
- User experience

Code:
\`\`\`html
${code.substring(0, 3000)}... [truncated]
\`\`\`

Provide a structured list of suggestions:`
          }
        ],
        // temperature removed - not supported by model
        max_completion_tokens: 8000 // Enough for analyzing complex games
      });
      
      return response.choices[0].message.content;
      
    } catch (error) {
      console.error('Error getting AI suggestions:', error.message);
      return null;
    }
  }
  
  async explainIssue(issue) {
    if (!this.enabled) {
      return null;
    }
    
    try {
      const response = await this.openai.chat.completions.create({
        model: this.model,
        messages: [
          {
            role: 'system',
            content: 'You are a helpful programming assistant. Explain technical issues in simple terms.'
          },
          {
            role: 'user',
            content: `Explain this issue in simple terms and how to fix it:
Type: ${issue.type}
Subtype: ${issue.subtype || 'N/A'}
Message: ${issue.message}
Details: ${JSON.stringify(issue.details || {}, null, 2)}

Provide a brief explanation and solution:`
          }
        ],
        // temperature removed - not supported by model
        max_completion_tokens: 4000 // Enough for detailed recommendations
      });
      
      return response.choices[0].message.content;
      
    } catch (error) {
      console.error('Error explaining issue:', error.message);
      return null;
    }
  }
}

// Singleton instance
let aiHelperInstance = null;

function getAIHelper() {
  if (!aiHelperInstance) {
    aiHelperInstance = new AIHelper();
  }
  return aiHelperInstance;
}

module.exports = {
  AIHelper,
  getAIHelper
};