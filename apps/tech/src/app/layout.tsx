import { getPublicClientConfig } from "@opsdesk/client-config";
import { ClientConfigProvider } from "@opsdesk/ui/client-config";
import { GeistMono } from "geist/font/mono";
import { GeistSans } from "geist/font/sans";
import type { Metadata, Viewport } from "next";
import type { CSSProperties, ReactNode } from "react";
import { Providers } from "@/components/providers";
import { ServiceWorkerRegister } from "@/components/sw-register";
import "./globals.css";

export const dynamic = "force-dynamic"; // branding + feature switches are read at runtime

export function generateMetadata(): Metadata {
  const c = getPublicClientConfig();
  return {
    title: { default: c.appName, template: `%s · ${c.appName}` },
    description: `${c.business.name} technician app`,
    appleWebApp: { capable: true, title: c.appName, statusBarStyle: "default" },
    icons: { icon: "/tech/app-icon?size=192", apple: "/tech/app-icon?size=180" },
  };
}

export function generateViewport(): Viewport {
  return {
    themeColor: getPublicClientConfig().branding.primaryColor,
    width: "device-width",
    initialScale: 1,
    viewportFit: "cover",
  };
}

export default function RootLayout({ children }: { children: ReactNode }) {
  const config = getPublicClientConfig();
  const brand = {
    "--brand": config.branding.primaryColor,
    "--brand-foreground": config.branding.primaryForeground,
  } as CSSProperties;
  return (
    <html
      lang={config.business.locale}
      className={`${GeistSans.variable} ${GeistMono.variable}`}
      style={brand}
      suppressHydrationWarning
    >
      <body className="min-h-dvh bg-background font-sans">
        <ClientConfigProvider value={config}>
          {config.features.technicianApp ? (
            <Providers>
              <ServiceWorkerRegister />
              {children}
            </Providers>
          ) : (
            <main className="grid min-h-dvh place-items-center p-6 text-center">
              <p className="text-muted-foreground">
                The technician app isn&apos;t enabled for {config.business.name}.
              </p>
            </main>
          )}
        </ClientConfigProvider>
      </body>
    </html>
  );
}
