import { NextResponse } from "next/server";
import { getCachedTranscript, cacheTranscript } from "@/utils/supabase";
import { execSync } from "child_process";
import fs from "fs";
import path from "path";
// @ts-ignore
import { YtTranscript } from 'yt-transcript';
// @ts-ignore
import { YoutubeTranscript } from 'youtube-transcript';

/**
 * Extracts the video ID from a YouTube URL safely.
 */
function extractVideoId(url: string): string | null {
    const regex = /(?:youtube\.com\/(?:[^\/]+\/.+\/|(?:v|e(?:mbed)?)\/|.*[?&]v=)|youtu\.be\/|youtube\.com\/shorts\/)([^"&?\/\s]{11})/i;
    const match = url.match(regex);
    return match ? match[1] : null;
}

/**
 * Method 1: yt-dlp (Best quality, handles timestamps)
 */
async function fetchWithYtDlp(videoId: string): Promise<string | null> {
    const timestamp = Date.now();
    const tempBase = `/tmp/sub_${videoId}_${timestamp}`;

    // Check possible local/Docker paths
    let ytDlpPath = "yt-dlp";
    if (fs.existsSync("/usr/local/bin/yt-dlp")) {
        ytDlpPath = "/usr/local/bin/yt-dlp";
    }

    try {
        console.log(`[Transcribe API] Method 1: Running ${ytDlpPath} for ${videoId}...`);
        // Simple command that worked in test scripts
        const command = `${ytDlpPath} --write-subs --write-auto-subs --sub-langs en --sub-format srt --skip-download --ignore-errors -o "${tempBase}" "https://www.youtube.com/watch?v=${videoId}"`;

        execSync(command, { stdio: "pipe" });

        const matchingFiles = fs.readdirSync("/tmp").filter(f => f.startsWith(`sub_${videoId}_${timestamp}`));
        const subFile = matchingFiles.find(f => f.endsWith(".srt") || f.endsWith(".vtt"));

        if (subFile) {
            const content = fs.readFileSync(path.join("/tmp", subFile), "utf8");
            console.log(`[Transcribe API] Method 1: Success (${content.length} chars)`);
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
        console.warn(`[Transcribe API] Method 1 failed: ${e.message}`);
    } finally {
        try {
            const files = fs.readdirSync("/tmp").filter(f => f.startsWith(`sub_${videoId}_${timestamp}`));
            files.forEach(f => fs.unlinkSync(path.join("/tmp", f)));
        } catch (e) { }
    }
    return null;
}

/**
 * Method 2: yt-transcript library
 */
async function fetchWithYtTranscript(videoId: string): Promise<string | null> {
    try {
        console.log(`[Transcribe API] Method 2: Trying yt-transcript library...`);
        const yt = new YtTranscript();
        const data = await yt.getTranscript(videoId);
        if (data && data.length > 0) {
            console.log(`[Transcribe API] Method 2: Success`);
            return data.map((t: any) => t.text).join(" ");
        }
    } catch (e: any) {
        console.warn(`[Transcribe API] Method 2 failed: ${e.message}`);
    }
    return null;
}

/**
 * Method 3: youtube-transcript library
 */
async function fetchWithYoutubeTranscript(videoId: string): Promise<string | null> {
    try {
        console.log(`[Transcribe API] Method 3: Trying youtube-transcript library...`);
        const data = await YoutubeTranscript.fetchTranscript(videoId);
        if (data && data.length > 0) {
            console.log(`[Transcribe API] Method 3: Success`);
            return data.map((t: any) => t.text).join(" ");
        }
    } catch (e: any) {
        console.warn(`[Transcribe API] Method 3 failed: ${e.message}`);
    }
    return null;
}

export async function POST(req: Request) {
    try {
        const { url } = await req.json();
        console.log(`[Transcribe API] Request for: ${url}`);

        const videoId = extractVideoId(url);
        if (!videoId) return NextResponse.json({ error: "Invalid YouTube URL" }, { status: 400 });

        // 1. Check Cache
        try {
            const cached = await getCachedTranscript(videoId);
            if (cached) {
                console.log(`[Transcribe API] Cache hit`);
                return NextResponse.json({ transcript: cached, source: "cache" });
            }
        } catch (e) { }

        // 2. Try All Methods in order
        let fullText = await fetchWithYtDlp(videoId);

        if (!fullText) {
            fullText = await fetchWithYtTranscript(videoId);
        }

        if (!fullText) {
            fullText = await fetchWithYoutubeTranscript(videoId);
        }

        if (!fullText || fullText.length < 10) {
            console.error(`[Transcribe API] All methods failed for ${videoId}`);
            return NextResponse.json({
                error: "No captions found for this video. Verified across 3 different extraction methods."
            }, { status: 404 });
        }

        console.log(`[Transcribe API] Final Success. Length: ${fullText.length}`);

        // 3. Save to Cache
        cacheTranscript(videoId, fullText).catch((err) =>
            console.error(`[Transcribe API] Cache error: ${err.message}`)
        );

        return NextResponse.json({ transcript: fullText, source: "captions" });

    } catch (error: any) {
        console.error(`[Transcribe API] Server crash: ${error.message}`);
        return NextResponse.json({ error: "Internal Server Error" }, { status: 500 });
    }
}
