const { YtTranscript } = require('yt-transcript');

async function test() {
    const videoId = 'dQw4w9WgXcQ';
    try {
        console.log(`Fetching transcript for ${videoId} with yt-transcript...`);
        const ytTranscript = new YtTranscript();
        const transcript = await ytTranscript.getTranscript(videoId);
        console.log('Transcript count:', transcript.length);
        if (transcript.length > 0) {
            console.log('Transcript snippet:', transcript.slice(0, 3).map(t => t.text).join(' '));
        } else {
            console.log('No transcript found.');
        }
    } catch (error) {
        console.error('Error:', error);
    }
}

test();
