"use client";

import { QueryClientProvider } from "@tanstack/react-query";
import { MotionConfig } from "motion/react";
import { ThemeProvider } from "next-themes";
import { type ReactNode, useState } from "react";
import { Toaster } from "sonner";
import { makeQueryClient } from "@/lib/query-client";

/**
 * - QueryClientProvider: server state (caching, refetch, invalidation).
 * - ThemeProvider: light or dark (explicit choice, default light) via a class on <html>.
 * - MotionConfig reducedMotion="user": with OS reduced motion, Motion drops
 *   transform animations and keeps opacity fades.
 * - Toaster: Sonner toasts for every success/error action.
 */
export function Providers({ children }: { children: ReactNode }) {
  const [queryClient] = useState(makeQueryClient);
  return (
    <QueryClientProvider client={queryClient}>
      <ThemeProvider
        attribute="class"
        defaultTheme="light"
        themes={["light", "dark"]}
        enableSystem={false}
        disableTransitionOnChange
      >
        <MotionConfig reducedMotion="user">
          {children}
          <Toaster
            position="bottom-right"
            richColors
            closeButton
            toastOptions={{ className: "rounded-xl" }}
          />
        </MotionConfig>
      </ThemeProvider>
    </QueryClientProvider>
  );
}
