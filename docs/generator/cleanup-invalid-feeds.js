#!/usr/bin/env node

const fs = require('fs').promises;
const path = require('path');

async function cleanupInvalidFeeds() {
    const sourcesDir = path.join(__dirname, '..', 'sources');
    const invalidUrlsPath = path.join(sourcesDir, 'invalidUrls.json');
    
    // Load invalid URLs
    let invalidUrls = [];
    try {
        const data = await fs.readFile(invalidUrlsPath, 'utf8');
        invalidUrls = JSON.parse(data);
        console.log(`Loaded ${invalidUrls.length} invalid URLs to remove`);
    } catch (error) {
        console.log('No invalidUrls.json found or error reading it');
        return;
    }
    
    // Create a Set of invalid URLs for faster lookup
    const invalidUrlSet = new Set(invalidUrls.map(item => item.url));
    
    // Process each source folder
    const folders = await fs.readdir(sourcesDir, { withFileTypes: true });
    let totalRemoved = 0;
    
    for (const folder of folders) {
        if (!folder.isDirectory()) continue;
        
        const configPath = path.join(sourcesDir, folder.name, 'config.json');
        
        try {
            // Read config
            const configData = await fs.readFile(configPath, 'utf8');
            const config = JSON.parse(configData);
            
            if (!config.feeds || !Array.isArray(config.feeds)) continue;
            
            // Filter out invalid feeds
            const originalCount = config.feeds.length;
            config.feeds = config.feeds.filter(feed => {
                if (invalidUrlSet.has(feed.url)) {
                    console.log(`  ✗ Removing ${feed.name} from ${folder.name} (${feed.url})`);
                    totalRemoved++;
                    return false;
                }
                return true;
            });
            
            // Save if changes were made
            if (config.feeds.length < originalCount) {
                await fs.writeFile(configPath, JSON.stringify(config, null, 2));
                console.log(`  ✓ Updated ${folder.name}/config.json (removed ${originalCount - config.feeds.length} feeds)`);
            }
            
        } catch (error) {
            // Skip folders without config.json or with parse errors
            continue;
        }
    }
    
    console.log(`\n✓ Cleanup complete: Removed ${totalRemoved} invalid feeds total`);
}

// Run the cleanup
cleanupInvalidFeeds().catch(console.error);