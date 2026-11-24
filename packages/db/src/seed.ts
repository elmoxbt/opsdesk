/**
 * DEMO data for the business this deployment serves (run `bootstrap` first).
 * For local dev, sales demos and staging; deploy-client.sh only runs it with --seed-demo.
 *
 * What you get: a dispatcher and 3 technicians, 5 services, stock items,
 * 50 customers and exactly 200 jobs: four months of finished, invoiced and
 * paid work (so analytics and invoices have history), today's board, the next
 * two weeks, and a tray of unscheduled requests (some from online booking).
 *
 * Deterministic (seeded PRNG): the same demo every run, so screenshots and
 * the Playwright test can rely on it. Never double-books a technician (it
 * fills each technician's day from a cursor), so it also respects the
 * database's no-overlap constraint.
 *
 * Idempotent: staff, services and stock are upserted; customers, jobs and
 * invoices are generated only into an organization that has no jobs yet.
 */
import { randomBytes } from "node:crypto";
import { getClientConfig } from "@opsdesk/client-config";
import { formatInvoiceNumber, phoneKey, zonedDateKey, zonedTimeToUtc } from "@opsdesk/shared";
import { type Customer, type JobSource, type JobStatus, PrismaClient, type Role } from "@prisma/client";
import { hash } from "bcryptjs";

const prisma = new PrismaClient();
const DEMO_PASSWORD = process.env.DEMO_PASSWORD ?? "demo-password-123";
const TOTAL_JOBS = 200;

/** Placeholder avatars (DiceBear); the UI falls back to initials if they fail to load. */
const avatar = (name: string) =>
  `https://api.dicebear.com/9.x/notionists/svg?seed=${encodeURIComponent(name)}`;

// ---- Deterministic randomness ------------------------------------------------
let state = 20_261_118;
const rand = () => (state = (state * 1_103_515_245 + 12_345) % 2_147_483_648) / 2_147_483_648;
const pick = <T>(xs: readonly T[]): T => xs[Math.floor(rand() * xs.length)]!;
const chance = (p: number) => rand() < p;

// ---- Reference data ---------------------------------------------------------
const SERVICES = [
  {
    name: "Generator servicing",
    defaultDurationMinutes: 120,
    defaultPriceMinor: 3_500_000,
    description: "Oil, filters, plugs and a load test.",
  },
  {
    name: "AC installation",
    defaultDurationMinutes: 180,
    defaultPriceMinor: 8_000_000,
    description: "Split unit install incl. piping up to 3m.",
  },
  {
    name: "AC servicing",
    defaultDurationMinutes: 90,
    defaultPriceMinor: 2_000_000,
    description: "Clean, gas check and drain flush.",
  },
  {
    name: "Leak repair",
    defaultDurationMinutes: 60,
    defaultPriceMinor: 1_500_000,
    description: "Find and fix leaking pipes, taps and fittings.",
  },
  {
    name: "Deep cleaning",
    defaultDurationMinutes: 240,
    defaultPriceMinor: 4_500_000,
    description: "Whole-home deep clean, up to 3 bedrooms.",
  },
  {
    name: "Electrical fault finding",
    defaultDurationMinutes: 90,
    defaultPriceMinor: 2_500_000,
    description: "Trace and fix tripping breakers, dead sockets and faulty wiring.",
  },
];
/** Relative popularity of each service above. */
const SERVICE_WEIGHTS = [5, 2, 4, 6, 2, 3];

const STOCK = [
  {
    sku: "PIPE-15MM",
    name: "Copper pipe 15mm (1m)",
    quantity: 40,
    reorderThreshold: 10,
    unitCostMinor: 450_000,
  },
  { sku: "VALVE-ISO", name: "Isolation valve", quantity: 3, reorderThreshold: 5, unitCostMinor: 900_000 },
  {
    sku: "FILTER-OIL",
    name: "Generator oil filter",
    quantity: 12,
    reorderThreshold: 4,
    unitCostMinor: 650_000,
  },
  { sku: "PLUG-SPARK", name: "Spark plug", quantity: 24, reorderThreshold: 8, unitCostMinor: 300_000 },
  {
    sku: "GAS-R410A",
    name: "R410A refrigerant (kg)",
    quantity: 8,
    reorderThreshold: 3,
    unitCostMinor: 2_500_000,
  },
  {
    sku: "CAP-35UF",
    name: "AC run capacitor 35µF",
    quantity: 2,
    reorderThreshold: 3,
    unitCostMinor: 700_000,
  },
];

const FIRST = [
  "Funke",
  "Emeka",
  "Zainab",
  "Kunle",
  "Ngozi",
  "Ibrahim",
  "Tolu",
  "Chiamaka",
  "Segun",
  "Halima",
  "Obinna",
  "Yetunde",
  "Musa",
  "Adaeze",
  "Femi",
  "Aisha",
  "Uche",
  "Bisi",
  "Tunde",
  "Kemi",
];
const LAST = [
  "Adeyemi",
  "Nwosu",
  "Bello",
  "Ajayi",
  "Okeke",
  "Musa",
  "Balogun",
  "Eze",
  "Ogunleye",
  "Abubakar",
  "Okafor",
  "Lawal",
  "Danjuma",
  "Obi",
  "Fashola",
  "Yusuf",
  "Chukwu",
  "Adebayo",
];
const STREETS = [
  "Admiralty Way, Lekki Phase 1",
  "Herbert Macaulay Way, Yaba",
  "Glover Road, Ikoyi",
  "Adeola Odeku St, Victoria Island",
  "Bode Thomas St, Surulere",
  "Allen Avenue, Ikeja",
  "Awolowo Road, Ikoyi",
  "Ogudu Road, Ojota",
  "Agungi Ajiran Road, Lekki",
  "Ajose Adeogun St, Victoria Island",
  "Opebi Road, Ikeja",
  "Ago Palace Way, Okota",
];

/** Wall-clock hour:minute in the org's zone on a day offset from the org's TODAY. */
function at(dayOffset: number, minutes: number, tz: string): Date {
  const [y, m, d] = zonedDateKey(new Date(), tz).split("-").map(Number) as [number, number, number];
  const day = new Date(Date.UTC(y, m - 1, d + dayOffset));
  return zonedTimeToUtc(
    day.getUTCFullYear(),
    day.getUTCMonth() + 1,
    day.getUTCDate(),
    Math.floor(minutes / 60),
    minutes % 60,
    tz,
  );
}
const weekday = (dayOffset: number, tz: string) =>
  new Intl.DateTimeFormat("en-GB", { timeZone: tz, weekday: "short" }).format(at(dayOffset, 12 * 60, tz));

async function main(): Promise<void> {
  const config = getClientConfig();
  const tz = config.business.timezone;
  const org = await prisma.organization.findUnique({ where: { slug: config.business.slug } });
  if (!org)
    throw new Error(
      `No organization "${config.business.slug}" yet. Run bootstrap first (pnpm db:bootstrap).`,
    );

  // ---- Staff (on the owner's email domain, so they look like the client's own team) ----
  const domain = config.owner.email.split("@")[1]!;
  const passwordHash = await hash(DEMO_PASSWORD, 12);
  const people: Array<{ email: string; name: string; role: Role }> = [
    { email: `dispatch@${domain}`, name: "Tunde Bello", role: "DISPATCHER" },
    { email: `tech@${domain}`, name: "Chidi Eze", role: "TECHNICIAN" },
    { email: `tech2@${domain}`, name: "Amaka Obi", role: "TECHNICIAN" },
    { email: `tech3@${domain}`, name: "Bayo Adewale", role: "TECHNICIAN" },
  ];
  const staff = [];
  for (const p of people)
    staff.push(
      await prisma.user.upsert({
        where: { email: p.email },
        update: {},
        create: { ...p, avatarUrl: avatar(p.name), passwordHash, organizationId: org.id },
      }),
    );
  const techs = staff.filter((u) => u.role === "TECHNICIAN");

  const services = [];
  for (const s of SERVICES)
    services.push(
      await prisma.serviceType.upsert({
        where: { organizationId_name: { organizationId: org.id, name: s.name } },
        // Keep demo descriptions current on existing databases; never touch prices or names.
        update: { description: s.description },
        create: { ...s, organizationId: org.id },
      }),
    );
  for (const item of STOCK)
    await prisma.inventoryItem.upsert({
      where: { organizationId_sku: { organizationId: org.id, sku: item.sku } },
      update: {},
      create: { ...item, organizationId: org.id },
    });

  if ((await prisma.job.count({ where: { organizationId: org.id } })) === 0)
    await seedWork(org.id, org.currency, tz, techs, services);

  const counts = await Promise.all([
    prisma.customer.count({ where: { organizationId: org.id } }),
    prisma.job.count({ where: { organizationId: org.id } }),
    prisma.invoice.count({ where: { organizationId: org.id } }),
  ]);
  console.log(
    `Seeded demo data for "${org.name}": ${counts[0]} customers, ${counts[1]} jobs, ${counts[2]} invoices.`,
  );
  console.log(`Demo staff (password: ${DEMO_PASSWORD}):`);
  for (const p of people) console.log(`  ${p.role.padEnd(10)} ${p.email}`);
  console.log(`  OWNER      ${config.owner.email} (password from OWNER_INITIAL_PASSWORD)`);
}

interface Planned {
  day: number | null;
  start: Date | null;
  end: Date | null;
  techId: string | null;
  status: JobStatus;
  source: JobSource;
  serviceIdx: number;
}

async function seedWork(
  organizationId: string,
  currency: string,
  tz: string,
  techs: Array<{ id: string }>,
  services: Array<{ id: string; name: string; defaultDurationMinutes: number; defaultPriceMinor: number }>,
): Promise<void> {
  // ---- 50 customers -------------------------------------------------------------
  const customers: Customer[] = [];
  const used = new Set<string>();
  while (customers.length < 50) {
    const name = `${pick(FIRST)} ${pick(LAST)}`;
    if (used.has(name)) continue;
    used.add(name);
    const n = customers.length + 1;
    const phone = `+234 80${(n % 9) + 1} 555 ${String(1000 + n).slice(-4)}`;
    customers.push(
      await prisma.customer.create({
        data: {
          organizationId,
          name,
          phone,
          phoneKey: phoneKey(phone),
          email: chance(0.65) ? `${name.toLowerCase().replace(/[^a-z]+/g, ".")}@example.com` : null,
          address: `${1 + Math.floor(rand() * 60)} ${pick(STREETS)}, Lagos`,
          notes: chance(0.1) ? "Call before arriving; gate code at the security post." : null,
          createdAt: at(-130 + Math.floor(rand() * 100), 9 * 60, tz),
        },
      }),
    );
  }
  // Repeat customers: a few households book much more often than others.
  const customerFor = () => (chance(0.3) ? customers[Math.floor(rand() * 8)]! : pick(customers));
  const weighted = SERVICE_WEIGHTS.flatMap((w, i) => Array<number>(w).fill(i));

  // ---- Plan the 200 jobs ------------------------------------------------------------
  const plan: Planned[] = [];
  /** Fill one technician's working day (08:00–18:00) from a cursor, so jobs never overlap. */
  const fillDay = (day: number, tech: { id: string }, count: number, status: (k: number) => JobStatus) => {
    let cursor = 8 * 60 + (chance(0.5) ? 0 : 30);
    for (let k = 0; k < count; k++) {
      const serviceIdx = pick(weighted);
      const dur = services[serviceIdx]!.defaultDurationMinutes;
      if (cursor + dur > 18 * 60) break;
      plan.push({
        day,
        start: at(day, cursor, tz),
        end: at(day, cursor + dur, tz),
        techId: tech.id,
        status: status(k),
        source: chance(0.25) ? "BOOKING" : "DASHBOARD",
        serviceIdx,
      });
      cursor += dur + 30 + (chance(0.4) ? 60 : 0);
    }
  };

  // Today: everyone's busy, at different stages.
  const todayStatuses: JobStatus[][] = [
    ["COMPLETED", "IN_PROGRESS", "SCHEDULED"],
    ["EN_ROUTE", "SCHEDULED"],
    ["IN_PROGRESS", "SCHEDULED", "SCHEDULED"],
  ];
  techs.forEach((t, i) => fillDay(0, t, todayStatuses[i % 3]!.length, (k) => todayStatuses[i % 3]![k]!));
  // The next two weeks, thinning out further ahead.
  for (let day = 1; day <= 14; day++) {
    if (weekday(day, tz) === "Sun") continue;
    for (const t of techs)
      if (chance(day <= 5 ? 0.75 : 0.35)) fillDay(day, t, 1 + Math.floor(rand() * 2), () => "SCHEDULED");
  }
  // Unscheduled requests: some online bookings with a preferred time, some phone-ins with none.
  for (let i = 0; i < 9; i++) {
    const online = i < 5;
    const day = online ? 1 + Math.floor(rand() * 6) : null;
    const serviceIdx = pick(weighted);
    const start = day === null ? null : at(day, (9 + Math.floor(rand() * 7)) * 60, tz);
    plan.push({
      day,
      start,
      end: start && new Date(start.getTime() + services[serviceIdx]!.defaultDurationMinutes * 60_000),
      techId: null,
      status: "REQUESTED",
      source: online ? "BOOKING" : "DASHBOARD",
      serviceIdx,
    });
  }
  // History fills the rest, going back day by day.
  for (let day = -1; plan.length < TOTAL_JOBS && day > -200; day--) {
    if (weekday(day, tz) === "Sun") continue;
    for (const t of techs)
      if (chance(0.6))
        fillDay(day, t, 1 + Math.floor(rand() * 2), () => (chance(0.04) ? "CANCELLED" : "COMPLETED"));
  }
  plan.length = TOTAL_JOBS;
  plan.sort((a, b) => (a.start?.getTime() ?? Infinity) - (b.start?.getTime() ?? Infinity));

  // ---- Create jobs, then invoices/payments for finished history -----------------------
  const now = Date.now();
  let jobSeq = 0;
  let invoiceSeq = 0;
  for (const p of plan) {
    const svc = services[p.serviceIdx]!;
    const customer = customerFor();
    const price = Math.round((svc.defaultPriceMinor * (0.9 + rand() * 0.3)) / 50_000) * 50_000;
    const past = p.day !== null && p.day < 0;
    const done =
      ["COMPLETED", "IN_PROGRESS", "EN_ROUTE"].includes(p.status) || (past && p.status !== "CANCELLED");
    // Past completed work: mostly invoiced; most of that paid; the last few days not yet invoiced.
    const invoiced = past && p.status === "COMPLETED" && (p.day! < -3 || chance(0.3));
    const issueDate = invoiced ? new Date(p.end!.getTime() + Math.floor(rand() * 2) * 86_400_000) : null;
    const paidAt = issueDate
      ? new Date(issueDate.getTime() + (1 + Math.floor(rand() * 20)) * 86_400_000)
      : null;
    const paid = !!paidAt && paidAt.getTime() < now && chance(0.88);
    const status: JobStatus = paid ? "PAID" : invoiced ? "INVOICED" : p.status;

    const job = await prisma.job.create({
      data: {
        organizationId,
        number: ++jobSeq,
        customerId: customer.id,
        serviceTypeId: svc.id,
        technicianId: p.techId,
        status,
        source: p.source,
        bookingToken: p.source === "BOOKING" ? randomBytes(24).toString("base64url") : null,
        scheduledStart: p.start,
        scheduledEnd: p.end,
        startedAt: done && p.start ? p.start : null,
        completedAt: (past && p.status !== "CANCELLED") || p.status === "COMPLETED" ? p.end : null,
        cancelledAt: p.status === "CANCELLED" ? p.start : null,
        cancellationReason: p.status === "CANCELLED" ? "Customer rescheduled by phone" : null,
        priceMinor: price,
        notes: p.source === "BOOKING" ? `Booked online by ${customer.name}.` : null,
        createdAt: new Date(
          Math.min(now, (p.start?.getTime() ?? now) - (1 + Math.floor(rand() * 6)) * 86_400_000),
        ),
        checklist: [
          { id: "c1", label: "Confirm access with customer", done: done },
          { id: "c2", label: "Take before photos", done: done && p.status !== "EN_ROUTE" },
          {
            id: "c3",
            label: "Test and walk customer through",
            done: (past && p.status !== "CANCELLED") || p.status === "COMPLETED",
          },
        ],
      },
    });
    if (!invoiced || !issueDate) continue;
    const tax = Math.round((price * 750) / 10_000);
    const invoice = await prisma.invoice.create({
      data: {
        organizationId,
        number: formatInvoiceNumber(++invoiceSeq),
        customerId: customer.id,
        jobId: job.id,
        status: paid ? "PAID" : "SENT",
        currency,
        taxRateBps: 750,
        subtotalMinor: price,
        taxMinor: tax,
        totalMinor: price + tax,
        amountPaidMinor: paid ? price + tax : 0,
        issueDate,
        sentAt: issueDate,
        dueDate: new Date(issueDate.getTime() + 14 * 86_400_000),
        paidAt: paid ? paidAt : null,
        publicToken: randomBytes(24).toString("base64url"),
        lineItems: {
          create: [
            {
              description: `${svc.name} (JOB-${String(job.number).padStart(4, "0")})`,
              quantity: 1,
              unitPriceMinor: price,
              totalMinor: price,
              position: 0,
            },
          ],
        },
      },
    });
    if (paid)
      await prisma.payment.create({
        data: {
          organizationId,
          invoiceId: invoice.id,
          provider: "MANUAL",
          method: pick(["bank_transfer", "bank_transfer", "cash", "pos"]),
          reference: `seed_${invoice.id}`,
          idempotencyKey: `seed_${invoice.id}`,
          amountMinor: price + tax,
          currency,
          status: "SUCCEEDED",
          paidAt,
        },
      });
  }
  await prisma.organization.update({ where: { id: organizationId }, data: { jobSeq, invoiceSeq } });
}

main()
  .catch((e: unknown) => {
    console.error(e);
    process.exitCode = 1;
  })
  .finally(() => void prisma.$disconnect());
