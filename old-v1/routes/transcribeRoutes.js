const express = require('express');
const router = express.Router();
const transcribeController = require('../controllers/transcribeController');
const { validateTranscribe } = require('../middleware/validator');
const transcribeLimiter = require('../middleware/rateLimiter');

/**
 * @route POST /transcribe
 * @desc Transcribe a YouTube video
 * @access Public
 */
router.post('/', transcribeLimiter, validateTranscribe, transcribeController.transcribe);

module.exports = router;
