import type { NextConfig } from "next";

/**
 * Security headers applied to every route. The CSP is permissive on
 * script/style ('unsafe-inline') because this app has no per-request nonce
 * wiring; it still blocks framing, restricts connections, and locks
 * base-uri/object-src. AI chat (Rev) and resume analysis are proxied
 * server-side, so connect-src 'self' already covers them; Supabase is
 * allowed for any future client-side reads.
 */
// Vercel PREVIEW builds inject a Live feedback/comment toolbar from
// vercel.live (+ pusher websockets); allow it there ONLY. Production on
// Vercel AND any non-Vercel host (e.g. GCP Cloud Run, where VERCEL_ENV is
// unset) stay locked to self + Supabase. Keyed off an explicit preview
// signal rather than "not production" so the CSP cannot silently loosen
// on a platform that doesn't set VERCEL_ENV.
const isVercelPreview =
  !!process.env.VERCEL_ENV && process.env.VERCEL_ENV !== "production";

const scriptSrc = ["'self'", "'unsafe-inline'", "'unsafe-eval'"];
const connectSrc = ["'self'", "https://*.supabase.co"];
const frameSrc = ["'self'"];
if (isVercelPreview) {
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
  // Emit a self-contained server bundle (.next/standalone) so the Docker
  // image can run `node server.js` without the full node_modules tree.
  // Harmless on Vercel (ignored there); required for Cloud Run.
  output: "standalone",
  poweredByHeader: false,
  async headers() {
    return [{ source: "/:path*", headers: securityHeaders }];
  },
};

export default nextConfig;
