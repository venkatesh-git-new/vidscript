import { NextResponse } from "next/server";
import { getCachedTranscript, cacheTranscript } from "@/utils/supabase";
import { exec } from "child_process";
import { promisify } from "util";
import fs from "fs";
import path from "path";
import os from "os";
import OpenAI from "openai";

const execPromise = promisify(exec);
const activeJobs = new Map<string, Promise<any>>();

/**
 * Lazy OpenAI client initialization
 */
let openai_client: OpenAI | null = null;
function getOpenAIClient() {
    if (!openai_client) {
        if (!process.env.OPENAI_API_KEY) {
            throw new Error("OPENAI_API_KEY is not set");
        }
        openai_client = new OpenAI({
            apiKey: process.env.OPENAI_API_KEY,
        });
    }
    return openai_client;
}

/**
 * Robust Video ID extraction and normalization
 */
function extractVideoId(url: string): string | null {
    const regex = /(?:youtube\.com\/(?:[^\/]+\/.+\/|(?:v|e(?:mbed)?)\/|.*[?&]v=)|youtu\.be\/|youtube\.com\/shorts\/)([^"&?\/\s]{11})/i;
    const match = url.match(regex);
    return match ? match[1] : null;
}

/**
 * Parses VTT content into clean plain text
 * Removes timestamps, metadata, and duplicate lines
 */
function parseVtt(vttContent: string): string {
    const lines = vttContent.split('\n');
    const cleanLines: string[] = [];
    let lastLine = "";

    for (let line of lines) {
        line = line.trim();

        // Skip metadata and timestamps
        if (!line ||
            line === "WEBVTT" ||
            line.startsWith("Kind:") ||
            line.startsWith("Language:") ||
            line.includes("-->")) {
            continue;
        }

        // Remove HTML-like tags (common in auto-captions)
        const text = line.replace(/<[^>]+>/g, "").trim();

        if (text && text !== lastLine) {
            cleanLines.push(text);
            lastLine = text;
        }
    }

    return cleanLines.join(" ").replace(/\s+/g, " ").trim();
}

/**
 * Helper to handle YouTube cookies from environment variable
 */
function getCookiesFlag(): { flag: string; cleanup: () => void } {
    const cookiesBase64 = process.env.YOUTUBE_COOKIES_BASE64;
    if (!cookiesBase64) return { flag: "", cleanup: () => { } };

    try {
        const tempDir = os.tmpdir();
        const cookiePath = path.join(tempDir, `cookies_${Math.random().toString(36).slice(2)}.txt`);
        const cookiesText = Buffer.from(cookiesBase64, "base64").toString("utf-8");
        fs.writeFileSync(cookiePath, cookiesText);

        return {
            flag: `--cookies "${cookiePath}"`,
            cleanup: () => {
                if (fs.existsSync(cookiePath)) fs.unlinkSync(cookiePath);
            }
        };
    } catch (e) {
        console.error("[Cookies] Failed to decode YOUTUBE_COOKIES_BASE64:", e);
        return { flag: "", cleanup: () => { } };
    }
}

/**
 * Uses yt-dlp to extract subtitles as VTT
 */
async function extractSubtitlesWithYtDlp(videoId: string): Promise<string | null> {
    const tempDir = os.tmpdir();
    const outputPath = path.join(tempDir, videoId);
    const videoUrl = `https://www.youtube.com/watch?v=${videoId}`;
    const { flag: cookiesFlag, cleanup: cleanupCookies } = getCookiesFlag();

    try {
        console.log(`[yt-dlp] Attempting to download subtitles for ${videoId}...`);

        // yt-dlp --skip-download --write-sub --write-auto-sub --sub-lang en --sub-format vtt --output "/tmp/VIDEO_ID"
        await execPromise(`yt-dlp ${cookiesFlag} --skip-download --write-sub --write-auto-sub --sub-lang en --sub-format vtt --output "${outputPath}" "${videoUrl}"`);

        // Check for manual or auto VTT files
        const files = fs.readdirSync(tempDir);
        const vttFile = files.find(f => f.startsWith(videoId) && f.endsWith(".vtt"));

        if (vttFile) {
            const fullPath = path.join(tempDir, vttFile);
            const content = fs.readFileSync(fullPath, "utf-8");
            const transcript = parseVtt(content);

            // Cleanup
            fs.unlinkSync(fullPath);
            return transcript;
        }

        return null;
    } catch (e: any) {
        console.error(`[yt-dlp] Error for ${videoId}:`, e.message);
        if (e.message.includes("bot") || e.message.includes("403") || e.message.includes("Sign in")) {
            throw new Error("YouTube is blocking this server. Please add YOUTUBE_COOKIES_BASE64 to your Env variables.");
        }
        return null;
    } finally {
        cleanupCookies();
    }
}

/**
 * AI Fallback: Download audio and transcribe via Whisper
 */
async function transcribeWithAI(videoId: string): Promise<string> {
    const tempDir = os.tmpdir();
    const audioPath = path.join(tempDir, `audio_${videoId}.m4a`);
    const videoUrl = `https://www.youtube.com/watch?v=${videoId}`;
    const { flag: cookiesFlag, cleanup: cleanupCookies } = getCookiesFlag();

    try {
        console.log(`[AI] Downloading audio for ${videoId}...`);
        await execPromise(`yt-dlp ${cookiesFlag} -f 'ba[ext=m4a]/ba' -o "${audioPath}" "${videoUrl}"`);

        if (!fs.existsSync(audioPath)) {
            throw new Error("Audio download failed");
        }

        console.log(`[AI] Transcribing with Whisper for ${videoId}...`);
        const openai = getOpenAIClient();
        const transcription = await openai.audio.transcriptions.create({
            file: fs.createReadStream(audioPath),
            model: "whisper-1",
            language: "en"
        });

        return transcription.text;
    } catch (e: any) {
        if (e.message.includes("bot") || e.message.includes("403") || e.message.includes("Sign in")) {
            throw new Error("YouTube is blocking this server. Please add YOUTUBE_COOKIES_BASE64 to your Env variables.");
        }
        throw e;
    } finally {
        cleanupCookies();
        if (fs.existsSync(audioPath)) {
            fs.unlinkSync(audioPath);
        }
    }
}

export async function POST(req: Request) {
    try {
        const { url } = await req.json();
        const videoId = extractVideoId(url);

        if (!videoId) {
            return NextResponse.json({ status: "error", message: "Invalid YouTube URL" }, { status: 400 });
        }

        // 1. Check Cache
        console.log(`[Transcribe API] Checking cache for ${videoId}...`);
        const cached = await getCachedTranscript(videoId) as { transcript: string; source: string } | null;
        if (cached) {
            console.log(`[Transcribe API] Cache hit for ${videoId}`);
            return NextResponse.json({
                status: "success",
                source: cached.source || "cache",
                transcript: cached.transcript
            });
        }

        // 2. Concurrency Check
        if (activeJobs.has(videoId)) {
            return NextResponse.json({
                status: "pending",
                message: "Transcription is already in progress. Please wait a moment."
            });
        }

        // Start processing job
        const processJob = (async () => {
            try {
                // 3. Attempt yt-dlp Subtitle Extraction
                const transcript = await extractSubtitlesWithYtDlp(videoId);

                if (transcript && transcript.length > 50) {
                    console.log(`[Transcribe API] Subtitles extracted successfully for ${videoId}`);
                    await cacheTranscript(videoId, transcript, "", "caption");
                    return { status: "success", source: "caption", transcript };
                }

                // 4. AI Fallback
                console.log(`[Transcribe API] Subtitles unavailable, falling back to AI for ${videoId}...`);
                const aiTranscript = await transcribeWithAI(videoId);
                await cacheTranscript(videoId, aiTranscript, "", "ai");
                return { status: "success", source: "ai", transcript: aiTranscript };

            } catch (error: any) {
                console.error(`[Pipeline] Failed for ${videoId}:`, error.message);
                throw error;
            } finally {
                activeJobs.delete(videoId);
            }
        })();

        activeJobs.set(videoId, processJob);

        const result = await Promise.race([
            processJob,
            new Promise((_, reject) => setTimeout(() => reject(new Error("timeout")), 25000))
        ]).catch(err => {
            if (err.message === "timeout") return { status: "pending", message: "Transcription is taking longer than expected. We are continuing in the background." };
            throw err;
        });

        return NextResponse.json(result);

    } catch (error: any) {
        console.error(`[Transcribe API] Error:`, error.message);
        return NextResponse.json({
            status: "error",
            message: error.message || "Internal Server Error"
        }, { status: 500 });
    }
}
