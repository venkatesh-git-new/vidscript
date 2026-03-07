const logger = require('../utils/logger');

/**
 * Validates the transcription request.
 * @param {Object} req - Express request object.
 * @param {Object} res - Express response object.
 * @param {Function} next - Express next function.
 */
const validateTranscribe = (req, res, next) => {
    const { youtube_url } = req.body;

    if (!youtube_url) {
        return res.status(400).json({ error: 'YouTube URL is required.' });
    }

    const youtubeRegex = /^(https?:\/\/)?(www\.)?(youtube\.com|youtu\.?be)\/.+$/;
    if (!youtubeRegex.test(youtube_url)) {
        return res.status(400).json({ error: 'Invalid YouTube URL.' });
    }

    next();
};

module.exports = {
    validateTranscribe
};
