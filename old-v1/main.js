document.addEventListener('DOMContentLoaded', () => {
    const urlInput = document.getElementById('youtube-url');
    const generateBtn = document.getElementById('generate-btn');
    const btnLoader = document.getElementById('btn-loader');
    const btnText = generateBtn.querySelector('span');
    const resultSection = document.getElementById('result-section');
    const transcriptContent = document.getElementById('transcript-content');
    const errorText = document.getElementById('error-text');
    const copyBtn = document.getElementById('copy-btn');

    const API_URL = 'http://localhost:3001/transcribe';

    generateBtn.addEventListener('click', async () => {
        const url = urlInput.value.trim();

        if (!url) {
            showError('Please enter a YouTube video URL.');
            return;
        }

        if (!isValidYoutubeUrl(url)) {
            showError('Please enter a valid YouTube URL.');
            return;
        }

        // UI Reset
        hideError();
        setLoading(true);
        resultSection.classList.add('hidden');

        try {
            const response = await fetch(API_URL, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify({ youtube_url: url })
            });

            const data = await response.json();

            if (!response.ok) {
                throw new Error(data.error || 'Failed to fetch transcript.');
            }

            // Display result
            transcriptContent.value = data.transcript;
            resultSection.classList.remove('hidden');

            // Smooth scroll to result
            window.scrollTo({
                top: resultSection.offsetTop - 50,
                behavior: 'smooth'
            });

        } catch (err) {
            showError(err.message);
        } finally {
            setLoading(false);
        }
    });

    copyBtn.addEventListener('click', () => {
        transcriptContent.select();
        document.execCommand('copy');

        const originalText = copyBtn.textContent;
        copyBtn.textContent = 'Copied!';
        setTimeout(() => {
            copyBtn.textContent = originalText;
        }, 2000);
    });

    function setLoading(isLoading) {
        if (isLoading) {
            generateBtn.disabled = true;
            btnLoader.style.display = 'block';
            btnText.textContent = 'Processing...';
        } else {
            generateBtn.disabled = false;
            btnLoader.style.display = 'none';
            btnText.textContent = 'Transcribe';
        }
    }

    function showError(msg) {
        errorText.textContent = msg;
        errorText.classList.remove('hidden');
    }

    function hideError() {
        errorText.classList.add('hidden');
    }

    function isValidYoutubeUrl(url) {
        const regex = /(?:youtube\.com\/(?:[^\/]+\/.+\/|(?:v|e(?:mbed)?|shorts)\/|.*[?&]v=)|youtu\.be\/)([^"&?\/\s]{11})/;
        return regex.test(url);
    }
});
