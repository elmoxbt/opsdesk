import { getClientConfig } from "@opsdesk/client-config";
import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { BookingStatus } from "./booking-status";

export const metadata: Metadata = {
  title: "Your booking",
  robots: { index: false, follow: false },
  referrer: "no-referrer",
};

export default async function BookingStatusPage({ params }: { params: Promise<{ token: string }> }) {
  if (!getClientConfig().features.bookingPortal) notFound();
  const { token } = await params;
  return <BookingStatus token={token} />;
}
