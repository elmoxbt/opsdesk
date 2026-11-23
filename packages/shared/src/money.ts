/** Money is integer minor units everywhere (kobo, cents). These are the only conversions. */
export const toMinor = (major: number): number => Math.round(major * 100);
export const toMajor = (minor: number): number => minor / 100;

export function formatMoney(minor: number, currency = "NGN", locale = "en-NG"): string {
  return new Intl.NumberFormat(locale, {
    style: "currency",
    currency,
    minimumFractionDigits: 0,
    maximumFractionDigits: 2,
  }).format(toMajor(minor));
}
