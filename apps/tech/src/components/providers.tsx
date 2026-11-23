"use client";

import { ApiError } from "@opsdesk/shared";
import { createAsyncStoragePersister } from "@tanstack/query-async-storage-persister";
import { QueryClient } from "@tanstack/react-query";
import { PersistQueryClientProvider } from "@tanstack/react-query-persist-client";
import { MotionConfig } from "motion/react";
import { ThemeProvider } from "next-themes";
import { type ReactNode, useState } from "react";
import { Toaster } from "sonner";
import { queryCacheStorage } from "@/offline/idb-store";

const DAY = 24 * 60 * 60 * 1000;

/**
 * Server state is persisted to IndexedDB, so opening the app with no signal
 * still shows today's jobs as last seen. `gcTime` must outlive the persisted
 * age, or the cache is dropped before it could be restored.
 */
export function Providers({ children }: { children: ReactNode }) {
  const [client] = useState(
    () =>
      new QueryClient({
        defaultOptions: {
          queries: {
            gcTime: DAY,
            staleTime: 30_000,
            retry: (count, err) => !(err instanceof ApiError && err.status < 500) && count < 2,
          },
        },
      }),
  );
  const [persister] = useState(() =>
    createAsyncStoragePersister({ storage: queryCacheStorage, key: "opsdesk-tech", throttleTime: 1000 }),
  );

  return (
    <PersistQueryClientProvider
      client={client}
      persistOptions={{
        persister,
        maxAge: DAY,
        // A new deploy can change response shapes: don't restore an old build's cache.
        buster: process.env.NEXT_PUBLIC_BUILD_ID,
        dehydrateOptions: { shouldDehydrateQuery: (q) => q.state.status === "success" },
      }}
    >
      <ThemeProvider
        attribute="class"
        defaultTheme="light"
        themes={["light", "dark"]}
        enableSystem={false}
        disableTransitionOnChange
      >
        <MotionConfig reducedMotion="user">
          {children}
          <Toaster position="top-center" richColors closeButton toastOptions={{ className: "rounded-xl" }} />
        </MotionConfig>
      </ThemeProvider>
    </PersistQueryClientProvider>
  );
}
