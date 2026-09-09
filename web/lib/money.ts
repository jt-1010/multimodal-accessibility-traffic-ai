/** Cents to a display string. The only place cents become dollars. */
export function formatMoney(cents: number): string {
  return `$${(cents / 100).toFixed(2)}`;
}
