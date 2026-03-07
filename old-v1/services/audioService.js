const { exec } = require('child_process');
const path = require('path');
const fs = require('fs');
const ffmpeg = require('fluent-ffmpeg');
const logger = require('../utils/logger');
const config = require('../config');

/**
 * Downloads audio from YouTube and converts it to WAV.
 * @param {string} videoId - The YouTube video ID.
 * @returns {Promise<string>} - The path to the generated WAV file.
 */
const downloadAndConvert = (videoId) => {
    return new Promise((resolve, reject) => {
        const outputDir = path.resolve(config.tempDir);
        if (!fs.existsSync(outputDir)) {
            fs.mkdirSync(outputDir, { recursive: true });
        }

        const tempAudioPath = path.join(outputDir, `${videoId}.m4a`);
        const wavOutputPath = path.join(outputDir, `${videoId}.wav`);

        logger.info(`Starting download for video: ${videoId}`);

        // Use yt-dlp to download the best audio
        const ytDlpPath = '/home/acerhell/.local/share/mise/installs/python/3.14.0/bin/yt-dlp';
        const ytDlpCommand = `${ytDlpPath} -x --audio-format m4a -o "${tempAudioPath}" "https://www.youtube.com/watch?v=${videoId}"`;

        exec(ytDlpCommand, { maxBuffer: 10 * 1024 * 1024, timeout: 60000 }, (error, stdout, stderr) => {
            if (error) {
                logger.error(`Error downloading video ${videoId}: ${error.message}`);
                return reject(new Error('Failed to download YouTube video.'));
            }

            logger.info(`Download complete for ${videoId}. Converting to WAV...`);

            // Convert to WAV using FFmpeg
            ffmpeg(tempAudioPath)
                .toFormat('wav')
                .on('error', (err) => {
                    logger.error(`Error converting to WAV for ${videoId}: ${err.message}`);
                    if (fs.existsSync(tempAudioPath)) fs.unlinkSync(tempAudioPath);
                    reject(new Error('Failed to convert audio file.'));
                })
                .on('end', () => {
                    logger.info(`Conversion complete for ${videoId}.`);
                    // Delete the temporary m4a file
                    if (fs.existsSync(tempAudioPath)) fs.unlinkSync(tempAudioPath);
                    resolve(wavOutputPath);
                })
                .save(wavOutputPath);
        });
    });
};

/**
 * Deletes a file from the filesystem.
 * @param {string} filePath - The path to the file.
 */
const cleanupFile = (filePath) => {
    if (fs.existsSync(filePath)) {
        fs.unlink(filePath, (err) => {
            if (err) logger.error(`Error deleting file ${filePath}: ${err.message}`);
            else logger.info(`Deleted temporary file: ${filePath}`);
        });
    }
};

module.exports = {
    downloadAndConvert,
    cleanupFile
};
