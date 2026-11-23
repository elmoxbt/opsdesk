import { getClientConfig } from "@opsdesk/client-config";
import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { BookingFlow } from "./booking-flow";

export function generateMetadata(): Metadata {
  return { title: `Book a visit · ${getClientConfig().business.name}` };
}

/** `bookingPortal` feature: when it's off, this page doesn't exist. */
export default async function BookPage({ params }: { params: Promise<{ orgSlug: string }> }) {
  if (!getClientConfig().features.bookingPortal) notFound();
  const { orgSlug } = await params;
  return <BookingFlow slug={orgSlug} />;
}
