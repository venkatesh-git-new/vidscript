const youtubeService = require('../services/youtubeService');
const audioService = require('../services/audioService');
const transcriptionService = require('../services/transcriptionService');
const logger = require('../utils/logger');
const { exec } = require('child_process');

/**
 * Handles the transcription request.
 */
const transcribe = async (req, res, next) => {
    const { youtube_url } = req.body;
    let audioFilePath = null;

    try {
        const videoId = youtubeService.extractVideoId(youtube_url);
        if (!videoId) {
            return res.status(400).json({ error: 'Could not extract video ID from URL.' });
        }

        logger.info(`Processing transcription for video ID: ${videoId}`);

        // Get video metadata (title, duration)
        // We can use yt-dlp to get title
        const ytDlpPath = '/home/acerhell/.local/share/mise/installs/python/3.14.0/bin/yt-dlp';
        const metadataCommand = `${ytDlpPath} --print title --print duration_string "https://www.youtube.com/watch?v=${videoId}"`;

        const getMetadata = () => {
            return new Promise((resolve) => {
                exec(metadataCommand, { timeout: 10000 }, (error, stdout) => {
                    if (error) {
                        logger.warn(`Failed to get metadata: ${error.message}`);
                        return resolve({ title: 'Unknown Title', duration: 'Unknown' });
                    }
                    const lines = stdout.trim().split('\n');
                    resolve({
                        title: lines[0] || 'Unknown Title',
                        duration: lines[1] || 'Unknown'
                    });
                });
            });
        };

        // Get video metadata and download/convert concurrently
        const [metadata, audioPath] = await Promise.all([
            getMetadata(),
            audioService.downloadAndConvert(videoId)
        ]);

        audioFilePath = audioPath;

        // Get transcription
        const transcription = await transcriptionService.transcribeAudio(audioFilePath);

        // Clean up the wav file
        audioService.cleanupFile(audioFilePath);

        res.json({
            video_id: videoId,
            title: metadata.title,
            transcript: transcription.text,
            language: transcription.language,
            duration: metadata.duration
        });

    } catch (error) {
        if (audioFilePath) audioService.cleanupFile(audioFilePath);
        logger.error(`Error in transcribeController: ${error.message}`);
        next(error);
    }
};

module.exports = {
    transcribe
};
