import { QueryClient } from "@tanstack/react-query";
import { ApiError } from "./api/client";

export function makeQueryClient(): QueryClient {
  return new QueryClient({
    defaultOptions: {
      queries: {
        staleTime: 30_000,
        refetchOnWindowFocus: true,
        // Retry network/5xx blips, never 4xx (they won't fix themselves).
        retry: (count, err) => !(err instanceof ApiError && err.status < 500) && count < 2,
      },
    },
  });
}
