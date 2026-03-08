import type { Metadata } from "next";
import { Inter } from "next/font/google";
import "./globals.css";

const inter = Inter({ subsets: ["latin"] });

export const metadata: Metadata = {
  title: "VidScript - YouTube Transcript Generator",
  description: "Extract high-quality transcripts from any YouTube video in seconds. Perfect for blog posts, summaries, and accessibility. Fast and free.",
  keywords: ["youtube transcript", "video to text", "youtube summary", "content creation", "seo tools"],
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" className="dark">
      <head>
        <script
          async
          src={`https://pagead2.googlesyndication.com/pagead/js/adsbygoogle.js?client=${process.env.NEXT_PUBLIC_ADSENSE_CLIENT_ID}`}
          crossOrigin="anonymous"
        />
      </head>
      <body suppressHydrationWarning className={`${inter.className} antialiased bg-[#020202]`}>
        {children}
      </body>
    </html>
  );
}

