const { getTranscript } = require('yt-transcript');

async function test() {
    try {
        const transcript = await getTranscript('dQw4w9WgXcQ');
        console.log('Success!', transcript.length, 'lines fetched.');
        if (transcript.length > 0) {
            console.log('Sample:', transcript[0].text);
        }
    } catch (error) {
        console.error('Error:', error);
    }
}

test();
