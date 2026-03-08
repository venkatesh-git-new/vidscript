// app/api/job/[videoId]/route.ts
import { NextResponse } from "next/server";
import { supabase } from "@/utils/supabase";

export async function GET(req: Request, { params }: { params: Promise<{ videoId: string }> }) {
  const { videoId } = await params;

  if (!supabase) {
    return NextResponse.json({ error: "Supabase not configured." }, { status: 500 });
  }

  try {
    // 1. Check if the transcript is already done and available
    const { data: transcriptData, error: transcriptError } = await supabase
      .from("transcripts")
      .select("transcript_text")
      .eq("video_id", videoId)
      .single();

    if (transcriptData && transcriptData.transcript_text) {
      return NextResponse.json({
        status: "done",
        transcript: transcriptData.transcript_text
      });
    }

    // 2. Check the job status
    const { data: jobData, error: jobError } = await supabase
      .from("jobs")
      .select("status")
      .eq("video_id", videoId)
      .order("created_at", { ascending: false })
      .limit(1)
      .single();

    if (jobData) {
      if (jobData.status === "failed") {
        return NextResponse.json({ status: "failed", error: "Job failed: No captions available." });
      }
      return NextResponse.json({ status: jobData.status });
    }

    return NextResponse.json({ status: "not_found", error: "Job not found." }, { status: 404 });
  } catch (error: any) {
    console.error("Job API Error:", error);
    return NextResponse.json({ error: "Server error querying job status." }, { status: 500 });
  }
}
