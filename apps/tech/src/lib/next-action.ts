import type { JobStatus } from "@opsdesk/shared";

export type NextAction =
  | { type: "transition"; to: JobStatus; label: string; short: string }
  | { type: "complete"; label: string; short: string }
  | null;

/** The one obvious next step for a job, as a technician sees it. Drives the action bar and swipe-right. */
export function nextAction(status: JobStatus): NextAction {
  switch (status) {
    case "SCHEDULED":
      return { type: "transition", to: "EN_ROUTE", label: "I'm on my way", short: "On my way" };
    case "EN_ROUTE":
      return { type: "transition", to: "IN_PROGRESS", label: "Start job", short: "Start" };
    case "IN_PROGRESS":
      return { type: "complete", label: "Complete job", short: "Complete" };
    default:
      return null;
  }
}

/** Google Maps turn-by-turn to the customer: works on Android and iOS (opens the app if installed). */
export const directionsUrl = (address: string) =>
  `https://www.google.com/maps/dir/?api=1&destination=${encodeURIComponent(address)}`;
export const telUrl = (phone: string) => `tel:${phone.replace(/[^\d+]/g, "")}`;
