/**
 * Browser-side YouTube Caption Extraction Engine
 */

export interface CaptionTrack {
    baseUrl: string;
    languageCode: string;
    kind?: string;
}

/**
 * Extracts Video ID and normalizes Shorts URLs
 */
export function extractVideoId(url: string): string | null {
    const regex = /(?:youtube\.com\/(?:[^\/]+\/.+\/|(?:v|e(?:mbed)?)\/|.*[?&]v=)|youtu\.be\/|youtube\.com\/shorts\/)([^"&?\/\s]{11})/i;
    const match = url.match(regex);
    return match ? match[1] : null;
}

/**
 * Parses the YouTube watch page HTML to find ytInitialPlayerResponse
 */
export async function getCaptionTracks(videoId: string): Promise<CaptionTrack[]> {
    const videoUrl = `https://www.youtube.com/watch?v=${videoId}`;

    // Using a CORS proxy to bypass the Same-Origin Policy in the browser
    const proxyUrl = `https://api.allorigins.win/get?url=${encodeURIComponent(videoUrl)}`;

    console.log(`[BrowserEngine] Fetching watch page via proxy for ${videoId}...`);
    const response = await fetch(proxyUrl);

    if (!response.ok) {
        throw new Error(`Failed to fetch YouTube page via proxy: ${response.statusText}`);
    }

    const data = await response.json();
    const html = data.contents; // AllOrigins returns the HTML in the 'contents' field

    // Locate ytInitialPlayerResponse
    const regex = /ytInitialPlayerResponse\s*=\s*({.+?})\s*;/;
    const match = html.match(regex);
    if (!match) {
        throw new Error("Could not find player response data on the YouTube page. Captions might be disabled or this is a restricted video.");
    }

    try {
        const playerResponse = JSON.parse(match[1]);
        const tracks = playerResponse.captions?.playerCaptionsTracklistRenderer?.captionTracks;

        if (!tracks || tracks.length === 0) {
            throw new Error("No captions found for this video.");
        }

        return tracks.map((t: any) => ({
            baseUrl: t.baseUrl,
            languageCode: t.languageCode,
            kind: t.kind
        }));
    } catch (e) {
        console.error("[BrowserEngine] Parsing error:", e);
        throw new Error("Failed to parse YouTube player data.");
    }
}

/**
 * Selects the best English track: Manual > Auto
 */
export function selectBestTrack(tracks: CaptionTrack[]): CaptionTrack {
    // 1. English Manual
    const manualEn = tracks.find(t => t.languageCode.startsWith('en') && t.kind !== 'asr');
    if (manualEn) return manualEn;

    // 2. English Auto
    const autoEn = tracks.find(t => t.languageCode.startsWith('en'));
    if (autoEn) return autoEn;

    // 3. First available
    return tracks[0];
}

/**
 * Fetches and cleans XML captions
 */
export async function downloadTranscript(baseUrl: string): Promise<string> {
    console.log("[BrowserEngine] Downloading caption XML...");
    const response = await fetch(baseUrl);
    if (!response.ok) throw new Error("Failed to download caption track.");

    const xml = await response.text();

    // Simple XML cleaning: remove tags, decode entities, join lines
    const transcript = xml
        .replace(/<text[^>]*>/g, ' ')
        .replace(/<\/text>/g, ' ')
        .replace(/<[^>]+>/g, '') // Strip remaining tags
        .replace(/&amp;/g, '&')
        .replace(/&lt;/g, '<')
        .replace(/&gt;/g, '>')
        .replace(/&quot;/g, '"')
        .replace(/&#39;/g, "'")
        .replace(/\s+/g, ' ')
        .trim();

    if (!transcript) throw new Error("Caption track is empty.");
    return transcript;
}
