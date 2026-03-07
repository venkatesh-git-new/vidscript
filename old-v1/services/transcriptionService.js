const fs = require('fs');
const { OpenAI } = require('openai');
const config = require('../config');
const logger = require('../utils/logger');

const openai = new OpenAI({
    apiKey: config.openaiApiKey,
});

/**
 * Transcribes an audio file using OpenAI Whisper.
 * @param {string} filePath - Path to the WAV file.
 * @returns {Promise<Object>} - The transcription result.
 */
const transcribeAudio = async (filePath) => {
    try {
        logger.info(`Starting transcription for file: ${filePath}`);

        const transcription = await openai.audio.transcriptions.create({
            file: fs.createReadStream(filePath),
            model: "whisper-1",
        });

        logger.info(`Transcription complete.`);
        return {
            text: transcription.text,
            language: transcription.language || 'unknown'
        };
    } catch (error) {
        logger.error(`Error during transcription: ${error.message}`);
        throw new Error('Transcription failed.');
    }
};

module.exports = {
    transcribeAudio
};
