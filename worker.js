require('dotenv').config({ path: '.env.local' });
const { createClient } = require('@supabase/supabase-js');
const { execSync } = require('child_process');
const fs = require('fs');
const path = require('path');
const os = require('os');
const { YoutubeTranscript } = require('youtube-transcript');

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
    console.log(`[Worker] Started job for video: ${job.video_id}`);
    
    // Mark as processing
    await supabase.from('jobs').update({ status: 'processing' }).eq('id', job.id);

    const videoId = job.video_id;
    const url = `https://www.youtube.com/watch?v=${videoId}`;
    const timestamp = Date.now();
    const tempDir = os.tmpdir();
    const tempBase = path.join(tempDir, `sub_${videoId}_${timestamp}`);

    const timeoutPromise = new Promise((_, reject) => 
        setTimeout(() => reject(new Error("Timeout: Extraction took over 60 seconds")), 60000)
    );

    const extractionPromise = async () => {
        let transcriptText = "";
        let sourceUsed = "";

        // Method 1: youtube-transcript
        console.log(`[Worker] Attempting extraction with youtube-transcript for ${videoId}...`);
        try {
            const transcriptItems = await YoutubeTranscript.fetchTranscript(videoId);
            if (transcriptItems && transcriptItems.length > 0) {
                transcriptText = transcriptItems.map(item => item.text).join(" ").replace(/\n/g, ' ').trim();
                sourceUsed = "youtube-transcript";
                console.log(`[Worker] Extraction success using youtube-transcript for ${videoId}`);
            }
        } catch (ytErr) {
            console.log(`[Worker] Extraction failure using youtube-transcript: ${ytErr.message}`);
        }

        // Method 2: yt-dlp fallback
        if (!transcriptText) {
            console.log(`[Worker] Attempting extraction with yt-dlp for ${videoId}...`);
            try {
                const ytDlpCmd = fs.existsSync(path.join(__dirname, 'yt-dlp.exe')) 
                    ? `"${path.join(__dirname, 'yt-dlp.exe')}"` 
                    : 'yt-dlp';

                // Check subs first
                try {
                    execSync(`${ytDlpCmd} --list-subs "${url}"`, { stdio: 'pipe' });
                } catch (e) {
                    const stderr = e.stderr ? e.stderr.toString() : "";
                    if (stderr.includes("has no subtitles")) {
                        throw new Error("No subtitles available according to yt-dlp");
                    }
                }

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

                execSync(`${ytDlpCmd} ${args}`, { stdio: 'pipe' });

                const matchingFiles = fs.readdirSync(tempDir).filter(f => f.startsWith(`sub_${videoId}_${timestamp}`) && f.endsWith(".json3"));
                
                if (matchingFiles.length > 0) {
                    for (const subFile of matchingFiles) {
                        try {
                            const subData = JSON.parse(fs.readFileSync(path.join(tempDir, subFile), 'utf8'));
                            let currentTranscript = "";
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
                                sourceUsed = "yt-dlp";
                                console.log(`[Worker] Extraction success using yt-dlp for ${videoId}`);
                                break;
                            }
                        } catch (err) {
                            console.warn(`[Worker] Failed to parse subtitle file ${subFile}: ${err.message}`);
                        }
                    }
                }

                // Cleanup
                try {
                    for (const file of matchingFiles) fs.unlinkSync(path.join(tempDir, file));
                } catch (e) {}
            } catch (ytDlpErr) {
                console.log(`[Worker] Extraction failure using yt-dlp: ${ytDlpErr.message}`);
            }
        }

        if (!transcriptText || !transcriptText.trim()) {
            throw new Error("All extraction methods failed or parsed transcript is empty.");
        }

        return { transcriptText, sourceUsed };
    };

    try {
        const result = await Promise.race([extractionPromise(), timeoutPromise]);
        
        // Store in DB
        console.log(`[Worker] Storing transcript for ${videoId}...`);
        await supabase.from('transcripts').upsert({
            video_id: videoId,
            title: '',
            language: 'en',
            transcript: result.transcriptText.trim(),
            source: result.sourceUsed
        });

        // Mark as done
        await supabase.from('jobs').update({ status: 'completed' }).eq('id', job.id);
        console.log(`[Worker] Successfully processed job for ${videoId}`);

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
