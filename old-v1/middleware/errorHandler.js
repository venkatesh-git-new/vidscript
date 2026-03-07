const logger = require('../utils/logger');

/**
 * Global error handler middleware.
 */
const errorHandler = (err, req, res, next) => {
    logger.error(`${err.name}: ${err.message}`);

    const statusCode = err.statusCode || 500;
    const message = err.message || 'Internal Server Error';

    res.status(statusCode).json({
        error: message,
        stack: process.env.NODE_ENV === 'production' ? null : err.stack
    });
};

module.exports = errorHandler;
