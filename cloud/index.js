#!/usr/bin/env node

const { PloinkyCloudServerV2 } = require('./core/serverV2');

// Export for library usage
module.exports = { 
    PloinkyCloudServer: PloinkyCloudServerV2,
    PloinkyCloudServerV2 
};

// Run if executed directly
if (require.main === module) {
    const port = process.env.PORT || 8000;
    const workingDir = process.env.PLOINKY_CLOUD_DIR || process.cwd();
    
    const server = new PloinkyCloudServerV2({
        port,
        workingDir
    });
    
    server.start().catch(err => {
        console.error('Failed to start server:', err);
        process.exit(1);
    });
    
    // Graceful shutdown
    const shutdown = async () => {
        console.log('\nShutting down server...');
        await server.stop();
        process.exit(0);
    };
    
    process.on('SIGTERM', shutdown);
    process.on('SIGINT', shutdown);
}