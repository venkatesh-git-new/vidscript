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

/**
 * Architectural Optimization: In-Memory Request Management
 * (Works on Render because the process stays alive)
 */
const inflightRequests = new Map<string, Promise<string | null>>();
const lastRequestTime = new Map<string, number>();
const THROTTLE_MS = 10000; // 10 seconds

function extractVideoId(url: string): string | null {
    const regex = /(?:youtube\.com\/(?:[^\/]+\/.+\/|(?:v|e(?:mbed)?)\/|.*[?&]v=)|youtu\.be\/|youtube\.com\/shorts\/)([^"&?\/\s]{11})/i;
    const match = url.match(regex);
    return match ? match[1] : null;
}

/**
 * Method 1: youtube-transcript (Lightweight, No Download)
 */
async function fetchWithYoutubeTranscript(videoId: string): Promise<string | null> {
    if (!YoutubeTranscript) return null;
    try {
        console.log(`[Transcribe API] Method 1: Trying youtube-transcript for ${videoId}...`);
        const data = await YoutubeTranscript.fetchTranscript(videoId, {
            lang: 'en',
            headers: HUMAN_HEADERS
        });
        if (data && data.length > 0) {
            console.log(`[Transcribe API] Method 1 Success`);
            return data.map((t: any) => t.text).join(" ");
        }
    } catch (e: any) {
        console.warn(`[Transcribe API] Method 1 failed: ${e.message.slice(0, 50)}`);
    }
    return null;
}

/**
 * Method 2: yt-transcript library
 */
async function fetchWithYtTranscript(videoId: string): Promise<string | null> {
    if (!YtTranscript) return null;
    try {
        console.log(`[Transcribe API] Method 2: Trying yt-transcript for ${videoId}...`);
        const yt = new YtTranscript({ videoId });
        const data = await yt.getTranscript();
        if (data && data.length > 0) {
            console.log(`[Transcribe API] Method 2 Success`);
            return data.map((t: any) => t.text).join(" ");
        }
    } catch (e: any) {
        console.warn(`[Transcribe API] Method 2 failed: ${e.message.slice(0, 50)}`);
    }
    return null;
}

/**
 * Method 3: yt-dlp (Heavyweight, Obsessive Resilience Fallback)
 */
async function fetchWithYtDlp(videoId: string): Promise<string | null> {
    const timestamp = Date.now();
    const tempBase = `/tmp/sub_${videoId}_${timestamp}`;

    let ytDlpPath = "yt-dlp";
    if (fs.existsSync("/usr/local/bin/yt-dlp")) {
        ytDlpPath = "/usr/local/bin/yt-dlp";
    }

    const clients = ["ios", "android", "mweb", "web"];

    for (const client of clients) {
        try {
            console.log(`[Transcribe API] Method 3: Attempting ${client} client for ${videoId}...`);

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
                `--extractor-args "youtube:player-client=${client}"`,
                fs.existsSync("/usr/local/bin/node") ? `--js-runtime "/usr/local/bin/node"` : "",
                `-o "${tempBase}"`,
                `"https://www.youtube.com/watch?v=${videoId}"`
            ].filter(Boolean).join(" ");

            execSync(`${ytDlpPath} ${args}`, { stdio: "pipe" });

            const matchingFiles = fs.readdirSync("/tmp").filter(f => f.startsWith(`sub_${videoId}_${timestamp}`));
            const subFile = matchingFiles.find(f => f.endsWith(".srt") || f.endsWith(".vtt"));

            if (subFile) {
                const content = fs.readFileSync(path.join("/tmp", subFile), "utf8");
                console.log(`[Transcribe API] Method 3 Success with client: ${client}`);
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
            console.warn(`[Transcribe API] Method 3: ${client} failed`);
        } finally {
            try {
                const files = fs.readdirSync("/tmp").filter(f => f.startsWith(`sub_${videoId}_${timestamp}`));
                files.forEach(f => fs.unlinkSync(path.join("/tmp", f)));
            } catch (e) { }
        }
    }
    return null;
}

/**
 * Orchestrator with Locking and Throttling
 */
async function performTranscription(videoId: string): Promise<string | null> {
    let fullText = await fetchWithYoutubeTranscript(videoId);
    if (!fullText) fullText = await fetchWithYtTranscript(videoId);
    if (!fullText) fullText = await fetchWithYtDlp(videoId);
    return fullText;
}

export async function POST(req: Request) {
    try {
        const { url } = await req.json();
        const videoId = extractVideoId(url);
        if (!videoId) return NextResponse.json({ error: "Invalid YouTube URL" }, { status: 400 });

        // A. Check Supabase Cache (Instant)
        try {
            const cached = await getCachedTranscript(videoId);
            if (cached) return NextResponse.json({ transcript: cached, source: "cache" });
        } catch (e) { }

        // B. Check In-Flight Locking (Prevent concurrent duplicate requests)
        // If someone is already fetching this, just wait and return the shared result.
        if (inflightRequests.has(videoId)) {
            console.log(`[Transcribe API] Sharing in-flight request for ${videoId}`);
            const result = await inflightRequests.get(videoId);
            if (result) return NextResponse.json({ transcript: result, source: "concurrent" });
            // If the inflight failed, we'll fall through to throttling/retry
        }

        // C. Apply Throttling (Protect YouTube IP reputation/Prevent Spam)
        const now = Date.now();
        const lastTime = lastRequestTime.get(videoId) || 0;
        if (now - lastTime < THROTTLE_MS) {
            console.log(`[Transcribe API] Request throttled for ${videoId}`);
            return NextResponse.json({
                error: "This video was requested very recently. Please wait a few seconds and try again."
            }, { status: 429 });
        }
        lastRequestTime.set(videoId, now);

        // D. Start the Heavy Lifting
        const transcriptionPromise = performTranscription(videoId);
        inflightRequests.set(videoId, transcriptionPromise);

        try {
            const fullText = await transcriptionPromise;

            if (!fullText || fullText.length < 10) {
                return NextResponse.json({
                    error: "YouTube is temporarily unavailable. Please try again on your machine or wait 30 minutes."
                }, { status: 429 });
            }

            // Save to Cache
            cacheTranscript(videoId, fullText).catch(() => { });
            return NextResponse.json({ transcript: fullText, source: "captions" });

        } finally {
            // E. Clean up in-flight promise
            inflightRequests.delete(videoId);
        }

    } catch (error: any) {
        return NextResponse.json({ error: "Internal Server Error" }, { status: 500 });
    }
}
