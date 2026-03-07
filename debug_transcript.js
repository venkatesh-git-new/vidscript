const { YoutubeTranscript } = require('youtube-transcript');

async function test() {
    const videoId = 'Wxf9oqxODU0';
    try {
        console.log(`Fetching transcript for ${videoId}...`);
        const transcript = await YoutubeTranscript.fetchTranscript(videoId);
        console.log('Transcript count:', transcript.length);
        if (transcript.length > 0) {
            console.log('First segment:', transcript[0]);
        } else {
            console.log('No transcript segments found.');
        }
    } catch (error) {
        console.error('Error:', error);
    }
}

test();
