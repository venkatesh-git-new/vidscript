"use client";

import { useState, useEffect, useRef } from "react";
import { Copy, Download, Loader2, Youtube, FileText, Check, AlertCircle } from "lucide-react";
import AdBanner from "@/components/AdBanner";
import Script from "next/script"; // Assuming Turnstile via script tag

import { extractVideoId, getCaptionTracks, selectBestTrack, downloadTranscript } from "@/utils/youtube-browser";

export default function Home() {
  const [url, setUrl] = useState("");
  const [transcript, setTranscript] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const [processingStatus, setProcessingStatus] = useState("");
  const [error, setError] = useState("");
  const [copied, setCopied] = useState(false);
  const [turnstileToken, setTurnstileToken] = useState("");
  
  // Ref for polling interval to prevent memory leaks
  const pollingIntervalRef = useRef<NodeJS.Timeout | null>(null);

  useEffect(() => {
    // Expose turnstile callback for global window usage
    (window as any).onTurnstileSuccess = (token: string) => {
      setTurnstileToken(token);
    };

    return () => {
       if (pollingIntervalRef.current) clearInterval(pollingIntervalRef.current);
    }
  }, []);

  /**
   * Browser-Side Transcription Flow
   */
  const handleTranscribe = async () => {
    if (!url) return;
    
    // Check if CAPTCHA is configured and token is required
    const siteKey = process.env.NEXT_PUBLIC_TURNSTILE_SITE_KEY;
    if (siteKey && !turnstileToken) {
       setError("Please complete the CAPTCHA.");
       return;
    }

    setIsLoading(true);
    setError("");
    setTranscript("");
    setProcessingStatus("Initializing request...");

    try {
      const response = await fetch("/api/transcribe", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ url, turnstileToken }),
      });

      const data = await response.json();

      if (!response.ok) {
        throw new Error(data.error || "Failed to fetch transcript");
      }

      if (data.status === "done") {
         setTranscript(data.transcript);
         setIsLoading(false);
         setProcessingStatus("");
      } else if (data.status === "processing" && data.videoId) {
         setProcessingStatus(data.message || "Generating transcript...");
         startPolling(data.videoId);
      }
    } catch (err: any) {
      setError(err.message);
      setIsLoading(false);
      setProcessingStatus("");
    }
  };

  const startPolling = (videoId: string) => {
      if (pollingIntervalRef.current) clearInterval(pollingIntervalRef.current);

      pollingIntervalRef.current = setInterval(async () => {
         try {
             const res = await fetch(`/api/job/${videoId}`);
             const data = await res.json();

             if (data.status === 'done') {
                if (pollingIntervalRef.current) clearInterval(pollingIntervalRef.current);
                const resp = await fetch("/api/transcribe", { // call again to get from cache
                     method: "POST",
                     headers: { "Content-Type": "application/json" },
                     body: JSON.stringify({ url }), // Don't need token if we get from cache ideally, but simplify caching logic in proxy
                });
                
                // Let's just use the job endpoint to return text directly, wait, I updated `/api/job/[videoId]` to return `transcript`!
                if(data.transcript) {
                     setTranscript(data.transcript);
                }
                
                setIsLoading(false);
                setProcessingStatus("");
             } else if (data.status === 'failed') {
                if (pollingIntervalRef.current) clearInterval(pollingIntervalRef.current);
                setError(data.error || "Failed to extract transcript.");
                setIsLoading(false);
                setProcessingStatus("");
             } else {
                setProcessingStatus("Still processing... This may take up to a minute.");
             }
         } catch(err) {
             // Let it retry next time
             console.error("Polling error", err);
         }
      }, 5000); // Poll every 5 seconds
  };

  const handleCopy = () => {
    navigator.clipboard.writeText(transcript);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const handleDownload = () => {
    const blob = new Blob([transcript], { type: "text/plain" });
    const localUrl = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = localUrl;
    a.download = "transcript.txt";
    a.click();
    URL.revokeObjectURL(localUrl);
  };

  const siteKey = process.env.NEXT_PUBLIC_TURNSTILE_SITE_KEY;

  return (
    <main className="min-h-screen bg-[#020202] text-white flex flex-col items-center px-4 py-8 selection:bg-red-500/30">
      <Script src="https://challenges.cloudflare.com/turnstile/v0/api.js" async defer></Script>
      {/* Background Glow */}
      <div className="fixed top-0 left-1/2 -translate-x-1/2 w-full max-w-6xl aspect-square bg-red-600/10 blur-[120px] -z-10 rounded-full" />

      {/* Header Branding */}
      <div className="w-full max-w-6xl flex justify-start mb-16 animate-in fade-in slide-in-from-top-4 duration-1000">
        <div className="flex items-center gap-2 group cursor-pointer transition-all duration-300">
          <div className="w-10 h-10 bg-red-600 rounded-xl flex items-center justify-center shadow-lg shadow-red-600/20 group-hover:scale-110 transition-transform">
            <Youtube className="w-6 h-6 text-white" />
          </div>
          <span className="text-2xl font-bold tracking-tighter">
            Vid<span className="text-red-600/90">Script</span>
          </span>
        </div>
      </div>

      {/* Hero Section */}
      <div className="w-full max-w-3xl text-center space-y-6 mb-12 animate-in fade-in slide-in-from-bottom-4 duration-1000">
        <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-white/5 border border-white/10 text-sm font-medium text-white/60 mb-4 tracking-tight">
          <Youtube className="w-4 h-4 text-red-500" />
          <span>YouTube Transcript Generator</span>
        </div>
        <h1 className="text-5xl md:text-7xl font-bold tracking-tighter">
          Any Video. <span className="gradient-text">Instant Text.</span>
        </h1>
        <p className="text-lg text-white/50 max-w-2xl mx-auto leading-relaxed">
          Extract high-quality transcripts from any YouTube video in seconds.
          Save time, searchable content, and better accessibility.
        </p>
      </div>

      {/* Input Area */}
      <div className="w-full max-w-2xl space-y-4 mb-8 animate-in fade-in slide-in-from-bottom-6 duration-1000 delay-200">
        <div className="relative group flex flex-col items-center gap-4">
          <div className="w-full relative">
              <input
                type="text"
                placeholder="Paste YouTube URL here..."
                className="w-full h-16 bg-white/5 border border-white/10 rounded-2xl px-6 outline-none focus:ring-2 focus:ring-red-500/50 focus:border-red-500/50 transition-all text-lg group-hover:border-white/20"
                value={url}
                onChange={(e) => setUrl(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && handleTranscribe()}
              />
              <button
                onClick={handleTranscribe}
                disabled={isLoading || !url}
                className="absolute right-2 top-2 h-12 px-8 bg-red-600 hover:bg-red-500 disabled:opacity-50 disabled:hover:bg-red-600 font-semibold rounded-xl transition-all active:scale-95 flex items-center gap-2 overflow-hidden shadow-lg shadow-red-600/20"
              >
                {isLoading ? (
                  <Loader2 className="w-5 h-5 animate-spin" />
                ) : (
                  <>
                    <span>Transcribe</span>
                    <Youtube className="w-5 h-5" />
                  </>
                )}
              </button>
          </div>

          {siteKey && (
              <div 
                  className="cf-turnstile" 
                  data-sitekey={siteKey}
                  data-theme="dark"
                  data-callback="onTurnstileSuccess"
              ></div>
          )}

          {isLoading && processingStatus && (
              <p className="text-sm text-red-400 animate-pulse">{processingStatus}</p>
          )}

        </div>

        {error && (
          <div className="flex items-center gap-2 p-4 rounded-xl bg-red-500/10 border border-red-500/20 text-red-400 animate-in fade-in zoom-in duration-300">
            <AlertCircle className="w-5 h-5 flex-shrink-0" />
            <p className="text-sm font-medium">{error}</p>
          </div>
        )}
      </div>

      {/* Main Content Area with Ads */}
      <div className="w-full max-w-6xl flex flex-col md:flex-row gap-8 items-start">
        <div className="flex-1 w-full space-y-8">
          {/* Top Ad Unit */}
          <div className="w-full min-h-[100px] glass rounded-xl overflow-hidden flex items-center justify-center border-dashed border-white/5">
            <AdBanner dataAdSlot="TOP_AD_SLOT_ID" className="w-full" />
          </div>

          {/* Transcript Display */}
          {transcript && transcript.length > 0 && (
            <div className="w-full glass rounded-3xl overflow-hidden glow animate-in fade-in slide-in-from-bottom-10 duration-1000">
              <div className="px-8 py-6 flex items-center justify-between border-b border-white/10 bg-white/[0.02]">
                <div className="flex items-center gap-3">
                  <div className="w-10 h-10 rounded-xl bg-red-500/10 flex items-center justify-center border border-red-500/20">
                    <FileText className="w-5 h-5 text-red-500" />
                  </div>
                  <div>
                    <h3 className="font-semibold text-lg">Transcript</h3>
                    <p className="text-xs text-white/40 uppercase tracking-widest font-bold">Extracted successfully</p>
                  </div>
                </div>
                <div className="flex gap-2">
                  <button
                    onClick={handleCopy}
                    className="p-3 hover:bg-white/5 rounded-xl transition-all active:scale-90 border border-white/5"
                    title="Copy to clipboard"
                  >
                    {copied ? <Check className="w-5 h-5 text-green-500" /> : <Copy className="w-5 h-5 text-white/70" />}
                  </button>
                  <button
                    onClick={handleDownload}
                    className="p-3 hover:bg-white/5 rounded-xl transition-all active:scale-90 border border-white/5"
                    title="Download as .txt"
                  >
                    <Download className="w-5 h-5 text-white/70" />
                  </button>
                </div>
              </div>
              <div className="p-8 max-h-[600px] overflow-y-auto scrollbar-thin scrollbar-thumb-white/10 scrollbar-track-transparent">
                <p className="text-lg leading-relaxed text-white/80 whitespace-pre-wrap selection:bg-red-500/40">
                  {transcript}
                </p>
              </div>
            </div>
          )}

          {/* Bottom Ad Unit */}
          <div className="w-full min-h-[100px] glass rounded-xl overflow-hidden flex items-center justify-center border-dashed border-white/5">
            <AdBanner dataAdSlot="BOTTOM_AD_SLOT_ID" className="w-full" />
          </div>

          {/* Features / Empty State */}
          {!transcript && !isLoading && (
            <div className="grid grid-cols-1 md:grid-cols-3 gap-6 w-full animate-in fade-in slide-in-from-bottom-8 duration-1000 delay-500">
              {[
                { title: "SEO Optimized", desc: "Perfect for blog posts and social media content." },
                { title: "Privacy First", desc: "Transcripts are processed and served instantly." },
                { title: "Fast & Reliable", desc: "Powered by modern Next.js and high-speed APIs." }
              ].map((feature, i) => (
                <div key={i} className="p-6 rounded-2xl bg-white/[0.03] border border-white/5 hover:border-white/10 transition-all hover:bg-white/[0.05] group">
                  <h4 className="font-semibold mb-2 group-hover:text-red-400 transition-colors">{feature.title}</h4>
                  <p className="text-sm text-white/40 leading-relaxed">{feature.desc}</p>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Sidebar Ad Unit */}
        <aside className="w-full md:w-80 shrink-0 space-y-6 hidden md:block">
          <div className="w-full min-h-[600px] glass rounded-3xl overflow-hidden flex items-center justify-center border-dashed border-white/5">
            <AdBanner dataAdSlot="SIDEBAR_AD_SLOT_ID" dataAdFormat="vertical" className="w-full h-full" />
          </div>
        </aside>
      </div>
    </main>
  );
}
