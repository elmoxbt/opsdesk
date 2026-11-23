import { getPublicClientConfig } from "@opsdesk/client-config";
import type { MetadataRoute } from "next";

export const dynamic = "force-dynamic";

/** Installable PWA, branded per client: their name, colour and icon on the technician's home screen. */
export default function manifest(): MetadataRoute.Manifest {
  const c = getPublicClientConfig();
  return {
    name: `${c.appName} · Technician`,
    short_name: c.appName,
    description: `Jobs, photos and sign-off for ${c.business.name} technicians`,
    start_url: "/tech/",
    scope: "/tech/",
    display: "standalone",
    orientation: "portrait",
    background_color: "#ffffff",
    theme_color: c.branding.primaryColor,
    icons: [
      { src: "/tech/app-icon?size=192", sizes: "192x192", type: "image/png", purpose: "any" },
      { src: "/tech/app-icon?size=512", sizes: "512x512", type: "image/png", purpose: "any" },
      { src: "/tech/app-icon?size=512&maskable=1", sizes: "512x512", type: "image/png", purpose: "maskable" },
    ],
  };
}
