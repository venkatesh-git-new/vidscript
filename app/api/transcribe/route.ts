import { NextResponse } from "next/server";
import { getCachedTranscript, cacheTranscript } from "@/utils/supabase";
import { execSync } from "child_process";
import fs from "fs";
import path from "path";

// Use dynamic require for better CJS/ESM interop
let YtTranscript: any;
let YoutubeTranscript: any;

try {
    const YtTranscriptPkg = require('yt-transcript');
    YtTranscript = YtTranscriptPkg.YtTranscript || YtTranscriptPkg.default?.YtTranscript || YtTranscriptPkg;
} catch (e) { }

try {
    const YoutubeTranscriptPkg = require('youtube-transcript');
    YoutubeTranscript = YoutubeTranscriptPkg.YoutubeTranscript || YoutubeTranscriptPkg.default?.YoutubeTranscript || YoutubeTranscriptPkg;
} catch (e) { }

// Standard human-like headers
const HUMAN_HEADERS = {
    "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36",
    "Accept-Language": "en-US,en;q=0.9",
    "Referer": "https://www.google.com/"
};

function extractVideoId(url: string): string | null {
    const regex = /(?:youtube\.com\/(?:[^\/]+\/.+\/|(?:v|e(?:mbed)?)\/|.*[?&]v=)|youtu\.be\/|youtube\.com\/shorts\/)([^"&?\/\s]{11})/i;
    const match = url.match(regex);
    return match ? match[1] : null;
}

/**
 * Enhanced yt-dlp fetcher with human-mimicking and client rotation
 */
async function fetchWithYtDlp(videoId: string): Promise<string | null> {
    const timestamp = Date.now();
    const tempBase = `/tmp/sub_${videoId}_${timestamp}`;

    let ytDlpPath = "yt-dlp";
    if (fs.existsSync("/usr/local/bin/yt-dlp")) {
        ytDlpPath = "/usr/local/bin/yt-dlp";
    }

    // Try multiple player clients. iOS and Android are the most resilient.
    const clients = ["ios", "android", "mweb", "web"];

    for (const client of clients) {
        try {
            console.log(`[Transcribe API] Attempting bypass with client: ${client}...`);

            const args = [
                `--write-subs`,
                `--write-auto-subs`,
                `--sub-langs en`,
                `--sub-format srt`,
                `--skip-download`,
                `--ignore-errors`,
                `--no-check-certificates`,
                `--user-agent "${HUMAN_HEADERS["User-Agent"]}"`,
                `--referer "${HUMAN_HEADERS["Referer"]}"`,
                `--add-header "Accept-Language:${HUMAN_HEADERS["Accept-Language"]}"`,
                `--extractor-args "youtube:player-client=${client}"`,
                // Force use of node if found, to handle JS challenges
                fs.existsSync("/usr/local/bin/node") ? `--js-runtime "/usr/local/bin/node"` : "",
                `-o "${tempBase}"`,
                `"https://www.youtube.com/watch?v=${videoId}"`
            ].filter(Boolean).join(" ");

            execSync(`${ytDlpPath} ${args}`, { stdio: "pipe" });

            const matchingFiles = fs.readdirSync("/tmp").filter(f => f.startsWith(`sub_${videoId}_${timestamp}`));
            const subFile = matchingFiles.find(f => f.endsWith(".srt") || f.endsWith(".vtt"));

            if (subFile) {
                const content = fs.readFileSync(path.join("/tmp", subFile), "utf8");
                console.log(`[Transcribe API] Method 1 Success (Client: ${client})`);
                return content
                    .replace(/WEBVTT\r?\n/g, "")
                    .replace(/\d+\r?\n\d{2}:\d{2}:\d{2}[\.,]\d{3} --> \d{2}:\d{2}:\d{2}[\.,]\d{3}.*\r?\n/g, "")
                    .replace(/\d{2}:\d{2}:\d{2}[\.,]\d{3} --> \d{2}:\d{2}:\d{2}[\.,]\d{3}.*\r?\n/g, "")
                    .replace(/<[^>]*>/g, "")
                    .replace(/\r?\n/g, " ")
                    .replace(/\s+/g, " ")
                    .trim();
            }
        } catch (e: any) {
            console.warn(`[Transcribe API] ${client} check failed: ${e.stderr?.toString().slice(0, 50) || e.message}`);
        } finally {
            try {
                const files = fs.readdirSync("/tmp").filter(f => f.startsWith(`sub_${videoId}_${timestamp}`));
                files.forEach(f => fs.unlinkSync(path.join("/tmp", f)));
            } catch (e) { }
        }
    }
    return null;
}

async function fetchWithYtTranscript(videoId: string): Promise<string | null> {
    if (!YtTranscript) return null;
    try {
        console.log(`[Transcribe API] Method 2: Trying yt-transcript...`);
        // Note: yt-transcript doesn't easily expose header modification in constructor
        const yt = new YtTranscript({ videoId });
        const data = await yt.getTranscript();
        if (data && data.length > 0) return data.map((t: any) => t.text).join(" ");
    } catch (e) { }
    return null;
}

async function fetchWithYoutubeTranscript(videoId: string): Promise<string | null> {
    if (!YoutubeTranscript) return null;
    try {
        console.log(`[Transcribe API] Method 3: Trying youtube-transcript...`);
        // Pass configuration with custom headers
        const data = await YoutubeTranscript.fetchTranscript(videoId, {
            lang: 'en',
            headers: HUMAN_HEADERS
        });
        if (data && data.length > 0) return data.map((t: any) => t.text).join(" ");
    } catch (e) { }
    return null;
}

export async function POST(req: Request) {
    try {
        const { url } = await req.json();
        const videoId = extractVideoId(url);
        if (!videoId) return NextResponse.json({ error: "Invalid YouTube URL" }, { status: 400 });

        // 1. Check Cache
        try {
            const cached = await getCachedTranscript(videoId);
            if (cached) return NextResponse.json({ transcript: cached, source: "cache" });
        } catch (e) { }

        // 2. Try All Methods in order
        let fullText = await fetchWithYtDlp(videoId);
        if (!fullText) fullText = await fetchWithYtTranscript(videoId);
        if (!fullText) fullText = await fetchWithYoutubeTranscript(videoId);

        if (!fullText || fullText.length < 10) {
            return NextResponse.json({
                error: "YouTube is temporarily blocking transcription from this server's IP. Please try again on your machine or wait a few minutes."
            }, { status: 429 });
        }

        cacheTranscript(videoId, fullText).catch(() => { });
        return NextResponse.json({ transcript: fullText, source: "captions" });

    } catch (error: any) {
        return NextResponse.json({ error: "Internal Server Error" }, { status: 500 });
    }
}
