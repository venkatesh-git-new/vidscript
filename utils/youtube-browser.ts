/**
 * Browser-side YouTube Caption Extraction Engine (Proxied)
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
 * Robust XML to text converter
 */
function cleanXml(xml: string): string {
    return xml
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
}

/**
 * Parses caption tracks from raw HTML
 */
function parseCaptionTracksFromHtml(html: string): CaptionTrack[] {
    // YouTube uses different ways to embed this data. We try multiple regex patterns.
    const patterns = [
        /ytInitialPlayerResponse\s*=\s*({.+?})\s*;\s*(?:var|window|function)/, // Followed by code
        /ytInitialPlayerResponse\s*=\s*({.+?})\s*;/,                         // Standard
        /ytInitialPlayerResponse\s*=\s*({.+?})\s*(?:\n|<\/script>)/           // End of script tag
    ];

    let playerResponse: any = null;

    for (const pattern of patterns) {
        const match = html.match(pattern);
        if (match) {
            try {
                playerResponse = JSON.parse(match[1]);
                if (playerResponse.captions) break;
            } catch (e) {
                console.warn("[BrowserEngine] Regex match failed to parse as JSON:", match[1].substring(0, 100));
            }
        }
    }

    if (!playerResponse) {
        // Fallback: check ytInitialData (rarely contains full captions but worth a look)
        const dataMatch = html.match(/ytInitialData\s*=\s*({.+?})\s*;/);
        if (dataMatch) {
            try {
                const data = JSON.parse(dataMatch[1]);
                // Sometimes captions are tucked away in playabilityStatus
                playerResponse = data.playerResponse;
            } catch (e) { }
        }
    }

    if (!playerResponse) {
        console.error("[BrowserEngine] Raw HTML Sample:", html.substring(0, 500));
        throw new Error("Could not find player response data. The video might be private, restricted, or YouTube changed their page layout.");
    }

    const tracks = playerResponse.captions?.playerCaptionsTracklistRenderer?.captionTracks;

    if (!tracks || tracks.length === 0) {
        // One last check: maybe it's translated?
        const translationTracks = playerResponse.captions?.playerCaptionsTracklistRenderer?.translationLanguages;
        if (translationTracks && translationTracks.length > 0) {
            throw new Error(`This video only has translated captions. Manual transcription might be required.`);
        }
        throw new Error("No captions found for this video. Use the AI Fallback (if implemented) or check the YouTube link.");
    }

    return tracks.map((t: any) => ({
        baseUrl: t.baseUrl,
        languageCode: t.languageCode,
        kind: t.kind
    }));
}

/**
 * Fetches the watch page using multiple proxy fallbacks
 */
export async function getCaptionTracks(videoId: string): Promise<CaptionTrack[]> {
    const videoUrl = `https://www.youtube.com/watch?v=${videoId}`;

    // List of free CORS proxies to try
    const proxies = [
        `https://corsproxy.io/?${encodeURIComponent(videoUrl)}`,
        `https://api.allorigins.win/get?url=${encodeURIComponent(videoUrl)}`
    ];

    let lastError = "";

    for (const proxyUrl of proxies) {
        try {
            console.log(`[BrowserEngine] Attempting fetch via proxy: ${proxyUrl.split('?')[0]}`);
            const response = await fetch(proxyUrl);

            if (!response.ok) {
                lastError = `Proxy returned ${response.status}: ${response.statusText}`;
                continue;
            }

            let html = "";
            if (proxyUrl.includes("allorigins")) {
                const data = await response.json();
                html = data.contents;
            } else {
                html = await response.text();
            }

            if (html && html.includes("ytInitialPlayerResponse")) {
                return parseCaptionTracksFromHtml(html);
            }
        } catch (e: any) {
            console.warn(`[BrowserEngine] Proxy failed: ${proxyUrl.split('?')[0]}`, e.message);
            lastError = e.message;
        }
    }

    throw new Error(`Connection issue: "${lastError}". This is often caused by an ad-blocker or your browser blocking the connection to the proxy service. Please try disabling ad-blockers or using a different browser.`);
}

/**
 * Selects the best English track: Manual > Auto
 */
export function selectBestTrack(tracks: CaptionTrack[]): CaptionTrack {
    const manualEn = tracks.find(t => t.languageCode.startsWith('en') && t.kind !== 'asr');
    if (manualEn) return manualEn;

    const autoEn = tracks.find(t => t.languageCode.startsWith('en'));
    if (autoEn) return autoEn;

    return tracks[0];
}

/**
 * Fetches and cleans XML captions (also via proxy to avoid CORS)
 */
export async function downloadTranscript(baseUrl: string): Promise<string> {
    const proxyUrl = `https://corsproxy.io/?${encodeURIComponent(baseUrl)}`;

    console.log("[BrowserEngine] Downloading captions via proxy...");
    const response = await fetch(proxyUrl);

    if (!response.ok) {
        // Try fallback proxy for the XML too
        const fallbackUrl = `https://api.allorigins.win/get?url=${encodeURIComponent(baseUrl)}`;
        const fallbackRes = await fetch(fallbackUrl);
        if (!fallbackRes.ok) throw new Error("Failed to download caption XML from all proxies.");

        const data = await fallbackRes.json();
        return cleanXml(data.contents);
    }

    const xml = await response.text();
    const transcript = cleanXml(xml);

    if (!transcript) throw new Error("Caption track is empty.");
    return transcript;
}
