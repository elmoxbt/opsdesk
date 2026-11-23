import PDFDocument from "pdfkit";

export interface InvoicePdfData {
  business: {
    name: string;
    email: string;
    phone?: string | null;
    address?: string | null;
    primaryColor: string;
  };
  number: string;
  status: string;
  issueDate: Date;
  dueDate: Date;
  paidAt: Date | null;
  customer: { name: string; email: string | null; phone: string | null; address: string | null };
  lineItems: Array<{ description: string; quantity: number; unitPriceMinor: number; totalMinor: number }>;
  subtotalMinor: number;
  taxRateBps: number;
  taxMinor: number;
  totalMinor: number;
  amountPaidMinor: number;
  currency: string;
  locale: string;
  timezone: string;
  notes: string | null;
  footer?: string;
  payUrl: string | null;
}

const MUTED = "#6b7280";
const INK = "#111827";
const RULE = "#e5e7eb";

/**
 * Renders an invoice as a PDF, in memory. A pure function of its input (no DB,
 * no S3), so it's unit-testable and the worker decides where the bytes go.
 *
 * PDFKit over Puppeteer/react-pdf: no headless Chrome in the worker image
 * (~300 MB and a frequent source of crashes), and no React renderer in a Nest
 * service. Trade-off: layout is imperative code, which is fine for one document.
 *
 * Amounts use the ISO code ("NGN 35,000.00"): PDFKit's built-in fonts can't draw
 * "₦", and embedding a font for one glyph isn't worth the image size.
 */
export function renderInvoicePdf(d: InvoicePdfData): Promise<Buffer> {
  const money = (minor: number) =>
    new Intl.NumberFormat(d.locale, {
      style: "currency",
      currency: d.currency,
      currencyDisplay: "code",
    }).format(minor / 100);
  const date = (x: Date) =>
    new Intl.DateTimeFormat(d.locale, { dateStyle: "medium", timeZone: d.timezone }).format(x);

  const doc = new PDFDocument({
    size: "A4",
    margin: 50,
    info: {
      Title: `Invoice ${d.number}`,
      Author: d.business.name,
      // Fixed dates keep the bytes stable for the same input (useful for caching and tests).
      CreationDate: d.issueDate,
      ModDate: d.issueDate,
    },
  });
  const chunks: Buffer[] = [];
  doc.on("data", (c: Buffer) => chunks.push(c));
  const done = new Promise<Buffer>((resolve, reject) => {
    doc.on("end", () => resolve(Buffer.concat(chunks)));
    doc.on("error", reject);
  });

  const left = doc.page.margins.left;
  const right = doc.page.width - doc.page.margins.right;
  const width = right - left;

  // --- Header: business on the left, invoice meta on the right -------------
  doc
    .fillColor(d.business.primaryColor)
    .font("Helvetica-Bold")
    .fontSize(20)
    .text(d.business.name, left, 50, {
      width: width / 2,
    });
  doc.moveDown(0.3).fillColor(MUTED).font("Helvetica").fontSize(9);
  for (const line of [d.business.address, d.business.email, d.business.phone]) {
    if (line) doc.text(line, { width: width / 2 });
  }
  const headerBottom = doc.y;

  doc.fillColor(INK).font("Helvetica-Bold").fontSize(24).text("INVOICE", left, 50, { width, align: "right" });
  doc.font("Helvetica").fontSize(10).fillColor(MUTED);
  const meta: Array<[string, string]> = [
    ["Number", d.number],
    ["Issued", date(d.issueDate)],
    ["Due", date(d.dueDate)],
  ];
  if (d.paidAt) meta.push(["Paid", date(d.paidAt)]);
  for (const [k, v] of meta) doc.text(`${k}: ${v}`, { width, align: "right" });

  if (d.status === "PAID" || d.status === "VOID") {
    doc
      .moveDown(0.5)
      .font("Helvetica-Bold")
      .fontSize(14)
      .fillColor(d.status === "PAID" ? "#059669" : "#dc2626")
      .text(d.status, { width, align: "right" });
  }

  // --- Bill to ---------------------------------------------------------------
  let y = Math.max(headerBottom, doc.y) + 30;
  doc.font("Helvetica-Bold").fontSize(9).fillColor(MUTED).text("BILL TO", left, y);
  doc.font("Helvetica-Bold").fontSize(11).fillColor(INK).text(d.customer.name);
  doc.font("Helvetica").fontSize(9).fillColor(MUTED);
  for (const line of [d.customer.address, d.customer.email, d.customer.phone]) if (line) doc.text(line);

  // --- Line items --------------------------------------------------------------
  const cols = {
    desc: left,
    qty: left + width * 0.5,
    unit: left + width * 0.58,
    amount: left + width * 0.79,
  };
  const colW = { desc: width * 0.48, qty: width * 0.07, unit: width * 0.2, amount: width * 0.21 };

  const tableHeader = (at: number) => {
    doc.font("Helvetica-Bold").fontSize(9).fillColor(MUTED);
    doc.text("DESCRIPTION", cols.desc, at, { width: colW.desc });
    doc.text("QTY", cols.qty, at, { width: colW.qty, align: "right" });
    doc.text("UNIT PRICE", cols.unit, at, { width: colW.unit, align: "right" });
    doc.text("AMOUNT", cols.amount, at, { width: colW.amount, align: "right" });
    doc
      .moveTo(left, at + 14)
      .lineTo(right, at + 14)
      .strokeColor(RULE)
      .stroke();
    return at + 22;
  };

  y = tableHeader(doc.y + 24);
  const pageBottom = () => doc.page.height - doc.page.margins.bottom - 40;
  doc.font("Helvetica").fontSize(10).fillColor(INK);
  for (const item of d.lineItems) {
    const h = doc.heightOfString(item.description, { width: colW.desc });
    if (y + h > pageBottom()) {
      doc.addPage();
      y = tableHeader(doc.page.margins.top);
      doc.font("Helvetica").fontSize(10).fillColor(INK);
    }
    doc.text(item.description, cols.desc, y, { width: colW.desc });
    doc.text(String(item.quantity), cols.qty, y, { width: colW.qty, align: "right" });
    doc.text(money(item.unitPriceMinor), cols.unit, y, { width: colW.unit, align: "right" });
    doc.text(money(item.totalMinor), cols.amount, y, { width: colW.amount, align: "right" });
    y += Math.max(h, 12) + 8;
  }

  // --- Totals ------------------------------------------------------------------
  if (y + 110 > pageBottom()) {
    doc.addPage();
    y = doc.page.margins.top;
  }
  doc.moveTo(cols.unit, y).lineTo(right, y).strokeColor(RULE).stroke();
  y += 10;
  // Totals get a wider value column than line amounts: a bold "NGN 1,234,567.00" must never wrap.
  const valueW = 130;
  const totalRow = (label: string, value: string, bold = false) => {
    doc
      .font(bold ? "Helvetica-Bold" : "Helvetica")
      .fontSize(bold ? 12 : 10)
      .fillColor(bold ? INK : MUTED);
    doc.text(label, cols.qty - 40, y, { width: right - valueW - (cols.qty - 40) - 10, align: "right" });
    doc.fillColor(INK).text(value, right - valueW, y, { width: valueW, align: "right", lineBreak: false });
    y += bold ? 20 : 16;
  };
  totalRow("Subtotal", money(d.subtotalMinor));
  if (d.taxRateBps > 0)
    totalRow(`Tax (${(d.taxRateBps / 100).toFixed(2).replace(/\.?0+$/, "")}%)`, money(d.taxMinor));
  totalRow("Total", money(d.totalMinor), true);
  if (d.amountPaidMinor > 0) {
    totalRow("Paid", money(d.amountPaidMinor));
    totalRow("Balance due", money(Math.max(0, d.totalMinor - d.amountPaidMinor)), true);
  }

  // --- Notes, pay link, footer ----------------------------------------------------
  doc.x = left;
  doc.y = y + 20;
  if (d.notes) {
    doc.font("Helvetica-Bold").fontSize(9).fillColor(MUTED).text("NOTES");
    doc.font("Helvetica").fontSize(10).fillColor(INK).text(d.notes, { width });
    doc.moveDown();
  }
  if (d.payUrl && d.status !== "PAID" && d.status !== "VOID") {
    doc
      .font("Helvetica-Bold")
      .fontSize(10)
      .fillColor(d.business.primaryColor)
      .text("Pay online", { link: d.payUrl, underline: true });
    doc.font("Helvetica").fontSize(9).fillColor(MUTED).text(d.payUrl, { link: d.payUrl });
    doc.moveDown();
  }
  if (d.footer) doc.font("Helvetica").fontSize(9).fillColor(MUTED).text(d.footer, { width, align: "center" });

  doc.end();
  return done;
}
