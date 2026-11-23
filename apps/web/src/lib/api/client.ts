// The browser API client lives in @opsdesk/shared so the dashboard and the
// technician PWA share one implementation (single-flight token refresh, typed errors).
export { api, ApiError, errorMessage, type Query, refreshSession, toSearchParams } from "@opsdesk/shared";
