#!/usr/bin/env node

const { writeFileSync } = require('node:fs');

writeFileSync('./start-result', 'started without shell\n');

// Keep the entrypoint alive so the container stays running until the agent command is launched.
setInterval(() => {}, 1000);
