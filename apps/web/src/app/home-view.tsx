"use client";

import { api, type BookingPortalDto, formatMoney } from "@opsdesk/shared";
import { Button } from "@opsdesk/ui/button";
import { useClientConfig } from "@opsdesk/ui/client-config";
import { Logo } from "@opsdesk/ui/logo";
import { Skeleton } from "@opsdesk/ui/skeleton";
import { ThemeToggle } from "@opsdesk/ui/theme-toggle";
import { useQuery } from "@tanstack/react-query";
import { ArrowRight, CalendarCheck, Clock, CreditCard, Mail, MapPin, Phone, UserCheck } from "lucide-react";
import { motion, type Variants } from "motion/react";
import Link from "next/link";

/** Scroll reveal: fade + 12px rise, once. MotionConfig reducedMotion="user" drops the movement. */
const reveal: Variants = {
  hidden: { opacity: 0, y: 12 },
  show: (i: number = 0) => ({
    opacity: 1,
    y: 0,
    transition: { duration: 0.45, delay: i * 0.06, ease: [0.22, 1, 0.36, 1] },
  }),
};

const STEPS = [
  {
    icon: CalendarCheck,
    title: "Book online",
    text: "Pick a service and a time that suits you. It takes a minute.",
  },
  {
    icon: UserCheck,
    title: "We confirm",
    text: "You'll get a confirmation with your technician's name, then a heads-up when they're on the way.",
  },
  {
    icon: CreditCard,
    title: "Pay by link",
    text: "After the job you get an invoice with a secure link. Pay online or by transfer.",
  },
];

export function HomeView({ slug, address }: { slug: string; address: string | null }) {
  const config = useClientConfig();
  const portal = useQuery({
    queryKey: ["booking-portal", slug],
    queryFn: () => api<BookingPortalDto>(`/public/booking/${slug}`),
  });
  const services = portal.data?.services ?? [];
  const book = `/book/${slug}`;

  return (
    <div className="min-h-dvh bg-background">
      <header className="mx-auto flex max-w-6xl items-center justify-between px-4 py-5">
        <span className="flex items-center gap-2 font-semibold">
          {config.branding.logoUrl ? (
            // Plain <img>: a client-provided asset on any host.
            <img src={config.branding.logoUrl} alt="" className="h-8 w-auto" />
          ) : (
            <Logo withText={false} />
          )}
          {config.business.name}
        </span>
        <nav className="flex items-center gap-2" aria-label="Site">
          <ThemeToggle />
          <Button asChild variant="ghost" size="sm">
            <Link href="/login">Staff sign in</Link>
          </Button>
        </nav>
      </header>

      <main>
        {/* Hero */}
        <section className="mx-auto max-w-6xl px-4 pt-10 pb-16 sm:pt-20">
          <motion.div initial="hidden" animate="show" className="max-w-2xl">
            <motion.p variants={reveal} custom={0} className="text-sm font-medium text-primary">
              {config.business.name}
            </motion.p>
            <motion.h1
              variants={reveal}
              custom={1}
              className="mt-3 text-4xl font-semibold tracking-tight text-balance sm:text-5xl"
            >
              {config.branding.tagline ?? "Reliable home services, booked in a minute."}
            </motion.h1>
            <motion.p variants={reveal} custom={2} className="mt-4 text-lg text-muted-foreground">
              Choose a service and a time online. We confirm your technician, keep you posted, and you pay by
              link when the job's done.
            </motion.p>
            <motion.div variants={reveal} custom={3} className="mt-8 flex flex-wrap gap-3">
              <Button asChild size="lg">
                <Link href={book}>
                  Book a visit <ArrowRight aria-hidden />
                </Link>
              </Button>
              {config.business.phone && (
                <Button asChild size="lg" variant="outline">
                  <a href={`tel:${config.business.phone.replace(/\s/g, "")}`}>
                    <Phone aria-hidden /> {config.business.phone}
                  </a>
                </Button>
              )}
            </motion.div>
          </motion.div>
        </section>

        {/* Marquee: what we do, gently scrolling. Static and wrapped under reduced motion. */}
        {services.length > 0 && (
          <section aria-label="Services we offer" className="border-y bg-muted/40 py-4">
            <div className="group flex overflow-hidden motion-reduce:hidden">
              {[0, 1].map((copy) => (
                <ul
                  key={copy}
                  aria-hidden={copy === 1}
                  className="flex shrink-0 animate-[opsdesk-marquee_30s_linear_infinite] items-center gap-10 pr-10 group-hover:[animation-play-state:paused]"
                >
                  {[...services, ...services].map((s, i) => (
                    <li
                      key={`${s.id}-${i}`}
                      className="flex items-center gap-10 text-sm font-medium whitespace-nowrap text-muted-foreground"
                    >
                      {s.name}
                      <span className="size-1 rounded-full bg-primary/60" aria-hidden />
                    </li>
                  ))}
                </ul>
              ))}
            </div>
            <ul className="mx-auto hidden max-w-6xl flex-wrap gap-x-6 gap-y-2 px-4 text-sm text-muted-foreground motion-reduce:flex">
              {services.map((s) => (
                <li key={s.id}>{s.name}</li>
              ))}
            </ul>
            <style>{`@keyframes opsdesk-marquee { from { transform: translateX(0) } to { transform: translateX(-100%) } }`}</style>
          </section>
        )}

        {/* Services */}
        <section className="mx-auto max-w-6xl px-4 py-16" aria-labelledby="services">
          <motion.h2
            id="services"
            variants={reveal}
            initial="hidden"
            whileInView="show"
            viewport={{ once: true, margin: "-80px" }}
            className="text-2xl font-semibold tracking-tight"
          >
            Services
          </motion.h2>
          <div className="mt-6 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {portal.isPending
              ? Array.from({ length: 3 }, (_, i) => <Skeleton key={i} className="h-36 rounded-2xl" />)
              : services.map((s, i) => (
                  <motion.div
                    key={s.id}
                    variants={reveal}
                    custom={i}
                    initial="hidden"
                    whileInView="show"
                    viewport={{ once: true, margin: "-60px" }}
                  >
                    <Link
                      href={book}
                      className="motion-press flex h-full flex-col rounded-2xl border bg-card p-5 transition-[transform,box-shadow] duration-200 hover:-translate-y-0.5 hover:shadow-md"
                    >
                      <span className="font-medium">{s.name}</span>
                      {s.description && (
                        <span className="mt-1 text-sm text-muted-foreground">{s.description}</span>
                      )}
                      <span className="mt-auto flex items-center justify-between pt-4 text-sm">
                        <span className="inline-flex items-center gap-1 text-muted-foreground">
                          <Clock className="size-3.5" aria-hidden /> about{" "}
                          {Math.round(s.defaultDurationMinutes / 30) / 2} h
                        </span>
                        <span className="font-mono tabular-nums">
                          from{" "}
                          {formatMoney(s.defaultPriceMinor, portal.data!.currency, config.business.locale)}
                        </span>
                      </span>
                    </Link>
                  </motion.div>
                ))}
          </div>
        </section>

        {/* How it works */}
        <section className="border-t bg-muted/30" aria-labelledby="how">
          <div className="mx-auto max-w-6xl px-4 py-16">
            <h2 id="how" className="text-2xl font-semibold tracking-tight">
              How it works
            </h2>
            <ol className="mt-8 grid gap-6 sm:grid-cols-3">
              {STEPS.map((step, i) => (
                <motion.li
                  key={step.title}
                  variants={reveal}
                  custom={i}
                  initial="hidden"
                  whileInView="show"
                  viewport={{ once: true, margin: "-60px" }}
                  className="rounded-2xl border bg-card p-5"
                >
                  <span className="flex size-10 items-center justify-center rounded-xl bg-primary/10 text-primary">
                    <step.icon className="size-5" aria-hidden />
                  </span>
                  <p className="mt-4 font-medium">
                    <span className="sr-only">Step {i + 1}: </span>
                    {step.title}
                  </p>
                  <p className="mt-1 text-sm text-muted-foreground">{step.text}</p>
                </motion.li>
              ))}
            </ol>
            <div className="mt-10">
              <Button asChild size="lg">
                <Link href={book}>
                  Book a visit <ArrowRight aria-hidden />
                </Link>
              </Button>
            </div>
          </div>
        </section>
      </main>

      <footer className="mx-auto flex max-w-6xl flex-col gap-3 px-4 py-10 text-sm text-muted-foreground sm:flex-row sm:items-center sm:justify-between">
        <span>
          © {new Date().getFullYear()} {config.business.name}
        </span>
        <span className="flex flex-wrap gap-x-5 gap-y-1">
          {address && (
            <span className="inline-flex items-center gap-1.5">
              <MapPin className="size-4" aria-hidden /> {address}
            </span>
          )}
          {config.business.phone && (
            <a
              href={`tel:${config.business.phone.replace(/\s/g, "")}`}
              className="inline-flex items-center gap-1.5 hover:text-foreground"
            >
              <Phone className="size-4" aria-hidden /> {config.business.phone}
            </a>
          )}
          <a
            href={`mailto:${config.business.email}`}
            className="inline-flex items-center gap-1.5 hover:text-foreground"
          >
            <Mail className="size-4" aria-hidden /> {config.business.email}
          </a>
        </span>
      </footer>
    </div>
  );
}
