import path from "node:path";
import type { NextConfig } from "next";

const API_URL = process.env.API_URL ?? "http://localhost:4000";
const REALTIME_URL =
  process.env.NEXT_PUBLIC_REALTIME_URL ?? (process.env.NODE_ENV === "production" ? "" : API_URL);
/** Versions the service worker's caches: a new deploy never serves an old shell. */
const BUILD_ID = process.env.BUILD_ID ?? `${Date.now()}`;

/**
 * The technician PWA lives at /tech on the client's main domain: no extra DNS
 * or certificate, one sign-in shared with the dashboard, same-origin API.
 */
const config: NextConfig = {
  basePath: "/tech",
  reactStrictMode: true,
  transpilePackages: ["@opsdesk/ui"],
  output: process.env.NEXT_OUTPUT === "standalone" ? "standalone" : undefined,
  outputFileTracingRoot: path.join(__dirname, "../../"),
  generateBuildId: () => BUILD_ID,
  env: { NEXT_PUBLIC_REALTIME_URL: REALTIME_URL, NEXT_PUBLIC_BUILD_ID: BUILD_ID },
  // The API is outside /tech; in dev, proxy it (production: Caddy routes /api before Next).
  async rewrites() {
    return [{ source: "/api/:path*", destination: `${API_URL}/api/:path*`, basePath: false }];
  },
  async headers() {
    // The service worker must never be served stale, or users get stuck on an old version.
    return [{ source: "/sw.js", headers: [{ key: "Cache-Control", value: "no-cache" }] }];
  },
};

export default config;
