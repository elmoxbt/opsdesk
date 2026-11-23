import { existsSync } from "node:fs";
import path from "node:path";
import type { NextConfig } from "next";

// Local dev convenience (same as the API): read the monorepo root .env, e.g. DEMO_LOGINS and
// CLIENT_* overrides. Variables already set in the environment always win; deployments set them directly.
const rootEnv = path.join(__dirname, "../../.env");
if (process.env.NODE_ENV !== "production" && existsSync(rootEnv)) process.loadEnvFile(rootEnv);

const API_URL = process.env.API_URL ?? "http://localhost:4000";
/**
 * Socket.IO endpoint. In production, Caddy routes /socket.io to the API on the
 * same origin, so this stays empty. In dev, Next rewrites don't proxy WebSocket
 * upgrades, so the browser connects to the API port directly.
 */
const REALTIME_URL =
  process.env.NEXT_PUBLIC_REALTIME_URL ?? (process.env.NODE_ENV === "production" ? "" : API_URL);

const config: NextConfig = {
  reactStrictMode: true,
  // The design system ships as TypeScript source; Next compiles it with the app.
  transpilePackages: ["@opsdesk/ui"],
  // Docker builds set NEXT_OUTPUT=standalone for a small self-contained server.
  // Local builds skip it (standalone tracing uses symlinks, which Windows dislikes).
  output: process.env.NEXT_OUTPUT === "standalone" ? "standalone" : undefined,
  // Monorepo: trace workspace packages (shared, config, client-config) into the standalone bundle.
  outputFileTracingRoot: path.join(__dirname, "../../"),
  env: { NEXT_PUBLIC_REALTIME_URL: REALTIME_URL },
  images: { formats: ["image/avif", "image/webp"] },
  // Proxy /api to Nest so auth cookies are first-party in dev. In production
  // Caddy routes /api before requests ever reach Next; this is a harmless fallback.
  async rewrites() {
    return [{ source: "/api/:path*", destination: `${API_URL}/api/:path*` }];
  },
};

export default config;
