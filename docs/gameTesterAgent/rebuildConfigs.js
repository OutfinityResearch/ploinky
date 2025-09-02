#!/usr/bin/env node

const fs = require('fs').promises;
const path = require('path');

const SOURCES_DIR = path.resolve(__dirname, '../sources');

// Per user request, this array will overwrite the `reactions` field for all games.
const REACTIONS_ARRAY = [
  "This game is licensed as public domain by Axiologic Research, and a gift to Albert-David Alboaie by the founder of Axiologic Research.",
  "Feel free to copy and improve this game. Contact us on https://ploinky.com/addgame to review and include your games in our public suite. Make nice games for your children!"
];

function generateTitleFromFileName(filename) {
    return filename
        .replace(/\.html$/, '')
        .split('-')
        .map(word => word.charAt(0).toUpperCase() + word.slice(1))
        .join(' ');
}

function generateIdFromFilename(category, filename) {
    const name = filename.replace(/\.html$/, '');
    return `microgame:${category}:${name}`;
}

function cleanEssence(essence) {
    if (!essence || typeof essence !== 'string') return essence;
    
    // Split into sentences/lines
    const lines = essence.split(/[.\n•]/);
    
    // Filter out lines containing Axiologic Research or ploinky.com
    const cleanedLines = lines.filter(line => {
        const lowerLine = line.toLowerCase();
        return !lowerLine.includes('axiologic') && 
               !lowerLine.includes('ploinky.com') &&
               !lowerLine.includes('ploinky') &&
               line.trim().length > 0;
    });
    
    // Join back and clean up
    return cleanedLines.join('. ').replace(/\s+/g, ' ').trim()
        .replace(/\.+/g, '.') // Remove multiple dots
        .replace(/\.\s*$/, '.'); // Ensure single dot at end if needed
}

async function rebuildConfigs() {
  console.log('========================================');
  console.log('Rebuilding games.json configurations (v5 - Safe Sync)...');
  console.log(`Scanning source directory: ${SOURCES_DIR}`);
  console.log('========================================\n');

  try {
    const categoryFolders = await fs.readdir(SOURCES_DIR, { withFileTypes: true });

    for (const category of categoryFolders) {
      if (!category.isDirectory()) continue;

      const categoryPath = path.join(SOURCES_DIR, category.name);
      console.log(`Processing category: ${category.name}`);

      // 1. Get all HTML filenames from the filesystem
      let allFilesInDir;
      try {
          allFilesInDir = await fs.readdir(categoryPath);
      } catch (e) {
          console.error(`  Could not read directory ${categoryPath}, skipping.`);
          continue;
      }
      const htmlFilenames = allFilesInDir.filter(file => file.endsWith('.html') && !file.endsWith('.backup'));
      const htmlFilenameSet = new Set(htmlFilenames);

      // 2. Read existing games.json
      const configPath = path.join(categoryPath, 'games.json');
      let gamesList = [];
      try {
        const rawData = await fs.readFile(configPath, 'utf8');
        gamesList = JSON.parse(rawData);
        if (!Array.isArray(gamesList)) gamesList = [];
      } catch (error) {
        console.log(`  No valid games.json found for ${category.name}.`);
      }

      let needsWrite = false;
      const finalGamesList = [];
      const processedFilenames = new Set();

      // 3. Process existing entries: keep if file exists, update reactions and clean essence
      for (const game of gamesList) {
        if (!game.source) {
            console.log('  - Ignoring entry with missing source field.');
            needsWrite = true;
            continue;
        }
        const gameFilename = path.basename(game.source);
        if (htmlFilenameSet.has(gameFilename)) {
            // Keep existing data, only overwrite reactions and clean essence
            if (JSON.stringify(game.reactions) !== JSON.stringify(REACTIONS_ARRAY)) {
                game.reactions = REACTIONS_ARRAY;
                needsWrite = true;
            }
            
            // Clean the essence field
            if (game.essence) {
                const cleanedEssence = cleanEssence(game.essence);
                if (cleanedEssence !== game.essence) {
                    game.essence = cleanedEssence;
                    needsWrite = true;
                    console.log(`  - Cleaned essence for: ${gameFilename}`);
                }
            }
            
            finalGamesList.push(game);
            processedFilenames.add(gameFilename);
        } else {
            console.log(`  - Removing entry for deleted file: ${gameFilename}`);
            needsWrite = true;
        }
      }

      // 4. Add new games found on disk
      for (const filename of htmlFilenames) {
          if (!processedFilenames.has(filename)) {
              console.log(`  + Adding new entry for file: ${filename}`);
              const newGame = {
                  id: generateIdFromFilename(category.name, filename),
                  type: "microgame",
                  title: generateTitleFromFileName(filename),
                  source: `/sources/${category.name}/${filename}`,
                  generatedAt: new Date().toISOString(),
                  feedName: `Ploynky #${category.name}`,
                  author: "Ploinky Agent",
                  category: "Game",
                  essence: "A new game, automatically added.",
                  reactions: REACTIONS_ARRAY
              };
              finalGamesList.push(newGame);
              needsWrite = true;
          }
      }

      // 5. Write back to file if any changes were made
      if (needsWrite) {
        finalGamesList.sort((a, b) => a.title.localeCompare(b.title));
        const configString = JSON.stringify(finalGamesList, null, 2);
        await fs.writeFile(configPath, configString);
        console.log(`  Successfully updated ${configPath}`);
      } else {
        console.log(`  No changes needed for ${category.name}.`);
      }
    }

    console.log('\n✅ Configuration rebuild complete!');

  } catch (error) {
    console.error('\n❌ An error occurred:', error);
    process.exit(1);
  }
}

rebuildConfigs();
