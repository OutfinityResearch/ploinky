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

  async improveCode(code, improvementPrompt) {
    if (!this.enabled) {
      console.log('AI Helper not available (no API key)');
      return null;
    }

    try {
      console.log('📝 Preparing prompt for AI improvement...');
      const prompt = this.createImprovePrompt(code, improvementPrompt);
      if (!prompt) {
        console.error('❌ Failed to create improvement prompt.');
        return null;
      }
      
      console.log('🤖 Calling OpenAI API for improvement...');
      const startTime = Date.now();
      
      const response = await this.openai.chat.completions.create({
        model: this.model,
        messages: [
          {
            role: 'system',
            content: `You are an expert web developer specializing in improving and refactoring HTML5 games.
Your task is to rewrite the provided code based on the user's instructions for improvement.
The user's game is already functional. You should enhance it, not just fix it.
Prioritize the user's request, but also apply best practices: mobile-first design, better performance, and cleaner code.
Return ONLY the complete improved HTML code without any explanations or markdown.`
          },
          {
            role: 'user',
            content: prompt
          }
        ],
      });

      const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
      console.log(`⏱️  OpenAI responded in ${elapsed} seconds`);

      const improvedCode = response.choices[0].message.content;
      
      if (!improvedCode.includes('<!') && !improvedCode.includes('<html')) {
        console.error('❌ AI response does not appear to be HTML code');
        return null;
      }

      console.log('✅ AI generated improved HTML code');
      return improvedCode;

    } catch (error) {
      console.error('Error calling OpenAI API for improvement:', error.message);
      return null;
    }
  }

  createImprovePrompt(code, improvementPrompt) {
    let finalPrompt = `Please improve the following HTML5 game code.\n\n`;
    finalPrompt += `USER'S INSTRUCTIONS FOR IMPROVEMENT:\n${improvementPrompt}\n\n`;
    finalPrompt += `Apply the user's instructions while ensuring the game remains fully playable.
Also, consider these general improvements:
- Enhance visuals and add simple animations.
- Ensure the game is responsive and mobile-friendly.
- Add touch controls if they are missing or could be better.
- Refactor the code for clarity and performance.

Original code:
${code}

Return ONLY the complete, improved, and fully functional HTML code.`;
    return finalPrompt;
  }

  async createGame(gamePrompt) {
    if (!this.enabled) {
      console.log('AI Helper not available (no API key)');
      return null;
    }
    try {
      const prompt = this.createGamePrompt(gamePrompt);
      const response = await this.openai.chat.completions.create({
        model: this.model,
        messages: [
          {
            role: 'system',
            content: `You are an expert HTML5 game developer. Your task is to create a complete, single-file HTML game based on the user's description.
The game must be fully functional, responsive, and mobile-friendly with touch controls.
The entire game (HTML, CSS, and JavaScript) must be contained within a single .html file. Do not use external files.
The code should be clean, well-formatted, and modern.
Return ONLY the complete HTML code for the game, starting with <!DOCTYPE html>. Do not include any explanations, comments, or markdown formatting around the code.`
          },
          {
            role: 'user',
            content: prompt
          }
        ],
      });
      const gameCode = response.choices[0].message.content;
      // Basic validation
      if (!gameCode.includes('<!DOCTYPE html>') || !gameCode.includes('<script>')) {
        console.error('❌ AI response does not appear to be a valid HTML game file.');
        return null;
      }
      console.log('✅ AI generated game code successfully.');
      return gameCode;
    } catch (error) {
      console.error('Error calling OpenAI API for game creation:', error.message);
      return null;
    }
  }

  createGamePrompt(prompt) {
    return `Create a complete, single-file HTML5 game based on the following description:

"${prompt}"

Please ensure the game is:
- Fully playable and self-contained in one HTML file.
- Responsive and works well on both desktop and mobile screens.
- Includes touch controls for mobile and keyboard controls for desktop.
- Has clear instructions on how to play either on the game screen or as comments in the code.
- Visually appealing with a simple but clean art style.

Return only the raw HTML code.`;
  }

  async analyzeGames(batchContent) {
    if (!this.enabled) {
      console.log('AI Helper not available');
      return null;
    }
    try {
      const prompt = `You are a game analyst. I will provide you with the content of several HTML files, each containing a single game. For each game, you need to generate a short title, a one-sentence description, and a single Unicode emoji that best represents the game.

The input will be a series of files separated by "--- FILE: [filename] ---".

Your output must be a single, valid JSON array. Each object in the array should correspond to one of the input files and must contain the following keys: "filename", "title", "description", and "icon". Do not add any explanation or markdown formatting around the JSON output.

Here are the game files:

${batchContent}`;

      const response = await this.openai.chat.completions.create({
        model: this.model,
        messages: [
          {
            role: 'user',
            content: prompt
          }
        ]
      });

      const textResponse = response.choices[0].message.content;
      
      // Clean the response to get only the JSON
      const jsonMatch = textResponse.match(/\[[\s\S]*\]/);
      if (!jsonMatch) {
          console.error('❌ AI response did not contain a valid JSON array.');
          return null;
      }

      return JSON.parse(jsonMatch[0]);

    } catch (error) {
      console.error('Error calling OpenAI API for game analysis:', error.message);
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
