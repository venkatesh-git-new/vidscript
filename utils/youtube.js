/**
 * Extracts the video ID from a YouTube URL.
 * Supports various formats:
 * - https://www.youtube.com/watch?v=VIDEO_ID
 * - https://youtu.be/VIDEO_ID
 * - https://www.youtube.com/embed/VIDEO_ID
 * - https://www.youtube.com/shorts/VIDEO_ID
 * @param {string} url - The YouTube URL.
 * @returns {string|null} - The video ID or null if not found.
 */
/**
 * @param {string | null} url
 * @returns {string | null}
 */
export function getYoutubeVideoId(url) {
    if (!url) return null;

    const regex = /(?:youtube\.com\/(?:[^\/]+\/.+\/|(?:v|e(?:mbed)?)\/|.*[?&]v=)|youtu\.be\/|youtube\.com\/shorts\/)([^"&?\/\s]{11})/i;
    const match = url.match(regex);

    return match ? match[1] : null;
}
