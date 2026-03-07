const { YoutubeTranscript } = require('youtube-transcript');

async function test() {
    const videoId = 'dQw4w9WgXcQ';
    try {
        console.log(`Fetching transcript for ${videoId}...`);
        const transcript = await YoutubeTranscript.fetchTranscript(videoId);
        console.log('Transcript count:', transcript.length);
        if (transcript.length > 0) {
            console.log('Transcript snippet:', transcript.slice(0, 3).map(t => t.text).join(' '));
        }
    } catch (error) {
        console.error('Error:', error);
    }
}

test();
