require('dotenv').config({ path: '.env.local' });
const { createClient } = require('@supabase/supabase-js');
const { execSync } = require('child_process');
const fs = require('fs');
const path = require('path');
const os = require('os');

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!supabaseUrl || !supabaseKey) {
  console.error("Missing Supabase credentials in environment variables.");
  process.exit(1);
}

const supabase = createClient(supabaseUrl, supabaseKey);

const WORKER_INTERVAL_MS = process.env.WORKER_INTERVAL_MS ? parseInt(process.env.WORKER_INTERVAL_MS) : 5000;

function formatTimestamp(ms) {
    const totalSeconds = Math.floor(ms / 1000);
    const minutes = Math.floor(totalSeconds / 60);
    const seconds = totalSeconds % 60;
    return `${minutes.toString().padStart(2, '0')}:${seconds.toString().padStart(2, '0')}`;
}

async function processJob(job) {
    console.log(`[Worker] Processing job for video: ${job.video_id}`);
    
    // Mark as processing
    await supabase.from('jobs').update({ status: 'processing' }).eq('id', job.id);

    const videoId = job.video_id;
    const url = `https://www.youtube.com/watch?v=${videoId}`;
    const timestamp = Date.now();
    const tempDir = os.tmpdir();
    const tempBase = path.join(tempDir, `sub_${videoId}_${timestamp}`);

    try {
        console.log(`[Worker] Checking if subs exist for ${videoId}...`);
        try {
            const ytDlpCmd = fs.existsSync(path.join(__dirname, 'yt-dlp.exe')) 
                ? `"${path.join(__dirname, 'yt-dlp.exe')}"` 
                : 'yt-dlp';
            execSync(`${ytDlpCmd} --list-subs "${url}"`, { stdio: 'pipe' });
        } catch (e) {
            // It might fail if no subs exist or video is unavailable
            const stderr = e.stderr ? e.stderr.toString() : "";
            if (stderr.includes("has no subtitles")) {
                console.log(`[Worker] No subtitles available for ${videoId}`);
                await supabase.from('jobs').update({ status: 'failed' }).eq('id', job.id);
                return;
            }
        }

        console.log(`[Worker] Fetching subs for ${videoId}...`);
        
        const ytDlpCmd = fs.existsSync(path.join(__dirname, 'yt-dlp.exe')) 
            ? `"${path.join(__dirname, 'yt-dlp.exe')}"` 
            : 'yt-dlp';

        // Fetch JSON3 subs
        const args = [
            `--write-subs`,
            `--write-auto-subs`,
            `--sub-langs en,en-US,en-GB`,
            `--sub-format json3`,
            `--skip-download`,
            `--ignore-errors`,
            `--no-check-certificates`,
            `-o "${tempBase}"`,
            `"${url}"`
        ].join(" ");

        try {
            execSync(`${ytDlpCmd} ${args}`, { stdio: 'pipe' });
        } catch (e) {
            console.warn(`[Worker] yt-dlp threw an error, but file might still exist: ${e.message}`);
        }

        // Find the generated json3 file
        const matchingFiles = fs.readdirSync(tempDir).filter(f => f.startsWith(`sub_${videoId}_${timestamp}`) && f.endsWith(".json3"));
        
        if (matchingFiles.length === 0) {
            console.log(`[Worker] Failed to download subtitles for ${videoId}`);
            await supabase.from('jobs').update({ status: 'failed' }).eq('id', job.id);
            return;
        }

        let transcriptText = "";
        let parsedSuccessfully = false;

        for (const subFile of matchingFiles) {
            try {
                const subData = JSON.parse(fs.readFileSync(path.join(tempDir, subFile), 'utf8'));
                let currentTranscript = "";
        
                // Parse JSON3
                if (subData.events) {
                    for (const event of subData.events) {
                        if (event.segs && event.segs.length > 0) {
                            const text = event.segs.map(s => s.utf8).join("").replace(/\n/g, ' ').trim();
                            if (text && text !== '\n') {
                                currentTranscript += `${text} `;
                            }
                        }
                    }
                }

                if (currentTranscript.trim()) {
                    transcriptText = currentTranscript;
                    parsedSuccessfully = true;
                    break; // Found a valid transcript!
                }
            } catch (err) {
                console.warn(`[Worker] Failed to parse subtitle file ${subFile}: ${err.message}`);
            }
        }

        if (!parsedSuccessfully || !transcriptText.trim()) {
            throw new Error("Parsed transcript is empty.");
        }

        // Store in DB
        console.log(`[Worker] Storing transcript for ${videoId}...`);
        await supabase.from('transcripts').upsert({
            video_id: videoId,
            title: '', // Optionally we could fetch title with yt-dlp too
            language: 'en',
            transcript_text: transcriptText.trim()
        });

        // Mark as done
        await supabase.from('jobs').update({ status: 'done' }).eq('id', job.id);
        console.log(`[Worker] Successfully processed job for ${videoId}`);

        // Cleanup
        try {
            for (const file of matchingFiles) {
                fs.unlinkSync(path.join(tempDir, file));
            }
        } catch (e) {}

    } catch (e) {
        console.error(`[Worker] Error processing job for ${videoId}:`, e.message);
        await supabase.from('jobs').update({ status: 'failed' }).eq('id', job.id);
    }
}

async function loop() {
    console.log("[Worker] Checking for pending jobs...");
    const { data: jobs, error } = await supabase
        .from('jobs')
        .select('*')
        .eq('status', 'pending')
        .order('created_at', { ascending: true })
        .limit(1);

    if (error) {
        console.error("[Worker] Error fetching jobs:", error);
    } else if (jobs && jobs.length > 0) {
        const job = jobs[0];
        
        // Try to lock it. Racy but good enough for a single worker.
        // For multiple workers, use raw SQL with FOR UPDATE SKIP LOCKED.
        await processJob(job);
    }

    setTimeout(loop, WORKER_INTERVAL_MS);
}

// --- RENDER WEB SERVICE WORKAROUND ---
// Render requires Web Services to bind to a port, even if they are just background workers.
const http = require('http');
const port = process.env.PORT || 10000;
http.createServer((req, res) => {
    res.writeHead(200, { 'Content-Type': 'text/plain' });
    res.end('Worker is active\n');
}).listen(port, () => {
    console.log(`[Worker] Dummy web server listening on port ${port}`);
});
// -------------------------------------

console.log("[Worker] Starting Render worker...");
loop();
