"use client";

import { ErrorState } from "@opsdesk/ui/states";

/** Route-level error boundary: an unexpected render error never leaves a blank page. */
export default function AppError({ reset }: { error: Error; reset: () => void }) {
  return <ErrorState message="An unexpected error occurred. Our team has been notified." onRetry={reset} />;
}
