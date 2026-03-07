import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  async rewrites() {
    const backendUrl = process.env.REMOTE_BACKEND_URL;
    if (backendUrl) {
      return {
        beforeFiles: [
          {
            source: "/api/transcribe",
            destination: `${backendUrl}/api/transcribe`,
          },
        ],
      };
    }
    return [];
  },
};

export default nextConfig;
