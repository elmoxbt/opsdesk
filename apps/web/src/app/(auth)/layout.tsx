"use client";

import Link from "next/link";
import type { ReactNode } from "react";
import { useClientConfig } from "@opsdesk/ui/client-config";
import { DispatchScene } from "@opsdesk/ui/illustrations";
import { Logo } from "@opsdesk/ui/logo";

/** Split screen: form on the left, the client's brand panel on the right (lg+). */
export default function AuthLayout({ children }: { children: ReactNode }) {
  const { business, branding } = useClientConfig();
  return (
    <div className="grid min-h-dvh lg:grid-cols-2">
      <div className="flex flex-col px-4 py-8 sm:px-10">
        <Link href="/" className="w-fit rounded-md">
          <Logo />
        </Link>
        <main className="mx-auto flex w-full max-w-sm flex-1 flex-col justify-center py-10">{children}</main>
        <p className="text-xs text-muted-foreground">
          {business.name}
          {business.phone && <> · {business.phone}</>}
        </p>
      </div>
      <aside
        className="relative hidden overflow-hidden lg:flex lg:flex-col lg:justify-between lg:p-12"
        style={{
          background: "linear-gradient(145deg, var(--brand), color-mix(in oklch, var(--brand) 55%, black))",
        }}
      >
        <div
          className="pointer-events-none absolute -top-24 -right-24 size-96 rounded-full bg-white/10 blur-3xl"
          aria-hidden
        />
        <DispatchScene className="relative mx-auto mt-6 w-full max-w-md drop-shadow-2xl" />
        <div className="relative max-w-md text-white">
          <p className="text-2xl leading-snug font-semibold text-balance">
            {branding.tagline ?? business.name}
          </p>
          <p className="mt-3 text-sm text-white/75">
            Every job, photo and payment in one place, for the whole team.
          </p>
        </div>
      </aside>
    </div>
  );
}
