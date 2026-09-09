import { searchMenu } from './cart';

/**
 * Upsell suggestions.
 *
 * Calls the trained recommender in services/ml when it is up, and falls back
 * to a small rules table when it is not. The fallback is not a placeholder to
 * be deleted later — it is the baseline the trained model has to beat in the
 * Recall@k evaluation, and it keeps the terminal demoable when the ML service is
 * down mid-presentation.
 */

const ML_URL = process.env.ML_SERVICE_URL ?? 'http://127.0.0.1:8000';

export type Recommendation = { slug: string; name: string; priceCents: number; reason: string };

const RULES: { when: (cats: Set<string>) => boolean; query: string; reason: string }[] = [
  {
    when: (c) => c.size > 0 && !c.has('drinks'),
    query: 'medium drink',
    reason: 'no drink in the order yet',
  },
  {
    when: (c) => (c.has('burgers') || c.has('chicken')) && !c.has('sides'),
    query: 'medium fries',
    reason: 'a sandwich without a side',
  },
  {
    when: (c) => c.size >= 2 && !c.has('desserts'),
    query: 'chocolate shake',
    reason: 'rounding out the meal',
  },
];

export async function getRecommendations(
  cartSlugs: string[],
  cartCategories: string[],
  limit = 2,
): Promise<Recommendation[]> {
  try {
    const res = await fetch(`${ML_URL}/recommend`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ cart: cartSlugs, limit }),
      signal: AbortSignal.timeout(400),
    });
    if (res.ok) {
      const data = (await res.json()) as { recommendations?: Recommendation[] };
      if (data.recommendations?.length) return data.recommendations.slice(0, limit);
    }
  } catch {
    // ML service not running yet, or slower than the latency budget allows.
    // Either way the terminal keeps working on the rules baseline.
  }

  const cats = new Set(cartCategories);
  const out: Recommendation[] = [];
  for (const rule of RULES) {
    if (out.length >= limit) break;
    if (!rule.when(cats)) continue;
    const [hit] = await searchMenu(rule.query, 1);
    if (hit && !cartSlugs.includes(hit.slug)) {
      out.push({ slug: hit.slug, name: hit.name, priceCents: hit.priceCents, reason: rule.reason });
    }
  }
  return out;
}
