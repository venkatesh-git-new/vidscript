import { NextResponse } from "next/server";
import { supabase } from "@/utils/supabase";

export async function POST(req: Request) {
    try {
        const body = await req.json();
        const { videoId, transcript, source } = body;
        
        if (!videoId || !transcript || !source) {
             return NextResponse.json({ error: "Missing required fields" }, { status: 400 });
        }

        if (!supabase) {
             return NextResponse.json({ error: "Supabase not configured." }, { status: 500 });
        }

        // 1. Save transcript to database
        const { error: upsertError } = await supabase
            .from("transcripts")
            .upsert({
                video_id: videoId,
                title: '',
                language: 'en',
                transcript: transcript,
                source: source
            });

        if (upsertError) {
             console.error("Failed to save transcript", upsertError);
             return NextResponse.json({ error: "Failed to save transcript" }, { status: 500 });
        }

        // 2. Mark job as completed
        const { error: updateError } = await supabase
            .from("jobs")
            .update({ status: "completed" })
            .eq("video_id", videoId)
            // .in('status', ['pending', 'processing']) // Optional: Only update if pending or processing
            
        if (updateError) {
            console.error("Failed to update job status", updateError);
            // Non-fatal, transcript is already saved
        }

        return NextResponse.json({ success: true, status: "completed" });

    } catch (error: any) {
        console.error("Save Transcript API Error:", error);
        return NextResponse.json({ error: "Server Error" }, { status: 500 });
    }
}
