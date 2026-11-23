import { getClientConfig } from "@opsdesk/client-config";
import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { DevelopersView } from "./developers-view";

export const metadata: Metadata = { title: "Developers" };

/** The `publicApi` feature: API keys and webhooks. Off → this page doesn't exist. */
export default function DevelopersPage() {
  if (!getClientConfig().features.publicApi) notFound();
  return <DevelopersView />;
}
