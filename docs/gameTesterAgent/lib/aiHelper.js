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
    
    // Use GPT-4o as the default model (latest available)
    this.model = process.env.OPENAI_MODEL || 'gpt-5';
    
    // Allow model selection through environment
    if (process.env.USE_GPT4_TURBO === 'true') {
      this.model = 'gpt-4-turbo-preview';
    } else if (process.env.MODEL) {
      this.model = process.env.MODEL; // Custom model selection
    }
    
    this.enabled = true;
    
    console.log(`✅ AI Helper initialized!`);
    console.log(`   Model: ${this.model}`);
    console.log(`   API Key: ${apiKey.substring(0, 7)}...${apiKey.substring(apiKey.length - 4)}`);
  }
  
  async fixCode(code, issues, customPrompt = null) {
    if (!this.enabled) {
      console.log('AI Helper not available (no API key)');
      return null;
    }
    
    try {
      // Prepare the prompt
      console.log('📝 Preparing prompt for AI...');
      const prompt = this.createFixPrompt(code, issues, customPrompt);
      if (!prompt) {
        console.error('❌ Failed to create prompt.');
        return null;
      }
      console.log(`📊 Prompt size: ${prompt.length} characters`);
      console.log(`📊 Original code size: ${code.length} characters`);
      console.log(`📊 Number of issues to fix: ${issues.length}`);
      
      console.log('🤖 Calling OpenAI API...');
      console.log(`   Model: ${this.model}`);
      
      const startTime = Date.now();
      
      // Call OpenAI API
      console.log('⏳ Waiting for OpenAI response...');
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
      });
      
      const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
      console.log(`⏱️  OpenAI responded in ${elapsed} seconds`);
      
      const fixedCode = response.choices[0].message.content;
      console.log(`📊 Response size: ${fixedCode.length} characters`);
      
      // Validate that we got HTML code back
      if (!fixedCode.includes('<!') && !fixedCode.includes('<html')) {
        console.error('❌ AI response does not appear to be HTML code');
        console.log('First 200 chars of response:', fixedCode.substring(0, 200));
        return null;
      }
      
      console.log('✅ AI generated valid HTML code');
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
  
  createFixPrompt(code, issues, customPrompt = null) {
    console.log('Creating prompt...');
    const issuesByType = {};
    issues.forEach(issue => {
      const type = issue.type;
      if (!issuesByType[type]) {
        issuesByType[type] = [];
      }
      issuesByType[type].push(issue);
    });
    
    let issueDescription = 'Issues found in the game:\n\n';
    console.log('Initial issueDescription:', issueDescription);
    
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
    console.log('Final issueDescription:', issueDescription);
    
    let finalPrompt = `Fix the following HTML5 game code based on the issues detected and transform it into a modern, mobile-first game.\n\n${issueDescription}\n\n`;

    if (customPrompt) {
      finalPrompt += `IMPORTANT: The user has provided the following instructions, which should be prioritized:\n${customPrompt}\n\n`;
    }

    finalPrompt += `MOST IMPORTANT: THE GAME MUST BE FULLY PLAYABLE AND FUNCTIONAL!
- Fix all JavaScript errors
- Make the game responsive and mobile-friendly
- Add touch controls for mobile devices

Original code:
${code}

Return ONLY the complete fixed HTML code with all issues resolved.`;

    
    console.log('Generated prompt:', finalPrompt);
    return finalPrompt;
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
