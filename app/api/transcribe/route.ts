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
    const timestamp = Date.now();
    const tempBase = `/tmp/sub_${videoId}_${timestamp}`;
    const ytDlpPath = "/usr/local/bin/yt-dlp";

    try {
        console.log(`[Transcribe API] Running ${ytDlpPath} for ${videoId}...`);

        // --sub-langs "en.*" catches en, en-US, en-GB etc.
        const command = `${ytDlpPath} --write-subs --write-auto-subs --sub-langs "en.*" --sub-format "srt/vtt/best" --skip-download -o "${tempBase}" "${url}"`;
        console.log(`[Transcribe API] Executing: ${command}`);

        execSync(command, { stdio: "pipe" });

        // List matching files
        const allTmpFiles = fs.readdirSync("/tmp");
        const matchingFiles = allTmpFiles.filter(f => f.startsWith(`sub_${videoId}_${timestamp}`));
        console.log(`[Transcribe API] Files found: ${matchingFiles.join(", ")}`);

        // Find the best caption file
        const subFile = matchingFiles.find(f => f.endsWith(".srt") || f.endsWith(".vtt"));

        if (subFile) {
            const fullPath = path.join("/tmp", subFile);
            const content = fs.readFileSync(fullPath, "utf8");

            // Clean up tags and timestamps
            const cleanedText = content
                .replace(/WEBVTT\r?\n/g, "") // Remove VTT header
                .replace(/Kind: captions\r?\n/g, "")
                .replace(/Language: .*\r?\n/g, "")
                .replace(/\d+\r?\n\d{2}:\d{2}:\d{2}[\.,]\d{3} --> \d{2}:\d{2}:\d{2}[\.,]\d{3}.*\r?\n/g, "") // Modern timestamps
                .replace(/\d{2}:\d{2}:\d{2}[\.,]\d{3} --> \d{2}:\d{2}:\d{2}[\.,]\d{3}.*\r?\n/g, "") // Timestamps without index
                .replace(/<[^>]*>/g, "") // Remove VTT/SRT tags like <c>
                .replace(/\r?\n/g, " ")
                .replace(/\s+/g, " ")
                .trim();

            return cleanedText;
        }

        console.warn(`[Transcribe API] No subtitle file generated for ${videoId}`);
        return null;
    } catch (error: any) {
        console.error(`[Transcribe API] yt-dlp failed for ${videoId}: ${error.message}`);
        if (error.stderr) console.error(`[Transcribe API] Stderr: ${error.stderr.toString()}`);
        return null;
    } finally {
        try {
            const filesToCleanup = fs.readdirSync("/tmp").filter(f => f.startsWith(`sub_${videoId}_${timestamp}`));
            filesToCleanup.forEach(f => fs.unlinkSync(path.join("/tmp", f)));
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
