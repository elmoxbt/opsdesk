/** The introduction at the top of /api/docs: what an integrator needs before the first call. */
export const API_INTRO = `
Field-service operations API: customers, jobs, scheduling, invoices.

**Authentication.** Send an API key as \`Authorization: Bearer opsk_…\` (owners create keys under Settings → Developers).
Each key has scopes; an endpoint marked with a scope (e.g. \`jobs:write\`) needs it. Endpoints without a scope aren't available to API keys.

**Rate limits.** 120 requests per minute per key. Responses carry \`RateLimit-Limit\`, \`RateLimit-Remaining\` and \`RateLimit-Reset\`; a 429 adds \`Retry-After\`.

**Retries.** Send \`Idempotency-Key: <uuid>\` on writes: a retry with the same key returns the original response instead of acting twice.

**Errors.** Always \`{ "error": { "code", "message", "details"?, "requestId" } }\`.

**Webhooks.** POSTs carry \`OpsDesk-Event-Id\`, \`OpsDesk-Event-Type\` and \`OpsDesk-Signature: t=<unix>,v1=<hex>\`,
where v1 = HMAC-SHA256(secret, "<t>.<raw body>"). Reject old timestamps (e.g. older than 5 minutes) and dedupe on the
event id: delivery is at-least-once and retried with backoff.
`;
