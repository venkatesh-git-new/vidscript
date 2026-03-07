import { NextResponse } from "next/server";
import { cacheTranscript } from "@/utils/supabase";

/**
 * POST /api/cache-transcript
 * Receives a transcript from the browser and stores it in Supabase.
 */
export async function POST(req: Request) {
    try {
        const { videoId, transcript } = await req.json();

        if (!videoId || !transcript) {
            return NextResponse.json({ status: "error", message: "Missing videoId or transcript" }, { status: 400 });
        }

        console.log(`[Cache API] Storing transcript for ${videoId}...`);
        // Note: title is optional here, default to empty
        await cacheTranscript(videoId, transcript, "", "browser_extracted");

        return NextResponse.json({ status: "success" });
    } catch (error: any) {
        console.error(`[Cache API] Error:`, error.message);
        return NextResponse.json({ status: "error", message: "Failed to cache transcript" }, { status: 500 });
    }
}
