import { type Browser, expect, type Page, test } from "@playwright/test";

/**
 * The golden path, across all three apps, as real people would do it:
 *
 *   customer books online → dispatcher schedules it → technician travels,
 *   works and gets a signature (technician PWA) → owner invoices it →
 *   customer pays online → everyone sees PAID.
 *
 * Assertions are on what people SEE. The API is only used to look up an id
 * for navigation (the equivalent of clicking through a list).
 */

const TECH_URL = process.env.E2E_TECH_URL ?? "http://localhost:3001/tech";
const SLUG = process.env.E2E_ORG_SLUG ?? "brightline";
const DEMO_PASSWORD = process.env.E2E_DEMO_PASSWORD ?? "demo-password-123";
/** The demo seed's technicians (name in the UI → login). */
const TECHNICIANS: Array<[name: string, email: string]> = [
  ["Chidi Eze", "tech@brightline.example"],
  ["Amaka Obi", "tech2@brightline.example"],
  ["Bayo Adewale", "tech3@brightline.example"],
];

const run = Date.now().toString(36);
const customer = {
  name: `Playwright ${run}`,
  phone: `+234 70${Math.floor(10_000_000 + Math.random() * 89_999_999)}`,
  email: `e2e+${run}@example.com`,
  address: "1 Test Avenue, Lekki, Lagos",
};

async function signInAs(browser: Browser, role: "Owner" | "Dispatcher"): Promise<Page> {
  const page = await (await browser.newContext()).newPage();
  await page.goto("/login");
  await page.getByRole("button", { name: new RegExp(`Sign in as ${role}`) }).click();
  await expect(page).toHaveURL(/\/dashboard/);
  return page;
}

test("book → schedule → complete on site → invoice → pay", async ({ browser }) => {
  // 1. The customer books on the public page, choosing the furthest open day
  //    (the demo data leaves it free, so the schedule below can't clash).
  const visitor = await (await browser.newContext()).newPage();
  await visitor.goto(`/book/${SLUG}`);
  await visitor.getByRole("button", { name: /Leak repair/ }).click();
  const days = visitor.getByRole("radiogroup", { name: "Day" }).getByRole("radio");
  await days
    .filter({ hasNot: visitor.locator("[disabled]") })
    .last()
    .click();
  await visitor
    .getByRole("radiogroup", { name: "Time" })
    .getByRole("radio")
    .and(visitor.locator(":not([disabled])"))
    .first()
    .click();
  await visitor.getByRole("button", { name: "Continue" }).click();
  await visitor.getByLabel("Name").fill(customer.name);
  await visitor.getByLabel("Phone").fill(customer.phone);
  await visitor.getByLabel("Email").fill(customer.email);
  await visitor.getByLabel("Address for the visit").fill(customer.address);
  await visitor.getByRole("button", { name: "Request booking" }).click();
  await expect(visitor.getByRole("heading", { name: "Booking received" })).toBeVisible();
  const reference = (await visitor.getByText(/Reference JOB-\d+/).textContent())!.replace("Reference ", "");

  // 2. The dispatcher finds it in the "to schedule" tray and assigns a technician. If one
  //    is already booked then (the board says so), they pick the next, like a person would.
  const dispatcher = await signInAs(browser, "Dispatcher");
  await dispatcher.goto("/dispatch");
  await dispatcher
    .getByRole("button", { name: new RegExp(customer.name) })
    .first()
    .click();
  const dialog = dispatcher.getByRole("dialog");
  let techEmail = "";
  for (const [name, email] of TECHNICIANS) {
    await dialog.getByLabel("Technician").selectOption({ label: name });
    await dialog.getByRole("button", { name: /^(Save|Schedule)$/ }).click();
    const outcome = await Promise.race([
      dialog.waitFor({ state: "hidden" }).then(() => "saved" as const),
      dialog
        .getByRole("alert")
        .waitFor()
        .then(() => "clash" as const),
    ]);
    if (outcome === "saved") {
      techEmail = email;
      break;
    }
  }
  expect(techEmail, "some technician was free for the booked slot").not.toBe("");
  const jobs = await (
    await dispatcher.request.get(`/api/jobs?q=${encodeURIComponent(customer.name)}`)
  ).json();
  const jobId: string = jobs.items[0].id;
  await dispatcher.goto(`/jobs/${jobId}`);
  await expect(dispatcher.getByRole("status").filter({ hasText: "Scheduled" }).first()).toBeVisible();
  await expect(dispatcher.getByText(reference).first()).toBeVisible();

  // 3. The technician works it from the PWA: on the way → start → customer signs.
  const tech = await (await browser.newContext()).newPage();
  await tech.goto(`${TECH_URL}/login`);
  await tech.getByLabel("Email").fill(techEmail);
  await tech.getByLabel("Password").fill(DEMO_PASSWORD);
  await tech.getByRole("button", { name: "Sign in" }).click();
  await expect(tech).not.toHaveURL(/login/);
  await tech.goto(`${TECH_URL}/job?id=${jobId}`);
  await tech.getByRole("button", { name: "I'm on my way" }).first().click();
  await tech.getByRole("button", { name: "Start job" }).first().click();
  await tech.getByRole("button", { name: "Complete job" }).first().click();
  const sheet = tech.getByRole("dialog");
  await sheet.getByLabel("Customer name").fill(customer.name);
  const pad = sheet.locator("canvas");
  // The sheet slides up; a stroke started where the pad USED to be would hit the
  // backdrop and close it. hover() waits for Playwright's "stable" check (same box
  // two frames running), so measure only after it.
  await pad.hover({ position: { x: 30, y: 80 } });
  const box = (await pad.boundingBox())!;
  await tech.mouse.down();
  for (let i = 1; i <= 12; i++) await tech.mouse.move(box.x + 30 + i * 15, box.y + 80 + (i % 2 ? -18 : 18));
  await tech.mouse.up();
  await expect(sheet.getByRole("button", { name: "Clear" })).toBeEnabled(); // ink registered
  await sheet.getByRole("button", { name: "Complete job" }).click();
  await expect(tech.getByText("Job completed")).toBeVisible();

  // 4. The owner invoices the completed job and issues it.
  const owner = await signInAs(browser, "Owner");
  await owner.goto(`/jobs/${jobId}`);
  await expect(owner.getByRole("status").filter({ hasText: "Completed" }).first()).toBeVisible();
  await owner.getByRole("button", { name: "Create invoice" }).click();
  // Generous: under `next dev` this may be the page's first visit, which compiles it.
  await expect(owner).toHaveURL(/\/invoices\/[0-9a-f-]{36}$/, { timeout: 60_000 });
  const invoiceId = owner.url().split("/").pop()!;
  await owner.getByRole("button", { name: /Issue & send/ }).click();
  await owner.getByRole("button", { name: "Issue invoice" }).click();
  await expect(owner.getByRole("button", { name: "Copy pay link" })).toBeVisible();
  const invoice = await (await owner.request.get(`/api/invoices/${invoiceId}`)).json();
  const payPath = new URL(invoice.publicUrl as string).pathname;

  // 5. The customer opens the pay link and pays (test checkout locally / in CI).
  await visitor.goto(payPath);
  await visitor.getByRole("button", { name: /^Pay / }).click();
  await visitor.getByRole("button", { name: /^Pay NGN/ }).click();
  await expect(visitor.getByText("Paid, thank you!")).toBeVisible();

  // 6. The office sees it closed out.
  await owner.goto(`/jobs/${jobId}`);
  await expect(owner.getByRole("status").filter({ hasText: "Paid" }).first()).toBeVisible();
  await owner.goto(`/invoices/${invoiceId}`);
  await expect(owner.getByRole("status").filter({ hasText: "Paid" }).first()).toBeVisible();
});

test("the demo sign-in buttons only appear on demo deployments", async ({ page }) => {
  await page.goto("/login");
  // This suite runs against a demo stack (DEMO_LOGINS=true), so they must be there and work.
  await expect(page.getByRole("heading", { name: "Try the demo" })).toBeVisible();
  await page.getByRole("button", { name: /Sign in as Dispatcher/ }).click();
  await expect(page).toHaveURL(/\/dashboard/);
});
