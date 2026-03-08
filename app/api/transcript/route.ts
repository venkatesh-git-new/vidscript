import { NextResponse } from "next/server";
import { getCachedTranscript, cacheTranscript } from "@/utils/supabase";

/**
 * GET /api/transcript?videoId=VIDEO_ID
 * Checks if a transcript exists in the Supabase cache.
 */
export async function GET(req: Request) {
    try {
        const { searchParams } = new URL(req.url);
        const videoId = searchParams.get("videoId");

        if (!videoId) {
            return NextResponse.json({ error: "videoId is required" }, { status: 400 });
        }

        const cached = await getCachedTranscript(videoId);

        if (cached) {
            console.log(`[Transcript API] Cache hit for ${videoId}`);
            return NextResponse.json({ transcript: cached, source: "cache" });
        }

        return NextResponse.json({ transcript: null, source: "miss" });
    } catch (error: any) {
        console.error(`[Transcript API] GET error: ${error.message}`);
        return NextResponse.json({ error: "Internal Server Error" }, { status: 500 });
    }
}

/**
 * POST /api/transcript
 * Stores a new transcript in the Supabase cache.
 */
export async function POST(req: Request) {
    try {
        const { videoId, transcript, title } = await req.json();

        if (!videoId || !transcript) {
            return NextResponse.json({ error: "videoId and transcript are required" }, { status: 400 });
        }

        console.log(`[Transcript API] Caching transcript for ${videoId}`);
        await cacheTranscript(videoId, transcript, title || "");

        return NextResponse.json({ success: true });
    } catch (error: any) {
        console.error(`[Transcript API] POST error: ${error.message}`);
        return NextResponse.json({ error: "Internal Server Error" }, { status: 500 });
    }
}
