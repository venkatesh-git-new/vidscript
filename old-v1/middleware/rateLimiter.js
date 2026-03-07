const rateLimit = require('express-rate-limit');

/**
 * Basic rate limiter for the transcribe endpoint.
 */
const transcribeLimiter = rateLimit({
    windowMs: 15 * 60 * 1000, // 15 minutes
    max: 10, // limit each IP to 10 requests per windowMs
    message: {
        error: 'Too many requests, please try again after 15 minutes.'
    },
    standardHeaders: true,
    legacyHeaders: false,
});

module.exports = transcribeLimiter;
