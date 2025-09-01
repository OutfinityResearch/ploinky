# 🎮 Game Agent - AI-Powered Game Testing & Fixing

Automated testing and fixing tool for HTML5 games using GPT-5 (latest OpenAI model).

## ✨ Features

- **🔍 Comprehensive Testing**: Detects JavaScript errors, scroll issues, viewport problems, color contrast issues, and performance problems
- **🤖 AI-Powered Fixing**: Uses GPT-5 to automatically fix detected issues
- **📱 Multi-Viewport Testing**: Tests games on mobile, tablet, and desktop viewports
- **📊 Detailed Reporting**: Generates HTML and JSON reports with screenshots
- **🔧 Fallback Fixing**: Rule-based fixes when AI is not available

## 🚀 Quick Start

### 1. Install Dependencies

```bash
cd gameAgent
npm install
```

### 2. Set Your OpenAI API Key

The agent reads the API key from environment variables. Set one of these:

```bash
# Option 1: Standard OpenAI environment variable
export OPENAI_API_KEY="your-api-key-here"

# Option 2: Alternative names
export OPENAI_KEY="your-api-key-here"
# or
export API_KEY="your-api-key-here"
```

Get your API key from: https://platform.openai.com/api-keys

### 3. Optional: Choose GPT-5 Model Variant

```bash
# Default: Uses GPT-5 (best quality)
export OPENAI_MODEL="gpt-5"

# For faster, cheaper option:
export USE_GPT5_MINI="true"

# For fastest, most economical:
export USE_GPT5_NANO="true"
```

## 📖 Usage

### Test a Single Game

```bash
# Test without fixing
node index.js test ../sources/allAges/snake.html

# Test and auto-fix with GPT-5
node index.js fix ../sources/allAges/snake.html

# Test with specific viewport
node index.js test ../sources/boys/rocket-dodge.html --viewport mobile

# Test with visible browser (not headless)
node index.js test ../sources/girls/flower-tap.html --headed

# Take screenshots during testing
node index.js test ../sources/schoolChildren/math-quiz.html --screenshot
```

### Test All Games

```bash
# Test all games in sources folder
node index.js test-all
```

This will:
- Scan all HTML games in the sources folder
- Test each game with multiple viewports
- Attempt to fix issues automatically (if AI is configured)
- Generate a comprehensive HTML report

### View Help

```bash
node index.js help
```

## 🔍 What It Tests

### JavaScript Errors
- Syntax errors
- Runtime errors
- Undefined variables
- Type errors

### Scroll Issues
- Unwanted horizontal/vertical scrollbars
- Canvas overflow
- Content exceeding viewport

### Viewport Issues
- Missing viewport meta tag
- Not mobile-friendly
- Fixed-width elements

### Color Issues
- Low contrast text
- Accessibility problems

### Performance Issues
- High memory usage
- Slow page load
- Memory leaks

## 🤖 GPT-5 Capabilities

The agent uses GPT-5's advanced features:
- **94.6% accuracy** in mathematical reasoning
- **74.9% success rate** on real-world coding tasks
- **80% less hallucination** than previous models
- Superior understanding of game logic and structure

## 📊 Output

### Test Results
- Console output with detailed issue breakdown
- Screenshot captures (optional)
- JSON reports for each game
- HTML summary report

### Fix Reports
- Backup of original files (.backup)
- Detailed fix report (JSON)
- Before/after comparison

## 🛠️ Advanced Configuration

### Environment Variables

```bash
# Required
OPENAI_API_KEY=sk-...          # Your OpenAI API key

# Optional
OPENAI_MODEL=gpt-5              # Model selection (gpt-5, gpt-5-mini, gpt-5-nano)
MAX_TOKENS=4000                 # Maximum tokens for AI response
TEMPERATURE=0.3                 # AI creativity (0-1, lower = more deterministic)
USE_GPT5_MINI=true             # Use faster, cheaper GPT-5-mini
USE_GPT5_NANO=true             # Use fastest, most economical GPT-5-nano
```

### Using .env File

Create a `.env` file in the gameAgent folder:

```env
OPENAI_API_KEY=your-key-here
OPENAI_MODEL=gpt-5
MAX_TOKENS=4000
TEMPERATURE=0.3
```

## 📁 Project Structure

```
gameAgent/
├── index.js              # Main CLI interface
├── gameLauncher.js       # Browser launcher with Puppeteer
├── gameTester.js         # Comprehensive testing module
├── codeFixer.js          # AI and rule-based fixing
├── aiHelper.js           # GPT-5 integration
├── testAllGames.js       # Batch testing script
├── setup.js              # Setup wizard
└── test-results/         # Generated reports and screenshots
```

## 🔧 Troubleshooting

### No API Key Error
```
⚠️  OpenAI API key not found in environment!
```
**Solution**: Set your API key as environment variable

### Rate Limit Error
```
Error: Rate limit exceeded
```
**Solution**: Wait a few minutes or upgrade your OpenAI plan

### Invalid API Key
```
Error: Invalid API key
```
**Solution**: Check your API key is correct and active

### GPT-5 Not Available
If GPT-5 is not available in your region/account, the agent will fall back to GPT-4 or use rule-based fixes.

## 🤝 Contributing

Feel free to submit issues and enhancement requests!

## 📄 License

ISC License

## 🙏 Credits

- Powered by OpenAI GPT-5
- Built with Puppeteer for browser automation
- Inspired by the need for automated game quality assurance