import type { NextConfig } from "next";

/**
 * Security headers applied to every route. The CSP is permissive on
 * script/style ('unsafe-inline') because this app has no per-request nonce
 * wiring; it still blocks framing, restricts connections, and locks
 * base-uri/object-src. AI chat (Rev) and resume analysis are proxied
 * server-side, so connect-src 'self' already covers them; Supabase is
 * allowed for any future client-side reads.
 */
// On non-production builds Vercel injects its Live feedback/comment toolbar
// from vercel.live (+ pusher websockets); allow it there only, so Production
// stays locked to self + Supabase.
const isProd = process.env.VERCEL_ENV === "production";

const scriptSrc = ["'self'", "'unsafe-inline'", "'unsafe-eval'"];
const connectSrc = ["'self'", "https://*.supabase.co"];
const frameSrc = ["'self'"];
if (!isProd) {
  scriptSrc.push("https://vercel.live");
  connectSrc.push("https://vercel.live", "https://*.pusher.com", "wss://*.pusher.com");
  frameSrc.push("https://vercel.live");
}

const ContentSecurityPolicy = [
  "default-src 'self'",
  `script-src ${scriptSrc.join(" ")}`,
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data: https:",
  "font-src 'self' data:",
  `connect-src ${connectSrc.join(" ")}`,
  `frame-src ${frameSrc.join(" ")}`,
  "object-src 'none'",
  "base-uri 'self'",
  "frame-ancestors 'none'",
].join("; ");

const securityHeaders = [
  { key: "Content-Security-Policy", value: ContentSecurityPolicy },
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "X-Frame-Options", value: "DENY" },
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=()" },
  { key: "Strict-Transport-Security", value: "max-age=63072000; includeSubDomains; preload" },
];

const nextConfig: NextConfig = {
  poweredByHeader: false,
  async headers() {
    return [{ source: "/:path*", headers: securityHeaders }];
  },
};

export default nextConfig;
