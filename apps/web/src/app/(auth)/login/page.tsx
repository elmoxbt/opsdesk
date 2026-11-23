import { getClientConfig } from "@opsdesk/client-config";
import type { Metadata } from "next";
import { Suspense } from "react";
import { type DemoLogins, LoginForm } from "./login-form";

export const metadata: Metadata = { title: "Sign in" };

/**
 * Demo deployments (DEMO_LOGINS=true) get one-click sign-in for each role,
 * using the seed's demo accounts. Off by default; a real client's deployment
 * never sets it. Read per request, so it can't be baked into a build by accident.
 */
function demoLogins(): DemoLogins | undefined {
  if (process.env.DEMO_LOGINS !== "true") return undefined;
  const config = getClientConfig();
  const domain = config.owner.email.split("@")[1]!;
  return {
    password: process.env.DEMO_PASSWORD ?? "demo-password-123",
    accounts: [
      {
        role: "Owner",
        email: config.owner.email,
        hint: "Everything, incl. invoices, analytics and API keys",
      },
      { role: "Dispatcher", email: `dispatch@${domain}`, hint: "Dispatch board, jobs, customers, invoices" },
      {
        role: "Technician",
        email: `tech@${domain}`,
        hint: "Their own jobs (best in the technician app at /tech)",
      },
    ],
  };
}

export default function LoginPage() {
  return (
    <Suspense>
      <LoginForm demo={demoLogins()} />
    </Suspense>
  );
}
