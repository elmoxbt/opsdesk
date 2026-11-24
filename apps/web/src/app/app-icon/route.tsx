import { getPublicClientConfig } from "@opsdesk/client-config";
import { ImageResponse } from "next/og";

export const dynamic = "force-dynamic";

/**
 * PNG app icon generated from the client's brand colour, so every client's
 * browser tab (and PWA) has its own icon without anyone opening a design tool.
 * Used when the client config sets no faviconUrl.
 * Maskable icons keep the mark inside the 80% safe zone Android crops to.
 */
export function GET(req: Request) {
  const url = new URL(req.url);
  const size = Math.min(1024, Math.max(48, Number(url.searchParams.get("size")) || 192));
  const maskable = url.searchParams.has("maskable");
  const { primaryColor, primaryForeground } = getPublicClientConfig().branding;
  const mark = Math.round(size * (maskable ? 0.42 : 0.56));
  return new ImageResponse(
    <div
      style={{
        width: "100%",
        height: "100%",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        background: primaryColor,
        borderRadius: maskable ? 0 : size * 0.22,
      }}
    >
      <svg width={mark} height={mark} viewBox="0 0 32 32">
        <path
          d="M7 16.5 13.5 23 25 9.5"
          stroke={primaryForeground}
          strokeWidth="3.5"
          fill="none"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      </svg>
    </div>,
    { width: size, height: size, headers: { "Cache-Control": "public, max-age=86400" } },
  );
}
