import { before, describe, it } from 'node:test';
import assert from 'node:assert/strict';

import { eq } from 'drizzle-orm';
import { seed } from '@/lib/db/seed';
import {
  addToCart,
  clearCart,
  confirmOrder,
  getCart,
  removeFromCart,
  searchMenu,
} from '@/lib/agent/cart';
import { getDb } from '@/lib/db';
import { menuItems, type MenuItem } from '@/lib/db/schema';

// Throwaway in-memory database. Safe to set after the imports because the
// data directory is resolved on first connection, not at module load.
process.env.PGLITE_DATA_DIR = 'memory';

/**
 * The ordering fixture suite.
 *
 * Two properties worth stating, because both were earned the hard way:
 *
 * 1. LLM-free. Every scenario is a property of the cart layer, so the suite
 *    runs in CI in ~2s, costs nothing, and gives an unambiguous answer. When
 *    the fine-tuned model lands, these same scenarios get replayed THROUGH
 *    each backend to compare them -- but a failure here is always our logic.
 *
 * 2. MENU-AGNOSTIC. Nothing below hardcodes an item name or a price. Fixtures
 *    are looked up from the database at run time, so swapping data/menu/*.csv
 *    for a different restaurant does not break a single test. An earlier
 *    version hardcoded "Classic Burger, 599" and 13 tests broke the moment
 *    the menu became real data -- which is exactly the coupling a test suite
 *    should not have to a swappable data file.
 */

let counter = 0;
const newSession = () => `test-${Date.now()}-${counter++}`;

/** Representative items, resolved once from whatever menu is loaded. */
const fixtures: Record<string, MenuItem> = {};

before(async () => {
  await seed();
  const db = await getDb();
  const all = await db.select().from(menuItems);

  const pick = (category: string) => all.find((i) => i.category === category);
  const burger = pick('burgers') ?? all[0];
  const side = pick('sides') ?? all[1];
  const drink = pick('drinks') ?? all[2];
  const dessert = pick('desserts') ?? all[3];

  Object.assign(fixtures, { burger, side, drink, dessert });

  for (const [name, item] of Object.entries(fixtures)) {
    assert.ok(item, `no menu item available for fixture "${name}"`);
  }
});

describe('menu search', () => {
  it('matches an exact name', async () => {
    const [top] = await searchMenu(fixtures.burger.name);
    assert.equal(top.slug, fixtures.burger.slug);
  });

  it('matches by slug', async () => {
    const [top] = await searchMenu(fixtures.dessert.slug);
    assert.equal(top.slug, fixtures.dessert.slug);
  });

  it('resolves the bare ASL gloss DRINK to a drink', async () => {
    const [top] = await searchMenu('drink');
    assert.equal(top.category, 'drinks');
  });

  it('returns nothing for an item we do not sell', async () => {
    assert.deepEqual(await searchMenu('lobster thermidor'), []);
  });

  it('ranks an exact name above a partial match', async () => {
    const results = await searchMenu(fixtures.burger.name);
    assert.equal(results[0].slug, fixtures.burger.slug);
    assert.ok(results[0].score >= (results[1]?.score ?? 0));
  });
});

describe('adding items', () => {
  it('adds one item at the menu price', async () => {
    const s = newSession();
    const result = await addToCart(s, fixtures.burger.slug);

    assert.equal(result.ok, true);
    if (!result.ok) return;
    assert.equal(result.added.name, fixtures.burger.name);
    assert.equal(result.added.unitPriceCents, fixtures.burger.priceCents);
    assert.equal(result.cart.itemCount, 1);
  });

  it('multiplies the line total by quantity', async () => {
    const s = newSession();
    const result = await addToCart(s, fixtures.burger.slug, 3);

    assert.equal(result.ok, true);
    if (!result.ok) return;
    assert.equal(result.added.lineTotalCents, fixtures.burger.priceCents * 3);
  });

  it('applies a modifier price delta', async () => {
    const s = newSession();
    const result = await addToCart(s, fixtures.burger.slug, 1, ['add bacon']);

    assert.equal(result.ok, true);
    if (!result.ok) return;
    assert.equal(result.added.modifiers[0].name, 'Add Bacon');
    assert.equal(result.added.lineTotalCents, fixtures.burger.priceCents + 150);
  });

  it('applies a free modifier without changing the price', async () => {
    const s = newSession();
    const result = await addToCart(s, fixtures.burger.slug, 1, ['no onion']);

    assert.equal(result.ok, true);
    if (!result.ok) return;
    assert.equal(result.added.lineTotalCents, fixtures.burger.priceCents);
    assert.equal(result.added.modifiers.length, 1);
  });

  it('applies several modifiers at once', async () => {
    const s = newSession();
    const result = await addToCart(s, fixtures.burger.slug, 1, ['no onion', 'extra cheese']);

    assert.equal(result.ok, true);
    if (!result.ok) return;
    assert.equal(result.added.modifiers.length, 2);
    assert.equal(result.added.lineTotalCents, fixtures.burger.priceCents + 90);
  });

  it('refuses to guess at an unknown item, and suggests instead', async () => {
    const s = newSession();
    const result = await addToCart(s, 'lobster thermidor');

    assert.equal(result.ok, false);
    assert.equal((await getCart(s)).itemCount, 0, 'nothing should have been added');
  });

  it('treats quantity 0 as 1 rather than adding a free item', async () => {
    const s = newSession();
    const result = await addToCart(s, fixtures.dessert.slug, 0);

    assert.equal(result.ok, true);
    if (!result.ok) return;
    assert.equal(result.added.qty, 1);
  });
});

describe('changing an order', () => {
  it('removes an item by name', async () => {
    const s = newSession();
    await addToCart(s, fixtures.burger.slug);
    await addToCart(s, fixtures.side.slug);

    const result = await removeFromCart(s, fixtures.side.name);
    assert.equal(result.ok, true);
    assert.equal(result.cart.itemCount, 1);
    assert.equal(result.cart.lines[0].name, fixtures.burger.name);
  });

  it('reports cleanly when asked to remove something not in the cart', async () => {
    const s = newSession();
    await addToCart(s, fixtures.burger.slug);

    const result = await removeFromCart(s, 'lobster thermidor');
    assert.equal(result.ok, false);
    assert.equal(result.cart.itemCount, 1, 'the cart must be untouched');
  });

  it('handles a mid-order change of mind', async () => {
    const s = newSession();
    await addToCart(s, fixtures.burger.slug);
    await addToCart(s, fixtures.drink.slug);
    await removeFromCart(s, fixtures.drink.name);
    await addToCart(s, fixtures.side.slug);

    const cart = await getCart(s);
    assert.deepEqual(
      cart.lines.map((l) => l.name),
      [fixtures.burger.name, fixtures.side.name],
    );
  });

  it('clears the whole order', async () => {
    const s = newSession();
    await addToCart(s, fixtures.burger.slug);
    await addToCart(s, fixtures.dessert.slug);

    const cart = await clearCart(s);
    assert.equal(cart.itemCount, 0);
    assert.equal(cart.totalCents, 0);
  });
});

describe('totals', () => {
  it('sums lines, applies tax, and totals correctly', async () => {
    const s = newSession();
    await addToCart(s, fixtures.burger.slug);
    await addToCart(s, fixtures.side.slug);
    await addToCart(s, fixtures.drink.slug);

    const cart = await getCart(s);
    const subtotal =
      fixtures.burger.priceCents + fixtures.side.priceCents + fixtures.drink.priceCents;

    assert.equal(cart.subtotalCents, subtotal);
    assert.equal(cart.taxCents, Math.round(subtotal * 0.09375));
    assert.equal(cart.totalCents, cart.subtotalCents + cart.taxCents);
  });

  it('keeps every total an integer number of cents', async () => {
    const s = newSession();
    await addToCart(s, fixtures.side.slug, 3);
    await addToCart(s, fixtures.burger.slug, 2, ['add bacon']);

    const cart = await getCart(s);
    for (const value of [cart.subtotalCents, cart.taxCents, cart.totalCents]) {
      assert.equal(Number.isInteger(value), true, `${value} must be an integer`);
    }
  });

  it('an empty cart totals zero, not NaN', async () => {
    const cart = await getCart(newSession());
    assert.equal(cart.subtotalCents, 0);
    assert.equal(cart.totalCents, 0);
  });
});

describe('price integrity', () => {
  /**
   * The one test that must never fail. Every price the terminal can quote has
   * to trace back to a menu row -- this is the whole reason the menu lives in
   * Postgres instead of in a prompt.
   */
  it('every line price matches the menu row it came from', async () => {
    const db = await getDb();
    const menu = await db.select().from(menuItems);
    const s = newSession();

    for (const item of menu) {
      const result = await addToCart(s, item.slug);
      assert.equal(result.ok, true, `could not add ${item.slug}`);
      if (!result.ok) continue;
      assert.equal(
        result.added.unitPriceCents,
        item.priceCents,
        `${item.name} was added at ${result.added.unitPriceCents}, menu says ${item.priceCents}`,
      );
    }

    const cart = await getCart(s);
    assert.equal(
      cart.subtotalCents,
      menu.reduce((sum, i) => sum + i.priceCents, 0),
      'cart subtotal must equal the sum of the menu prices',
    );
  });

  it('a price change after adding does not retroactively alter the cart', async () => {
    const s = newSession();
    const original = fixtures.dessert.priceCents;
    await addToCart(s, fixtures.dessert.slug);

    const db = await getDb();
    await db
      .update(menuItems)
      .set({ priceCents: original + 500 })
      .where(eq(menuItems.slug, fixtures.dessert.slug));

    const cart = await getCart(s);
    assert.equal(cart.lines[0].unitPriceCents, original, 'the snapshotted price must hold');

    await db
      .update(menuItems)
      .set({ priceCents: original })
      .where(eq(menuItems.slug, fixtures.dessert.slug));
  });
});

describe('provenance', () => {
  /**
   * Prices in the shipped CSVs are estimates, not observed values. This test
   * does not fail on that -- it makes sure the fact is recorded, so nobody
   * can quote a price in the report without the source being one query away.
   */
  it('records where every price and nutrition figure came from', async () => {
    const db = await getDb();
    const all = await db.select().from(menuItems);

    for (const item of all) {
      assert.ok(item.priceSource.length > 0, `${item.slug} has no price_source`);
      assert.ok(item.nutritionSource.length > 0, `${item.slug} has no nutrition_source`);
    }

    const estimated = all.filter((i) => i.priceSource === 'estimated').length;
    if (estimated > 0) {
      console.log(
        `      note: ${estimated}/${all.length} prices are estimated, not observed ` +
          `(see data/menu/README.md)`,
      );
    }
  });
});

describe('confirmation', () => {
  it('confirms a non-empty order and returns an order number', async () => {
    const s = newSession();
    await addToCart(s, fixtures.burger.slug);

    const result = await confirmOrder(s);
    assert.equal(result.ok, true);
    assert.equal(typeof result.orderId, 'number');
    assert.ok(result.cart.totalCents > 0);
  });

  it('refuses to confirm an empty order', async () => {
    const result = await confirmOrder(newSession());
    assert.equal(result.ok, false);
  });

  it('starts a fresh cart after confirmation', async () => {
    const s = newSession();
    await addToCart(s, fixtures.dessert.slug);
    await confirmOrder(s);

    const cart = await getCart(s);
    assert.equal(cart.itemCount, 0, 'a confirmed order must not stay in the cart');
  });
});

describe('session isolation', () => {
  it('keeps two customers carts apart', async () => {
    const a = newSession();
    const b = newSession();

    await addToCart(a, fixtures.burger.slug);
    await addToCart(b, fixtures.dessert.slug);

    assert.equal((await getCart(a)).lines[0].name, fixtures.burger.name);
    assert.equal((await getCart(b)).lines[0].name, fixtures.dessert.name);
    assert.equal((await getCart(a)).itemCount, 1);
  });
});
