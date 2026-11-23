import type { Metadata } from "next";
import { PublicInvoice } from "./public-invoice";

export const metadata: Metadata = {
  title: "Invoice",
  // A pay link is a secret: keep it out of search engines and referrer headers.
  robots: { index: false, follow: false },
  referrer: "no-referrer",
};

export default async function PublicInvoicePage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  return <PublicInvoice token={token} />;
}
