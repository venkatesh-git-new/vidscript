const { execSync } = require('child_process');
const fs = require('fs');
const path = require('path');

function getTranscriptWithYtDlp(videoId) {
    const url = `https://www.youtube.com/watch?v=${videoId}`;
    const tempFile = path.join(__dirname, `sub_${videoId}`);

    try {
        console.log(`Running yt-dlp for ${videoId}...`);
        // Try to get English subtitles, fallback to auto-generated if needed
        execSync(`yt-dlp --write-subs --write-auto-subs --sub-langs en --sub-format srt --skip-download -o "${tempFile}" "${url}"`, { stdio: 'inherit' });

        // yt-dlp saves with language suffix, e.g., temp_sub.en.srt
        const srtPath = `${tempFile}.en.srt`;
        if (fs.existsSync(srtPath)) {
            const content = fs.readFileSync(srtPath, 'utf8');
            // Simple SRT parser to get text
            const text = content
                .replace(/\d+\r?\n\d{2}:\d{2}:\d{2},\d{3} --> \d{2}:\d{2}:\d{2},\d{3}\r?\n/g, '')
                .replace(/\r?\n/g, ' ')
                .trim();

            console.log('Transcript length:', text.length);
            console.log('Snippet:', text.slice(0, 100));

            // Cleanup
            fs.unlinkSync(srtPath);
            return text;
        } else {
            console.log('Subtitle file not found.');
            return null;
        }
    } catch (error) {
        console.error('yt-dlp error:', error.message);
        return null;
    }
}

getTranscriptWithYtDlp('dQw4w9WgXcQ');
