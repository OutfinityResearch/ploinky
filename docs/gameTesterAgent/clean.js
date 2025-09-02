#!/usr/bin/env node

const fs = require('fs').promises;
const path = require('path');

const SOURCES_DIR = path.resolve(__dirname, '../sources');
const SCAN_RESULTS_DIR = path.resolve(__dirname, 'scan-results');

async function cleanFiles() {
  console.log('========================================');
  console.log('Cleaning up report and backup files...');
  console.log(`Scanning source directory: ${SOURCES_DIR}`);
  console.log('========================================\n');

  let deletedCount = 0;

  async function scanAndDelete(directory) {
    try {
      const entries = await fs.readdir(directory, { withFileTypes: true });

      for (const entry of entries) {
        const fullPath = path.join(directory, entry.name);

        if (entry.isDirectory()) {
          await scanAndDelete(fullPath);
        } else if (entry.isFile()) {
          if (entry.name.endsWith('-report.json') || entry.name.endsWith('.html.backup') || entry.name.endsWith('-fix-report.json') || entry.name.endsWith('-improvement-report.json')) {
            try {
              await fs.unlink(fullPath);
              console.log(`Deleted: ${fullPath}`);
              deletedCount++;
            } catch (err) {
              console.error(`Error deleting file ${fullPath}:`, err);
            }
          }
        }
      }
    } catch (err) {
      console.error(`Error reading directory ${directory}:`, err);
    }
  }

  await scanAndDelete(SOURCES_DIR);

  console.log('\n========================================');
  console.log('Cleaning up scan-results directory...');
  try {
    await fs.rm(SCAN_RESULTS_DIR, { recursive: true, force: true });
    console.log(`Deleted directory: ${SCAN_RESULTS_DIR}`);
  } catch (err) {
    console.error(`Error deleting scan-results directory:`, err);
  }


  console.log('\n========================================');
  console.log('Cleanup Complete');
  console.log(`Total files deleted from sources: ${deletedCount}`);
  console.log('========================================');
}

cleanFiles().catch(error => {
  console.error('\n❌ An unexpected error occurred during cleanup:', error);
  process.exit(1);
});