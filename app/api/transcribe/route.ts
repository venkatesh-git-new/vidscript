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

function extractVideoId(url: string): string | null {
    const regex = /(?:youtube\.com\/(?:[^\/]+\/.+\/|(?:v|e(?:mbed)?)\/|.*[?&]v=)|youtu\.be\/|youtube\.com\/shorts\/)([^"&?\/\s]{11})/i;
    const match = url.match(regex);
    return match ? match[1] : null;
}

/**
 * Enhanced yt-dlp fetcher with client rotation to bypass bot checks
 */
async function fetchWithYtDlp(videoId: string): Promise<string | null> {
    const timestamp = Date.now();
    const tempBase = `/tmp/sub_${videoId}_${timestamp}`;

    let ytDlpPath = "yt-dlp";
    if (fs.existsSync("/usr/local/bin/yt-dlp")) {
        ytDlpPath = "/usr/local/bin/yt-dlp";
    }

    // Try multiple player clients. iOS and Android are often less restricted.
    const clients = ["ios", "android", "web", "mweb"];

    for (const client of clients) {
        try {
            console.log(`[Transcribe API] Attempting client: ${client} for ${videoId}...`);

            const args = [
                `--write-subs`,
                `--write-auto-subs`,
                `--sub-langs en`,
                `--sub-format srt`,
                `--skip-download`,
                `--ignore-errors`,
                `--no-check-certificates`,
                `--extractor-args "youtube:player-client=${client}"`,
                `-o "${tempBase}"`,
                `"https://www.youtube.com/watch?v=${videoId}"`
            ].join(" ");

            execSync(`${ytDlpPath} ${args}`, { stdio: "pipe" });

            const matchingFiles = fs.readdirSync("/tmp").filter(f => f.startsWith(`sub_${videoId}_${timestamp}`));
            const subFile = matchingFiles.find(f => f.endsWith(".srt") || f.endsWith(".vtt"));

            if (subFile) {
                const content = fs.readFileSync(path.join("/tmp", subFile), "utf8");
                console.log(`[Transcribe API] SUCCESS with client: ${client}`);
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
            const errorMsg = e.stderr?.toString() || e.message;
            console.warn(`[Transcribe API] Client ${client} failed: ${errorMsg.slice(0, 100)}...`);
            // Continue to next client
        } finally {
            // Cleanup between attempts
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
        const data = await YoutubeTranscript.fetchTranscript(videoId);
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

        // 2. Try All Methods
        let fullText = await fetchWithYtDlp(videoId);
        if (!fullText) fullText = await fetchWithYtTranscript(videoId);
        if (!fullText) fullText = await fetchWithYoutubeTranscript(videoId);

        if (!fullText || fullText.length < 10) {
            return NextResponse.json({
                error: "YouTube is temporarily blocking requests from this server. Please try again in 30 minutes or try a different video."
            }, { status: 429 });
        }

        cacheTranscript(videoId, fullText).catch(() => { });
        return NextResponse.json({ transcript: fullText, source: "captions" });

    } catch (error: any) {
        return NextResponse.json({ error: "Internal Server Error" }, { status: 500 });
    }
}
