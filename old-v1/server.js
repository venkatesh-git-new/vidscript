const app = require('./app');
const config = require('./config');
const logger = require('./utils/logger');
const fs = require('fs');
const path = require('path');

const startServer = () => {
    // Ensure temp directory exists
    const tempDir = path.resolve(config.tempDir);
    if (!fs.existsSync(tempDir)) {
        fs.mkdirSync(tempDir, { recursive: true });
    }

    app.listen(config.port, () => {
        logger.info(`Server running in ${config.nodeEnv} mode on port ${config.port}`);
    });
};

startServer();
