import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';

// A simple in-memory rate limiting implementation for Edge.
// Note: This resets on cold-starts or scales differently per isolate.
// For production, consider using Redis (e.g. @upstash/ratelimit) or Supabase.
const rateLimitMap = new Map<string, { count: number; timestamp: number }>();

const RATE_LIMIT_COUNT = 10;
const RATE_LIMIT_WINDOW_MS = 60 * 1000; // 1 minute

export function middleware(request: NextRequest) {
  // Only apply to the transcribe API
  if (request.nextUrl.pathname === '/api/transcribe') {
    const ip = request.ip || request.headers.get('x-forwarded-for') || '127.0.0.1';
    
    const now = Date.now();
    const rateLimitInfo = rateLimitMap.get(ip);
    
    if (rateLimitInfo) {
      if (now - rateLimitInfo.timestamp < RATE_LIMIT_WINDOW_MS) {
        if (rateLimitInfo.count >= RATE_LIMIT_COUNT) {
          return NextResponse.json(
            { error: 'Rate limit exceeded. Try again later.' },
            { status: 429 } // Too Many Requests
          );
        }
        rateLimitInfo.count++;
      } else {
        // Reset the window
        rateLimitMap.set(ip, { count: 1, timestamp: now });
      }
    } else {
      rateLimitMap.set(ip, { count: 1, timestamp: now });
    }
  }

  // Continue request
  return NextResponse.next();
}

export const config = {
  matcher: '/api/transcribe',
};
