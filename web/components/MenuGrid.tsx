'use client';

import { formatMoney } from '@/lib/money';

export type MenuItem = {
  id: number;
  slug: string;
  name: string;
  description: string;
  category: string;
  priceCents: number;
  calories: number | null;
};

type Props = {
  categories: Record<string, MenuItem[]>;
  onPick: (item: MenuItem) => void;
  disabled?: boolean;
};

/**
 * Touch input, routed through the same agent as speech and sign.
 *
 * Tapping does not mutate the cart directly - it sends a [TOUCH] message and
 * lets the agent act on it. That keeps one conversation, so the read-back at
 * the end covers everything however it was ordered, and a person can start by
 * tapping and finish by signing without the system losing the thread.
 */
export function MenuGrid({ categories, onPick, disabled }: Props) {
  const names = Object.keys(categories);
  if (names.length === 0) return null;

  return (
    <section aria-label="Menu" className="space-y-5">
      {names.map((category) => (
        <div key={category}>
          <h3 className="mb-2 text-sm font-semibold uppercase tracking-widest text-slate-400">
            {category}
          </h3>
          <ul className="grid grid-cols-2 gap-2 sm:grid-cols-3">
            {categories[category].map((item) => (
              <li key={item.slug}>
                <button
                  type="button"
                  onClick={() => onPick(item)}
                  disabled={disabled}
                  // 44px minimum touch target, per WCAG 2.1 AA.
                  className="flex min-h-[4.25rem] w-full flex-col justify-center rounded-xl border border-slate-700 bg-slate-900 px-3 py-2 text-left transition hover:border-emerald-500 hover:bg-slate-800 focus:outline-none focus-visible:ring-2 focus-visible:ring-emerald-400 disabled:cursor-not-allowed disabled:opacity-40"
                >
                  <span className="text-sm font-medium text-slate-100">{item.name}</span>
                  <span className="text-sm tabular-nums text-emerald-400">
                    {formatMoney(item.priceCents)}
                  </span>
                </button>
              </li>
            ))}
          </ul>
        </div>
      ))}
    </section>
  );
}
