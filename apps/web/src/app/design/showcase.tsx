"use client";

import { JOB_STATUSES } from "@opsdesk/shared";
import { CalendarClock, CircleCheck, Users, Wallet } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";
import { CountUp } from "@opsdesk/ui/count-up";
import { StaggerItem } from "@opsdesk/ui/stagger";
import { ThemeToggle } from "@opsdesk/ui/theme-toggle";
import { Button } from "@opsdesk/ui/button";
import { Skeleton } from "@opsdesk/ui/skeleton";
import { type BadgeStatus, StatusBadge } from "@opsdesk/ui/status-badge";

const BADGES: BadgeStatus[] = ["SCHEDULED", "EN_ROUTE", "IN_PROGRESS", "COMPLETED", "OVERDUE"];
const SWATCHES = ["brand", "foreground", "muted", "border", "destructive"] as const;

const KPIS = [
  {
    label: "Revenue (30d)",
    value: 4_820_500,
    format: { style: "currency", currency: "NGN", maximumFractionDigits: 0 },
    Icon: Wallet,
  },
  { label: "Jobs completed", value: 182, format: { maximumFractionDigits: 0 }, Icon: CircleCheck },
  { label: "Scheduled this week", value: 46, format: { maximumFractionDigits: 0 }, Icon: CalendarClock },
  {
    label: "Repeat customers",
    value: 0.38,
    format: { style: "percent", maximumFractionDigits: 0 },
    Icon: Users,
  },
] satisfies Array<{ label: string; value: number; format: Intl.NumberFormatOptions; Icon: typeof Wallet }>;

/** Living reference for tokens and motion primitives. Every phase builds pages from these. */
export function DesignShowcase() {
  const [statusIndex, setStatusIndex] = useState(0);
  const [loading, setLoading] = useState(false);
  const status = JOB_STATUSES[statusIndex % JOB_STATUSES.length] ?? "REQUESTED";

  const save = () => {
    setLoading(true);
    setTimeout(() => {
      setLoading(false);
      toast.success("Job saved", { description: "Changes are visible to your team." });
    }, 1200);
  };

  return (
    <main className="mx-auto max-w-5xl space-y-12 px-4 py-10 sm:px-6 lg:py-16">
      <header className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <h1 className="text-3xl font-semibold tracking-tight">Design system</h1>
          <p className="mt-1 text-muted-foreground">Tokens, components and motion used across OpsDesk.</p>
        </div>
        <ThemeToggle />
      </header>

      <Section title="KPIs" hint="Count up from 0 on first view; static with reduced motion.">
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          {KPIS.map(({ label, value, format, Icon }) => (
            <div key={label} className="rounded-xl border bg-card p-5 shadow-sm">
              <div className="flex items-center justify-between text-sm text-muted-foreground">
                {label}
                <Icon className="size-4" aria-hidden />
              </div>
              <CountUp value={value} format={format} className="mt-2 block text-2xl font-semibold" />
            </div>
          ))}
        </div>
      </Section>

      <Section title="Job status" hint="Badges cross-fade (opacity only) when the status changes.">
        <div className="flex flex-wrap items-center gap-3">
          {BADGES.map((s) => (
            <StatusBadge key={s} status={s} />
          ))}
        </div>
        <div className="mt-4 flex items-center gap-3">
          <StatusBadge status={status} />
          <Button variant="outline" size="sm" onClick={() => setStatusIndex((i) => i + 1)}>
            Advance status
          </Button>
        </div>
      </Section>

      <Section title="Buttons" hint="0.98 press; loading swaps the label for a spinner at constant width.">
        <div className="flex flex-wrap gap-3">
          <Button loading={loading} onClick={save}>
            Save changes
          </Button>
          <Button variant="secondary">Secondary</Button>
          <Button variant="outline">Outline</Button>
          <Button variant="ghost">Ghost</Button>
          <Button
            variant="destructive"
            onClick={() => toast.error("Couldn't cancel job", { description: "Try again." })}
          >
            Error toast
          </Button>
        </div>
      </Section>

      <Section title="Loading" hint="Shimmer skeletons, never spinners, for data.">
        <div className="space-y-3 rounded-xl border bg-card p-5 shadow-sm">
          {[0, 1, 2].map((i) => (
            <div key={i} className="flex items-center gap-4">
              <Skeleton className="size-10 rounded-full" />
              <div className="flex-1 space-y-2">
                <Skeleton className="h-4 w-1/3" />
                <Skeleton className="h-3 w-1/2" />
              </div>
            </div>
          ))}
        </div>
      </Section>

      <Section title="Lists" hint="Rows stagger in at 30ms, capped at the first 10.">
        <ul className="divide-y rounded-xl border bg-card shadow-sm">
          {[
            "Boiler service · Lekki",
            "Generator repair · Yaba",
            "Deep clean · Ikoyi",
            "AC install · VI",
            "Leak fix · Surulere",
          ].map((row, i) => (
            <StaggerItem key={row} index={i} className="flex items-center justify-between px-5 py-3 text-sm">
              {row}
              <span className="font-mono text-xs text-muted-foreground">JOB-{1040 + i}</span>
            </StaggerItem>
          ))}
        </ul>
      </Section>

      <Section title="Color" hint="Brand is overridden per tenant on the booking portal and invoices.">
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-5">
          {SWATCHES.map((name) => (
            <div key={name} className="overflow-hidden rounded-xl border shadow-xs">
              <div className="h-16" style={{ background: `var(--${name})` }} />
              <div className="px-3 py-2 font-mono text-xs">--{name}</div>
            </div>
          ))}
        </div>
      </Section>
    </main>
  );
}

function Section({ title, hint, children }: { title: string; hint: string; children: React.ReactNode }) {
  return (
    <section aria-labelledby={`s-${title}`} className="space-y-4">
      <div>
        <h2 id={`s-${title}`} className="text-lg font-semibold tracking-tight">
          {title}
        </h2>
        <p className="text-sm text-muted-foreground">{hint}</p>
      </div>
      {children}
    </section>
  );
}
