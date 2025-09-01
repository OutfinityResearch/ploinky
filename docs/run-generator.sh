#!/bin/bash

# Axiologic News RSS Feed Generator
# =====================================
#
# This script processes RSS feeds from configured sources and generates news posts
# for the Axiologic.news platform. It reads configurations from the sources/ directory
# and generates AI-enhanced content for each enabled feed.
#
# WORKFLOW:
# 1. Read configurations from sources/*/config.json folders
# 2. Fetch RSS feeds from configured URLs  
# 3. Filter items based on time settings (historyDays)
# 4. Generate new posts using AI prompts from config
# 5. Clean and validate generated reactions
# 6. Save posts to sources/*/posts.json files
#
# KEY FEATURES:
# - Time-based filtering: Only processes items within historyDays (default: 5 days)
# - Duplicate detection: Skips items already in posts.json (by URL hash)
# - AI content generation: Creates essence and reactions using configured prompts
# - Quality validation: Removes posts with:
#   - Poorly formatted reactions (less than 10 words each)
#   - Duplicate/repetitive reactions
#   - Missing required fields
# - Automatic cleanup: Removes posts older than historyDays
#
# USAGE:
#   ./run-generator.sh           # Process all source folders
#   ./run-generator.sh all       # Process all source folders (explicit)
#   ./run-generator.sh tech      # Process only the tech folder
#
# CONFIGURATION:
# Each source folder should contain:
# - config.json with:
#   - feeds: Array of RSS feed configurations
#   - selectionPrompt: AI prompt for filtering stories
#   - perspectivesPrompt: AI prompt for generating reactions
#   - essencePrompt: AI prompt for summarizing content
#   - topPostsPerFeed: Max posts to process per feed (default: 5)
#   - historyDays: Days to keep posts (default: 5)
#
# ENVIRONMENT VARIABLES (at least one API key is REQUIRED):
# - AI_PROVIDER: openai|gemini|anthropic|mistral|groq|ollama (auto-detected)
# - OPENAI_API_KEY: Required for OpenAI provider
# - GEMINI_API_KEY: Required for Gemini provider  
# - ANTHROPIC_API_KEY: Required for Anthropic/Claude provider
# - MISTRAL_API_KEY: Required for Mistral provider
# - GROQ_API_KEY: Required for Groq provider
#
# TROUBLESHOOTING:
# If the generator is not working:
# 1. Check that node is installed: node --version
# 2. Verify generator files exist in generator/ directory
# 3. Check sources/*/config.json files are valid JSON
# 4. Look for errors in console output
# 5. Verify RSS URLs are accessible and return valid XML
# 6. Check AI API keys are set if using AI features
# 7. Review sources/invalidUrls.json for failed feeds
#
# The script tracks invalid RSS URLs in sources/invalidUrls.json
# for debugging feed issues.
#
# CLEANUP INVALID FEEDS:
# To remove all invalid feeds from configurations:
#   node generator/cleanup-invalid-feeds.js
# This will automatically remove all feeds listed in invalidUrls.json

# Change to the script's directory
cd "$(dirname "$0")"

# Run the generator with all arguments passed through
node generator/index.js "$@"
