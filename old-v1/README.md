# YT Transcribe Backend

A production-ready Node.js backend for transcribing YouTube videos using OpenAI Whisper, `yt-dlp`, and `FFmpeg`.

## Prerequisites

- **Node.js**: v16+ recommended
- **FFmpeg**: Must be installed on your system and available in your PATH.
- **yt-dlp**: Must be installed on your system and available in your PATH.
- **OpenAI API Key**: Required for Whisper transcription.

## Installation

1. Clone the repository or copy the files.
2. Install dependencies:
   ```bash
   npm install
   ```
3. Set up environment variables:
   - Copy `.env.example` to `.env`.
   - Add your `OPENAI_API_KEY`.
   - Optionally change the `PORT`.

## Running the Server

- **Development mode** (with auto-reload):
  ```bash
  npm run dev
  ```
- **Production mode**:
  ```bash
  npm start
  ```

## API Documentation

### POST /transcribe

Transcribes a YouTube video.

**Request Body:**
```json
{
  "youtube_url": "https://www.youtube.com/watch?v=VIDEO_ID"
}
```

**Success Response (JSON):**
```json
{
  "video_id": "...",
  "title": "...",
  "transcript": "...",
  "language": "...",
  "duration": "..."
}
```

**Error Response:**
```json
{
  "error": "Error message description"
}
```

## Project Structure

```
backend/
├── config/             # Configuration and environment variables
├── controllers/        # Request handlers
├── middleware/         # Custom middleware (auth, validation, etc.)
├── routes/             # API route definitions
├── services/           # Business logic and external integrations
├── utils/              # Helper functions and logging
├── temp/               # Temporary folder for audio processing
├── app.js              # Express app setup
└── server.js           # Entry point
```

## Example usage with curl

```bash
curl -X POST http://localhost:3001/transcribe \
  -H "Content-Type: application/json" \
  -d '{"youtube_url": "https://www.youtube.com/watch?v=ke5bhJ22aX4"}'
```
