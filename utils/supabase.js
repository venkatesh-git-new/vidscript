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
        .select("transcript, source")
        .eq("video_id", videoId)
        .single();

    if (error || !data) return null;
    return { transcript: data.transcript, source: data.source || "unknown" };
}

/**
 * Saves a transcript to the database.
 * @param {string} videoId - The YouTube video ID.
 * @param {string} transcript - The full transcript text.
 * @param {string} title - Optional video title.
 */
export async function cacheTranscript(videoId, transcript, title = "", source = "caption") {
    if (!supabase) return;

    try {
        await supabase.from("transcripts").upsert({
            video_id: videoId,
            transcript: transcript,
            title: title,
            source: source,
            created_at: new Date().toISOString()
        });
    } catch (e) {
        console.warn("[Supabase] Caching failed (likely missing 'source' column):", e.message);
        // Fallback: try without source column if it hasn't been added to DB yet
        await supabase.from("transcripts").upsert({
            video_id: videoId,
            transcript: transcript,
            title: title,
            created_at: new Date().toISOString()
        });
    }
}
