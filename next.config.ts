import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  async rewrites() {
    // Only rewrite if REMOTE_BACKEND_URL is set (e.g., on Vercel)
    const backendUrl = process.env.REMOTE_BACKEND_URL;
    if (backendUrl) {
      return [
        {
          source: "/api/transcribe",
          destination: `${backendUrl}/api/transcribe`,
        },
      ];
    }
    return [];
  },
};

export default nextConfig;
