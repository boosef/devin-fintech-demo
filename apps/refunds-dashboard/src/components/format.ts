const currency = new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" });

export function formatCents(cents: number): string {
  return currency.format(cents / 100);
}

export function formatTimestamp(iso: string | null): string {
  if (iso === null) return "—";
  return `${iso.slice(0, 10)} ${iso.slice(11, 16)} UTC`;
}
