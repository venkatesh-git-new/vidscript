import { NextResponse } from "next/server";
import { supabase } from "@/utils/supabase";

function extractVideoId(url: string): string | null {
    const regex = /(?:youtube\.com\/(?:[^\/]+\/.+\/|(?:v|e(?:mbed)?)\/|.*[?&]v=)|youtu\.be\/|youtube\.com\/shorts\/)([^"&?\/\s]{11})/i;
    const match = url.match(regex);
    return match ? match[1] : null;
}

export async function POST(req: Request) {
    try {
        const body = await req.json();
        const { url, turnstileToken } = body;
        
        if (!url) {
             return NextResponse.json({ error: "Missing YouTube URL" }, { status: 400 });
        }

        // 1. Validate Turnstile Token (if provided)
        if (process.env.NEXT_PUBLIC_TURNSTILE_SITE_KEY) {
             if (!turnstileToken) {
                 return NextResponse.json({ error: "CAPTCHA required" }, { status: 400 });
             }
             
             const verifyUrl = 'https://challenges.cloudflare.com/turnstile/v0/siteverify';
             const verifyRes = await fetch(verifyUrl, {
                 method: 'POST',
                 headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
                 body: `secret=${process.env.TURNSTILE_SECRET_KEY}&response=${turnstileToken}`
             });
             
             const verifyData = await verifyRes.json();
             if (!verifyData.success) {
                 return NextResponse.json({ error: "Invalid CAPTCHA" }, { status: 400 });
             }
        }

        const videoId = extractVideoId(url);
        if (!videoId) return NextResponse.json({ error: "Invalid YouTube URL" }, { status: 400 });

        if (!supabase) {
             return NextResponse.json({ error: "Supabase not configured." }, { status: 500 });
        }

        // 2. Check Cache
        const { data: cached, error: cacheError } = await supabase
            .from("transcripts")
            .select("transcript_text")
            .eq("video_id", videoId)
            .single();

        if (cached && cached.transcript_text) {
             return NextResponse.json({ transcript: cached.transcript_text, source: "cache", status: "done" });
        }

        // 3. Queue Job
        // Check if there is already a pending or processing job for this video
        const { data: existingJob, error: jobError } = await supabase
            .from("jobs")
            .select("*")
            .eq("video_id", videoId)
            .in('status', ['pending', 'processing'])
            .order('created_at', { ascending: false })
            .limit(1)
            .single();

        if (!existingJob) {
             const { error: insertError } = await supabase
                 .from("jobs")
                 .insert({ video_id: videoId, status: "pending" });
                 
             if (insertError) {
                 console.error("Failed to insert job", insertError);
                 return NextResponse.json({ error: "Failed to create transcription job" }, { status: 500 });
             }
        }

        // 4. Return processing state
        return NextResponse.json({ 
             message: "Transcript is being generated.", 
             status: "processing",
             videoId: videoId
        });

    } catch (error: any) {
        console.error("Transcribe API Error:", error);
        return NextResponse.json({ error: "Server Error" }, { status: 500 });
    }
}
