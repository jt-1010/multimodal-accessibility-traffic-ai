import { and, eq } from 'drizzle-orm';
import { getDb } from '@/lib/db';
import { menuItems, modifiers, orderItems, orders } from '@/lib/db/schema';
import type { MenuItem, Modifier } from '@/lib/db/schema';

/**
 * All cart behaviour lives here, deliberately free of any LLM concept.
 *
 * The agent's tools are thin wrappers over these functions. That split is what
 * makes the ordering logic testable: the fixture suite can assert cart state
 * across dozens of scenarios without spending a token, and the same assertions
 * then run unchanged against both LLM backends.
 */

export type CartLine = {
  lineId: number;
  slug: string;
  name: string;
  qty: number;
  unitPriceCents: number;
  modifiers: { slug: string; name: string; priceDeltaCents: number }[];
  lineTotalCents: number;
};

export type CartView = {
  lines: CartLine[];
  subtotalCents: number;
  taxCents: number;
  totalCents: number;
  itemCount: number;
};

/** Santa Clara County. Kept explicit rather than hidden in a magic number. */
const TAX_RATE = 0.09375;

export function formatMoney(cents: number): string {
  return `$${(cents / 100).toFixed(2)}`;
}

// ---------------------------------------------------------------------------
// Menu search
// ---------------------------------------------------------------------------

export type MenuMatch = MenuItem & { score: number };

/**
 * Rank menu items against a free-text query.
 *
 * At 35 rows we pull the whole menu and rank in memory. That is genuinely the
 * right call at this size — it beats a Postgres full-text index on latency,
 * it is trivial to debug, and scoring rules stay readable. If the menu ever
 * reaches thousands of items, move this to tsvector and keep the same shape.
 */
export async function searchMenu(query: string, limit = 5): Promise<MenuMatch[]> {
  const db = await getDb();
  const all = await db.select().from(menuItems).where(eq(menuItems.available, true));
  const q = query.trim().toLowerCase();
  if (!q) return [];

  const scored = all
    .map((item) => {
      const name = item.name.toLowerCase();
      const aliases = item.aliases.map((a) => a.toLowerCase());
      let score = 0;

      if (item.slug === q) score = 100;
      else if (name === q) score = 95;
      else if (aliases.includes(q)) score = 90;
      else if (name.startsWith(q)) score = 70;
      else if (aliases.some((a) => a.startsWith(q))) score = 65;
      else if (name.includes(q)) score = 50;
      else if (aliases.some((a) => a.includes(q) || q.includes(a))) score = 45;
      else if (item.description.toLowerCase().includes(q)) score = 20;
      else if (item.category === q) score = 15;

      return { ...item, score };
    })
    .filter((i) => i.score > 0)
    .sort((a, b) => b.score - a.score || a.priceCents - b.priceCents);

  return scored.slice(0, limit);
}

/**
 * Find the closest things we DO sell, for when we sell nothing like it.
 *
 * `searchMenu` is deliberately strict -- it returns nothing rather than a bad
 * guess, because silently adding the wrong item is the worst outcome. But
 * "we do not have that" on its own is a dead end, and a dead end is far more
 * costly for someone who has just spent effort signing or typing the request.
 *
 * So this always comes back with something. It scores loosely on shared words
 * and shared character trigrams, which is enough to get from "pizza" to a
 * sandwich, or "milkshake" to a shake, without any model at all.
 */
function trigrams(value: string): Set<string> {
  const padded = ` ${value.toLowerCase().trim()} `;
  const out = new Set<string>();
  for (let i = 0; i < padded.length - 2; i++) out.add(padded.slice(i, i + 3));
  return out;
}

function similarity(a: string, b: string): number {
  const A = trigrams(a);
  const B = trigrams(b);
  if (A.size === 0 || B.size === 0) return 0;
  let shared = 0;
  for (const g of A) if (B.has(g)) shared++;
  return shared / Math.max(A.size, B.size); // Jaccard-ish, 0..1
}

export async function suggestAlternatives(query: string, limit = 3): Promise<MenuMatch[]> {
  const db = await getDb();
  const all = await db.select().from(menuItems).where(eq(menuItems.available, true));
  const q = query.trim().toLowerCase();
  if (!q || all.length === 0) return [];

  const queryWords = new Set(q.split(/\s+/).filter((w) => w.length > 2));

  return all
    .map((item) => {
      const haystack = [item.name, item.category, ...item.aliases].join(' ').toLowerCase();

      // Shared whole words are a stronger signal than character overlap:
      // "chicken sandwich" -> "Crispy Chicken Sandwich" should win outright.
      let wordScore = 0;
      for (const w of queryWords) if (haystack.includes(w)) wordScore += 0.4;

      const charScore = Math.max(
        similarity(q, item.name),
        ...item.aliases.map((a) => similarity(q, a)),
      );

      return { ...item, score: Math.min(1, wordScore + charScore) };
    })
    .sort((a, b) => b.score - a.score || a.priceCents - b.priceCents)
    .slice(0, limit);
}

export async function findModifiers(names: string[]): Promise<Modifier[]> {
  if (names.length === 0) return [];
  const db = await getDb();
  const all = await db.select().from(modifiers);

  const found: Modifier[] = [];
  for (const raw of names) {
    const n = raw.trim().toLowerCase();
    const hit =
      all.find((m) => m.slug === n) ??
      all.find((m) => m.name.toLowerCase() === n) ??
      all.find((m) => m.aliases.some((a) => a.toLowerCase() === n)) ??
      all.find((m) => m.aliases.some((a) => n.includes(a.toLowerCase())));
    if (hit && !found.some((f) => f.id === hit.id)) found.push(hit);
  }
  return found;
}

// ---------------------------------------------------------------------------
// Cart
// ---------------------------------------------------------------------------

async function getOrCreateCartId(sessionId: string): Promise<number> {
  const db = await getDb();
  const existing = await db
    .select()
    .from(orders)
    .where(and(eq(orders.sessionId, sessionId), eq(orders.status, 'cart')))
    .limit(1);

  if (existing.length > 0) return existing[0].id;

  const [created] = await db.insert(orders).values({ sessionId }).returning();
  return created.id;
}

export async function getCart(sessionId: string): Promise<CartView> {
  const db = await getDb();
  const cartId = await getOrCreateCartId(sessionId);

  const rows = await db
    .select({ oi: orderItems, mi: menuItems })
    .from(orderItems)
    .innerJoin(menuItems, eq(orderItems.menuItemId, menuItems.id))
    .where(eq(orderItems.orderId, cartId));

  const lines: CartLine[] = rows.map(({ oi, mi }) => {
    const modTotal = oi.modifiers.reduce((s, m) => s + m.priceDeltaCents, 0);
    return {
      lineId: oi.id,
      slug: mi.slug,
      name: mi.name,
      qty: oi.qty,
      unitPriceCents: oi.unitPriceCents,
      modifiers: oi.modifiers,
      lineTotalCents: (oi.unitPriceCents + modTotal) * oi.qty,
    };
  });

  const subtotalCents = lines.reduce((s, l) => s + l.lineTotalCents, 0);
  const taxCents = Math.round(subtotalCents * TAX_RATE);

  return {
    lines,
    subtotalCents,
    taxCents,
    totalCents: subtotalCents + taxCents,
    itemCount: lines.reduce((s, l) => s + l.qty, 0),
  };
}

export type AddResult =
  | { ok: true; added: CartLine; cart: CartView }
  | { ok: false; reason: 'not_found'; suggestions: MenuMatch[] };

export async function addToCart(
  sessionId: string,
  itemQuery: string,
  qty = 1,
  modifierNames: string[] = [],
): Promise<AddResult> {
  const db = await getDb();
  const matches = await searchMenu(itemQuery, 5);

  // Refuse to guess when the top match is weak. A wrong item added silently is
  // worse than one clarifying question. But never answer with a bare "no" --
  // come back with the nearest things we actually sell.
  if (matches.length === 0 || matches[0].score < 40) {
    return {
      ok: false,
      reason: 'not_found',
      suggestions: await suggestAlternatives(itemQuery, 3),
    };
  }

  const item = matches[0];
  const mods = await findModifiers(modifierNames);
  const cartId = await getOrCreateCartId(sessionId);

  const [inserted] = await db
    .insert(orderItems)
    .values({
      orderId: cartId,
      menuItemId: item.id,
      qty: Math.max(1, Math.floor(qty)),
      // Price is snapshotted from the database row, never from the model.
      unitPriceCents: item.priceCents,
      modifiers: mods.map((m) => ({
        slug: m.slug,
        name: m.name,
        priceDeltaCents: m.priceDeltaCents,
      })),
    })
    .returning();

  const cart = await getCart(sessionId);
  const added = cart.lines.find((l) => l.lineId === inserted.id)!;
  return { ok: true, added, cart };
}

export async function removeFromCart(
  sessionId: string,
  itemQuery: string,
): Promise<{ ok: boolean; removed?: CartLine; cart: CartView }> {
  const db = await getDb();
  const cart = await getCart(sessionId);
  const q = itemQuery.trim().toLowerCase();

  const line =
    cart.lines.find((l) => l.slug === q) ??
    cart.lines.find((l) => l.name.toLowerCase() === q) ??
    cart.lines.find((l) => l.name.toLowerCase().includes(q)) ??
    cart.lines.find((l) => q.includes(l.name.toLowerCase().split(' ')[0]));

  if (!line) return { ok: false, cart };

  await db.delete(orderItems).where(eq(orderItems.id, line.lineId));
  return { ok: true, removed: line, cart: await getCart(sessionId) };
}

export async function clearCart(sessionId: string): Promise<CartView> {
  const db = await getDb();
  const cartId = await getOrCreateCartId(sessionId);
  await db.delete(orderItems).where(eq(orderItems.orderId, cartId));
  return getCart(sessionId);
}

export async function confirmOrder(
  sessionId: string,
): Promise<{ ok: boolean; orderId?: number; cart: CartView }> {
  const db = await getDb();
  const cart = await getCart(sessionId);
  if (cart.lines.length === 0) return { ok: false, cart };

  const cartId = await getOrCreateCartId(sessionId);
  await db
    .update(orders)
    .set({ status: 'confirmed', confirmedAt: new Date() })
    .where(eq(orders.id, cartId));

  return { ok: true, orderId: cartId, cart };
}
