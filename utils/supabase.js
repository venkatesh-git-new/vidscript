import { createClient } from "@supabase/supabase-js";

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

export const supabase = (supabaseUrl && supabaseKey)
    ? createClient(supabaseUrl, supabaseKey)
    : null;

/**
 * Checks if a transcript exists in the database.
 * @param {string} videoId - The YouTube video ID.
 * @returns {Promise<string|null>} - The transcript or null.
 */
export async function getCachedTranscript(videoId) {
    if (!supabase) return null;

    const { data, error } = await supabase
        .from("transcripts")
        .select("transcript")
        .eq("video_id", videoId)
        .single();

    if (error || !data) return null;
    return data.transcript;
}

/**
 * Saves a transcript to the database.
 * @param {string} videoId - The YouTube video ID.
 * @param {string} transcript - The full transcript text.
 * @param {string} title - Optional video title.
 */
export async function cacheTranscript(videoId, transcript, title = "") {
    if (!supabase) return;

    await supabase.from("transcripts").upsert({
        video_id: videoId,
        transcript: transcript,
        title: title,
        created_at: new Date().toISOString()
    });
}
