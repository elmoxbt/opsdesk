import { getClientConfig } from "@opsdesk/client-config";
import { redirect } from "next/navigation";
import { HomeView } from "./home-view";

/**
 * Each deployment is one business's app. With the booking portal on, "/" is
 * that business's own public home page (their name, colours and services, a
 * "Book a visit" button), not a SaaS landing page. Without it, "/" goes
 * straight to work (the shell sends signed-out visitors to /login).
 */
export default function HomePage() {
  const config = getClientConfig();
  if (!config.features.bookingPortal) redirect("/dashboard");
  return <HomeView slug={config.business.slug} address={config.business.address ?? null} />;
}
