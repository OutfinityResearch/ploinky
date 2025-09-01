#!/usr/bin/env node

const fs = require('fs').promises;
const path = require('path');
const { loadEnhancedConfig, GLOBAL_CONFIG } = require('./config.js');
const { AIService } = require('./ai.js');
const { ContentFetcher } = require('./content.js');
const { PostManager, StoryProcessor, generatePostId } = require('./post.js');
const { fetchRSS, parseRSS } = require('./rss.js');

async function main() {
    const startTime = Date.now();
    const args = process.argv.slice(2);
    const sourcesDir = path.join(__dirname, '..', 'sources');
    
    // Initialize services
    const aiService = new AIService();
    await aiService.initialize();
    const contentFetcher = new ContentFetcher();
    
    // Determine folders to process
    const folders = [];
    if (args.length === 0 || args[0] === 'all') {
        const entries = await fs.readdir(sourcesDir, { withFileTypes: true });
        for (const entry of entries) {
            if (entry.isDirectory()) {
                const configPath = path.join(sourcesDir, entry.name, 'config.json');
                try {
                    await fs.access(configPath);
                    folders.push(path.join(sourcesDir, entry.name));
                } catch {} // Ignore if config.json doesn't exist
            }
        }
    } else {
        folders.push(path.join(sourcesDir, args[0]));
    }

    console.log(`Processing ${folders.length} source folder(s)...`);
    console.log('');

    let totalNew = 0;
    let totalProcessed = 0;

    // Prepare invalid RSS URL store
    const INVALID_URLS_PATH = path.join(sourcesDir, 'invalidUrls.json');
    let invalidStore = [];
    try {
        const raw = await fs.readFile(INVALID_URLS_PATH, 'utf8');
        invalidStore = JSON.parse(raw);
        if (!Array.isArray(invalidStore)) invalidStore = [];
    } catch { invalidStore = []; } // If file doesn't exist or is invalid, start with empty array

    const recordInvalid = async ({ url, name, category, message }) => {
        try {
            const now = new Date().toISOString();
            const idx = invalidStore.findIndex(e => e && e.url === url);
            if (idx >= 0) {
                const prev = invalidStore[idx];
                invalidStore[idx] = {
                    ...prev,
                    name: name || prev.name,
                    category: category || prev.category,
                    lastError: message || prev.lastError,
                    lastSeenAt: now,
                    count: (prev.count || 0) + 1
                };
            } else {
                invalidStore.push({ url, name: name || '', category: category || '', lastError: message || 'Unknown error', firstSeenAt: now, lastSeenAt: now, count: 1 });
            }
            await fs.writeFile(INVALID_URLS_PATH, JSON.stringify(invalidStore, null, 2));
        } catch (_) { /* ignore write errors */ }
    };

    for (const folder of folders) {
        const configPath = path.join(folder, 'config.json');
        const postsPath = path.join(folder, 'posts.json');
        
        console.log(`\n=== ${path.basename(folder).toUpperCase()} ===`);
        
        try {
            // Load configuration
            const config = await loadEnhancedConfig(configPath);
            config.category = path.basename(folder);
            
            // Initialize post manager
            const historyDays = config.historyDays || GLOBAL_CONFIG.contentSettings?.historyDays || 30;
            const postManager = new PostManager(postsPath, historyDays);
            await postManager.load();
            
            console.log(`  Found ${postManager.posts.length} existing posts in database`);
            const existingIds = postManager.getExistingIds();
            
            // Create processor
            const processor = new StoryProcessor(config, aiService, contentFetcher);
            
            // Process each feed
            const newPosts = [];
            for (const feed of config.feeds) {
                if (!feed.enabled) {
                    console.log(`Skipping disabled feed: ${feed.name}`);
                    continue;
                }
                
                console.log(`\nProcessing ${feed.name}...`);
                
                try {
                    // Fetch RSS with timeout
                    const fetchTimeout = GLOBAL_CONFIG.contentSettings?.contentFetchTimeout || 15000;
                    // Fetching RSS...
                    
                    const rssData = await fetchRSS(feed.url, fetchTimeout);
                    
                    if (!rssData || rssData.trim().length === 0) {
                        console.log(`  ✗ Empty response from ${feed.name}`);
                        continue;
                    }
                    
                    const items = parseRSS(rssData);
                    
                    if (items.length === 0) {
                        console.log(`  ✗ Could not parse RSS feed for ${feed.name}`);
                        continue;
                    }
                    
                    // Found items in RSS

                    // Filter out items older than historyDays to avoid generating then removing them
                    const cutoffMs = Date.now() - (historyDays * 24 * 60 * 60 * 1000);
                    const freshItems = items.filter(it => {
                        try {
                            const t = new Date(it.pubDate || it.published || it.updated || 0).getTime();
                            return !isNaN(t) && t >= cutoffMs;
                        } catch (_) { return false; } // Ignore invalid dates
                    });
                    if (freshItems.length === 0) {
                        console.log(`  ✗ No recent items (within ${historyDays} days)`);
                        continue;
                    }
                    
                    // Filter out items that already exist in posts.json
                    const unprocessedItems = [];
                    let skippedCount = 0;
                    
                    for (const item of freshItems) {
                        const id = generatePostId(item.title, item.link);
                        if (!existingIds.has(id)) {
                            unprocessedItems.push(item);
                        } else {
                            skippedCount++;
                        }
                    }

                    if (unprocessedItems.length > 0) {
                        console.log(`  → Processing ${unprocessedItems.length} new items (${skippedCount} already known)`);
                    }
                    
                    if (unprocessedItems.length === 0) {
                        console.log(`  ✓ All items already processed`);
                        continue;
                    }
                    
                    // Process stories with AI
                    const feedPosts = await processor.processStories(
                        unprocessedItems, 
                        feed, 
                        existingIds
                    );
                    
                    // Collect new posts
                    for (const post of feedPosts) {
                        newPosts.push(post);
                    }
                    
                    if (feedPosts.length > 0) {
                        console.log(`  ✓ Generated ${feedPosts.length} posts`);
                    }
                    totalProcessed += items.length;
                    
                } catch (error) {
                    console.error(`  Error: ${error.message}`);
                    await recordInvalid({ url: feed.url, name: feed.name, category: config.category, message: error.message });
                }
            }
            
            // Save results
            if (newPosts.length > 0) {
                await postManager.save(newPosts);
                console.log(`\n✓ Saved ${newPosts.length} new posts`);
                console.log(`  Database now contains: ${postManager.posts.length} posts`);
                totalNew += newPosts.length;
            } else {
                // Even if no new posts, save to cleanup old ones
                await postManager.save([]);
                console.log(`\n✓ No new posts generated`);
                console.log(`  Database contains: ${postManager.posts.length} posts`);
            }
            
        } catch (error) {
            console.error(`Error processing ${path.basename(folder)}: ${error.message}`);
        }
    }

    console.log(`\n${'='.repeat(50)}`);
    console.log(`SUMMARY: Generated ${totalNew} new posts from ${totalProcessed} items`);
    console.log(`Folders processed: ${folders.length}`);
    
    const totalTime = Date.now() - startTime;
    const formatTime = (ms) => {
        if (ms < 1000) return `${ms}ms`;
        if (ms < 60000) return `${(ms / 1000).toFixed(1)}s`;
        return `${Math.floor(ms / 60000)}m ${((ms % 60000) / 1000).toFixed(1)}s`;
    };
    console.log(`Total execution time: ${formatTime(totalTime)}`);
}

// Run if executed directly
if (require.main === module) {
    main().catch(error => {
        console.error('Fatal error:', error);
        process.exit(1);
    });
}
