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

const HUMAN_HEADERS = {
    "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36",
    "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8,application/signed-exchange;v=b3;q=0.7",
    "Accept-Language": "en-US,en;q=0.9",
    "Referer": "https://www.google.com/",
};

const inflightRequests = new Map<string, Promise<string | null>>();
const lastRequestTime = new Map<string, number>();
const THROTTLE_MS = 10000;

function extractVideoId(url: string): string | null {
    const regex = /(?:youtube\.com\/(?:[^\/]+\/.+\/|(?:v|e(?:mbed)?)\/|.*[?&]v=)|youtu\.be\/|youtube\.com\/shorts\/)([^"&?\/\s]{11})/i;
    const match = url.match(regex);
    return match ? match[1] : null;
}

/**
 * Method 1: youtube-transcript
 */
async function fetchWithYoutubeTranscript(videoId: string): Promise<string | null> {
    if (!YoutubeTranscript) return null;
    try {
        console.log(`[Transcribe API] Method 1: youtube-transcript (${videoId})`);
        const data = await YoutubeTranscript.fetchTranscript(videoId, {
            lang: 'en',
            headers: HUMAN_HEADERS
        });
        if (data && data.length > 0) return data.map((t: any) => t.text).join(" ");
    } catch (e: any) { }
    return null;
}

/**
 * Method 2: yt-transcript
 */
async function fetchWithYtTranscript(videoId: string): Promise<string | null> {
    if (!YtTranscript) return null;
    try {
        console.log(`[Transcribe API] Method 2: yt-transcript (${videoId})`);
        const yt = new YtTranscript({ videoId });
        const data = await yt.getTranscript();
        if (data && data.length > 0) return data.map((t: any) => t.text).join(" ");
    } catch (e: any) { }
    return null;
}

/**
 * Method 3: yt-dlp (Authenticated Cookie Support)
 */
async function fetchWithYtDlp(videoId: string): Promise<string | null> {
    const timestamp = Date.now();
    const tempBase = `/tmp/sub_${videoId}_${timestamp}`;
    const cookieFile = `/tmp/cookies_${timestamp}.txt`;

    let ytDlpPath = "yt-dlp";
    if (fs.existsSync("/usr/local/bin/yt-dlp")) {
        ytDlpPath = "/usr/local/bin/yt-dlp";
    }

    // Load cookies from Env if available (Critical for bypassing data center blocks)
    let hasCookies = false;
    if (process.env.YOUTUBE_COOKIES_BASE64) {
        try {
            const cookies = Buffer.from(process.env.YOUTUBE_COOKIES_BASE64, 'base64').toString('utf8');
            fs.writeFileSync(cookieFile, cookies);
            hasCookies = true;
            console.log(`[Transcribe API] Using authenticated cookies for bypass.`);
        } catch (e) {
            console.error(`[Transcribe API] Failed to load cookies: ${e}`);
        }
    }

    const clients = hasCookies ? ["web"] : ["web_embedded", "ios", "android", "tv"];

    for (const client of clients) {
        try {
            console.log(`[Transcribe API] Method 3: Client ${client}...`);

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
                hasCookies ? `--cookies "${cookieFile}"` : "",
                fs.existsSync("/usr/local/bin/node") ? `--js-runtime "/usr/local/bin/node"` : "",
                `-o "${tempBase}"`,
                `"https://www.youtube.com/watch?v=${videoId}"`
            ].filter(Boolean).join(" ");

            execSync(`${ytDlpPath} ${args}`, { stdio: "pipe" });

            const matchingFiles = fs.readdirSync("/tmp").filter(f => f.startsWith(`sub_${videoId}_${timestamp}`));
            const subFile = matchingFiles.find(f => f.endsWith(".srt") || f.endsWith(".vtt"));

            if (subFile) {
                const content = fs.readFileSync(path.join("/tmp", subFile), "utf8");
                console.log(`[Transcribe API] Method 3 SUCCESS (${client})`);
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
            console.warn(`[Transcribe API] Method 3: Client ${client} blocked.`);
        } finally {
            try {
                const files = fs.readdirSync("/tmp").filter(f => f.startsWith(`sub_${videoId}_${timestamp}`));
                files.forEach(f => fs.unlinkSync(path.join("/tmp", f)));
                if (fs.existsSync(cookieFile)) fs.unlinkSync(cookieFile);
            } catch (e) { }
        }
    }
    return null;
}

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

        // A. Cache Check
        try {
            const cached = await getCachedTranscript(videoId);
            if (cached) return NextResponse.json({ transcript: cached, source: "cache" });
        } catch (e) { }

        // B. Concurrent Request Lock
        if (inflightRequests.has(videoId)) {
            console.log(`[Transcribe API] Joining in-flight request for ${videoId}`);
            const result = await inflightRequests.get(videoId);
            if (result) return NextResponse.json({ transcript: result, source: "concurrent" });
        }

        // C. Throttling
        const now = Date.now();
        const lastTime = lastRequestTime.get(videoId) || 0;
        if (now - lastTime < THROTTLE_MS) {
            return NextResponse.json({
                error: "Too many requests for this video. Please wait 10 seconds."
            }, { status: 429 });
        }
        lastRequestTime.set(videoId, now);

        // D. Processing
        const transcriptionPromise = performTranscription(videoId);
        inflightRequests.set(videoId, transcriptionPromise);

        try {
            const fullText = await transcriptionPromise;
            if (!fullText || fullText.length < 10) {
                return NextResponse.json({
                    error: "YouTube is blocking this server. Please add YOUTUBE_COOKIES_BASE64 to your Env variables."
                }, { status: 429 });
            }

            cacheTranscript(videoId, fullText).catch(() => { });
            return NextResponse.json({ transcript: fullText, source: "captions" });

        } finally {
            inflightRequests.delete(videoId);
        }

    } catch (error: any) {
        return NextResponse.json({ error: "Server Error" }, { status: 500 });
    }
}
