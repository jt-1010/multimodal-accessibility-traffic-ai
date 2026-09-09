'use client';

import { formatMoney } from '@/lib/money';

export type CartLine = {
  lineId: number;
  slug: string;
  name: string;
  qty: number;
  unitPriceCents: number;
  modifiers: { slug: string; name: string; priceDeltaCents: number }[];
  lineTotalCents: number;
};

export type Cart = {
  lines: CartLine[];
  subtotalCents: number;
  taxCents: number;
  totalCents: number;
  itemCount: number;
};

export function CartPanel({ cart }: { cart: Cart | null }) {
  const lines = cart?.lines ?? [];

  return (
    <section
      aria-label="Your order"
      className="flex h-full flex-col rounded-2xl border border-slate-700 bg-slate-900"
    >
      <h2 className="border-b border-slate-700 px-5 py-4 text-lg font-semibold text-slate-100">
        Your order
      </h2>

      {/*
        aria-live so a screen reader announces items as they are added. A blind
        user has no cart panel to glance at - this region IS their receipt.
      */}
      <div aria-live="polite" aria-atomic="false" className="flex-1 overflow-y-auto px-5 py-3">
        {lines.length === 0 ? (
          <p className="py-6 text-slate-400">Nothing added yet.</p>
        ) : (
          <ul className="space-y-3">
            {lines.map((line) => (
              <li key={line.lineId} className="flex justify-between gap-3 text-slate-100">
                <div className="min-w-0">
                  <p className="truncate font-medium">
                    {line.qty > 1 && <span className="text-emerald-400">{line.qty}× </span>}
                    {line.name}
                  </p>
                  {line.modifiers.length > 0 && (
                    <p className="truncate text-sm text-slate-400">
                      {line.modifiers.map((m) => m.name).join(', ')}
                    </p>
                  )}
                </div>
                <span className="shrink-0 tabular-nums">{formatMoney(line.lineTotalCents)}</span>
              </li>
            ))}
          </ul>
        )}
      </div>

      <dl className="space-y-1 border-t border-slate-700 px-5 py-4 text-slate-300">
        <div className="flex justify-between text-sm">
          <dt>Subtotal</dt>
          <dd className="tabular-nums">{formatMoney(cart?.subtotalCents ?? 0)}</dd>
        </div>
        <div className="flex justify-between text-sm">
          <dt>Tax</dt>
          <dd className="tabular-nums">{formatMoney(cart?.taxCents ?? 0)}</dd>
        </div>
        <div className="flex justify-between pt-2 text-2xl font-bold text-white">
          <dt>Total</dt>
          <dd className="tabular-nums">{formatMoney(cart?.totalCents ?? 0)}</dd>
        </div>
      </dl>
    </section>
  );
}
