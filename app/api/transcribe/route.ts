import { NextResponse } from "next/server";
import { getCachedTranscript, cacheTranscript } from "@/utils/supabase";
import { execSync } from "child_process";
import fs from "fs";
import path from "path";

/**
 * Extracts the video ID from a YouTube URL safely.
 */
function extractVideoId(url: string): string | null {
    const regex = /(?:youtube\.com\/(?:[^\/]+\/.+\/|(?:v|e(?:mbed)?)\/|.*[?&]v=)|youtu\.be\/|youtube\.com\/shorts\/)([^"&?\/\s]{11})/i;
    const match = url.match(regex);
    return match ? match[1] : null;
}

/**
 * Robustly fetches transcript using yt-dlp.
 */
async function fetchWithYtDlp(videoId: string): Promise<string | null> {
    const url = `https://www.youtube.com/watch?v=${videoId}`;
    const tempBase = path.join("/tmp", `sub_${videoId}_${Date.now()}`);

    try {
        console.log(`[Transcribe API] Running yt-dlp for ${videoId}...`);

        // --write-auto-subs ensures we get something even if not manually uploaded
        // We use --skip-download to only get the metadata/subtitles
        execSync(
            `yt-dlp --write-subs --write-auto-subs --sub-langs en --sub-format srt --skip-download -o "${tempBase}" "${url}"`,
            { stdio: "pipe" }
        );

        const srtPath = `${tempBase}.en.srt`;

        if (fs.existsSync(srtPath)) {
            const content = fs.readFileSync(srtPath, "utf8");

            // Clean up SRT tags and timestamps
            const cleanedText = content
                .replace(/\d+\r?\n\d{2}:\d{2}:\d{2},\d{3} --> \d{2}:\d{2}:\d{2},\d{3}\r?\n/g, "")
                .replace(/<[^>]*>/g, "") // Remove VTT/SRT tags like <c>
                .replace(/\r?\n/g, " ")
                .replace(/\s+/g, " ")
                .trim();

            // Cleanup file
            fs.unlinkSync(srtPath);

            return cleanedText;
        }
        return null;
    } catch (error: any) {
        console.error(`[Transcribe API] yt-dlp failed: ${error.message}`);
        return null;
    } finally {
        // Ensure cleanup of any other potential files created by yt-dlp
        try {
            const files = fs.readdirSync("/tmp").filter(f => f.startsWith(`sub_${videoId}`));
            files.forEach(f => fs.unlinkSync(path.join("/tmp", f)));
        } catch (e) { }
    }
}

export async function POST(req: Request) {
    try {
        const { url } = await req.json();
        console.log(`[Transcribe API] Received URL: ${url}`);

        if (!url || typeof url !== "string") {
            return NextResponse.json({ error: "YouTube URL is required" }, { status: 400 });
        }

        const videoId = extractVideoId(url);
        if (!videoId) {
            return NextResponse.json({ error: "Invalid YouTube URL format" }, { status: 400 });
        }

        // 1. Check Cache
        try {
            const cached = await getCachedTranscript(videoId);
            if (cached) {
                console.log(`[Transcribe API] Cache hit for ${videoId}`);
                return NextResponse.json({ transcript: cached, source: "cache" });
            }
        } catch (e) {
            console.warn("[Transcribe API] Cache check failed, proceeding to fetch...");
        }

        // 2. Fetch using yt-dlp (Robust method)
        const fullText = await fetchWithYtDlp(videoId);

        if (!fullText || fullText.length < 10) {
            console.error(`[Transcribe API] No transcript found for ${videoId}`);
            return NextResponse.json({
                error: "No captions found for this video. Captions might be disabled or unavailable in English."
            }, { status: 404 });
        }

        console.log(`[Transcribe API] Successfully extracted ${fullText.length} chars for ${videoId}`);

        // 3. Save to Cache (Async)
        cacheTranscript(videoId, fullText).catch((err) =>
            console.error(`[Transcribe API] Cache save error: ${err.message}`)
        );

        return NextResponse.json({
            transcript: fullText,
            source: "captions"
        });

    } catch (error: any) {
        console.error(`[Transcribe API] Unexpected server error: ${error.message}`);
        return NextResponse.json({ error: "Internal Server Error" }, { status: 500 });
    }
}



