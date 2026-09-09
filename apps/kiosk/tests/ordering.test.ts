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
import { menuItems } from '@/lib/db/schema';

// Throwaway in-memory database. Safe to set after the imports because the
// data directory is resolved on first connection, not at module load.
process.env.PGLITE_DATA_DIR = 'memory';

/**
 * The ordering fixture suite.
 *
 * Deliberately LLM-free. Every scenario here is a property of the cart layer,
 * so the suite runs in CI in under a second, costs nothing, and gives an
 * unambiguous answer. When the fine-tuned model lands, the same scenarios get
 * replayed THROUGH each backend to compare them -- but a failure here is
 * always our logic, never the model having a bad day.
 */

let counter = 0;
const newSession = () => `test-${Date.now()}-${counter++}`;

before(async () => {
  await seed();
});

describe('menu search', () => {
  it('matches an exact name', async () => {
    const [top] = await searchMenu('Classic Burger');
    assert.equal(top.slug, 'classic-burger');
  });

  it('matches a casual alias', async () => {
    const [top] = await searchMenu('coke');
    assert.equal(top.category, 'drinks');
  });

  it('resolves the bare ASL gloss DRINK to a drink', async () => {
    const [top] = await searchMenu('drink');
    assert.equal(top.category, 'drinks');
  });

  it('returns nothing for an item we do not sell', async () => {
    assert.deepEqual(await searchMenu('sushi'), []);
  });

  it('ranks a whole-name match above a description match', async () => {
    const results = await searchMenu('chicken');
    assert.ok(results[0].name.toLowerCase().includes('chicken'));
  });
});

describe('adding items', () => {
  it('adds one item at the menu price', async () => {
    const s = newSession();
    const result = await addToCart(s, 'classic burger');

    assert.equal(result.ok, true);
    if (!result.ok) return;
    assert.equal(result.added.name, 'Classic Burger');
    assert.equal(result.added.unitPriceCents, 599);
    assert.equal(result.cart.itemCount, 1);
  });

  it('multiplies the line total by quantity', async () => {
    const s = newSession();
    const result = await addToCart(s, 'classic burger', 3);

    assert.equal(result.ok, true);
    if (!result.ok) return;
    assert.equal(result.added.lineTotalCents, 599 * 3);
  });

  it('applies a modifier price delta', async () => {
    const s = newSession();
    const result = await addToCart(s, 'cheeseburger', 1, ['add bacon']);

    assert.equal(result.ok, true);
    if (!result.ok) return;
    assert.equal(result.added.modifiers[0].name, 'Add Bacon');
    assert.equal(result.added.lineTotalCents, 649 + 150);
  });

  it('applies a free modifier without changing the price', async () => {
    const s = newSession();
    const result = await addToCart(s, 'classic burger', 1, ['no onion']);

    assert.equal(result.ok, true);
    if (!result.ok) return;
    assert.equal(result.added.lineTotalCents, 599);
    assert.equal(result.added.modifiers.length, 1);
  });

  it('applies several modifiers at once', async () => {
    const s = newSession();
    const result = await addToCart(s, 'cheeseburger', 1, ['no onion', 'extra cheese']);

    assert.equal(result.ok, true);
    if (!result.ok) return;
    assert.equal(result.added.modifiers.length, 2);
    assert.equal(result.added.lineTotalCents, 649 + 90);
  });

  it('refuses to guess at an unknown item, and suggests instead', async () => {
    const s = newSession();
    const result = await addToCart(s, 'lobster thermidor');

    assert.equal(result.ok, false);
    assert.equal((await getCart(s)).itemCount, 0, 'nothing should have been added');
  });

  it('treats quantity 0 as 1 rather than adding a free item', async () => {
    const s = newSession();
    const result = await addToCart(s, 'cookie', 0);

    assert.equal(result.ok, true);
    if (!result.ok) return;
    assert.equal(result.added.qty, 1);
  });
});

describe('changing an order', () => {
  it('removes an item by name', async () => {
    const s = newSession();
    await addToCart(s, 'classic burger');
    await addToCart(s, 'medium fries');

    const result = await removeFromCart(s, 'fries');
    assert.equal(result.ok, true);
    assert.equal(result.cart.itemCount, 1);
    assert.equal(result.cart.lines[0].name, 'Classic Burger');
  });

  it('reports cleanly when asked to remove something not in the cart', async () => {
    const s = newSession();
    await addToCart(s, 'classic burger');

    const result = await removeFromCart(s, 'onion rings');
    assert.equal(result.ok, false);
    assert.equal(result.cart.itemCount, 1, 'the cart must be untouched');
  });

  it('handles a mid-order change of mind', async () => {
    const s = newSession();
    await addToCart(s, 'classic burger');
    await addToCart(s, 'large fries');
    await removeFromCart(s, 'large fries');
    await addToCart(s, 'small fries');

    const cart = await getCart(s);
    assert.deepEqual(
      cart.lines.map((l) => l.name),
      ['Classic Burger', 'Small Fries'],
    );
  });

  it('clears the whole order', async () => {
    const s = newSession();
    await addToCart(s, 'classic burger');
    await addToCart(s, 'cookie');

    const cart = await clearCart(s);
    assert.equal(cart.itemCount, 0);
    assert.equal(cart.totalCents, 0);
  });
});

describe('totals', () => {
  it('sums lines, applies tax, and totals correctly', async () => {
    const s = newSession();
    await addToCart(s, 'classic burger'); // 599
    await addToCart(s, 'medium fries'); //   329
    await addToCart(s, 'medium drink'); //   219

    const cart = await getCart(s);
    const subtotal = 599 + 329 + 219;

    assert.equal(cart.subtotalCents, subtotal);
    assert.equal(cart.taxCents, Math.round(subtotal * 0.09375));
    assert.equal(cart.totalCents, cart.subtotalCents + cart.taxCents);
  });

  it('keeps every total an integer number of cents', async () => {
    const s = newSession();
    await addToCart(s, 'chicken nuggets', 3);
    await addToCart(s, 'cheeseburger', 2, ['add bacon']);

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
   * The one test that must never fail. Every price the kiosk can quote has to
   * trace back to a menu row -- this is the whole reason the menu lives in
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
    await addToCart(s, 'cookie');

    const db = await getDb();
    await db.update(menuItems).set({ priceCents: 999 }).where(eq(menuItems.slug, 'cookie'));

    const cart = await getCart(s);
    assert.equal(cart.lines[0].unitPriceCents, 159, 'the snapshotted price must hold');

    await db.update(menuItems).set({ priceCents: 159 }).where(eq(menuItems.slug, 'cookie'));
  });
});

describe('confirmation', () => {
  it('confirms a non-empty order and returns an order number', async () => {
    const s = newSession();
    await addToCart(s, 'combo');

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
    await addToCart(s, 'cookie');
    await confirmOrder(s);

    const cart = await getCart(s);
    assert.equal(cart.itemCount, 0, 'a confirmed order must not stay in the cart');
  });
});

describe('session isolation', () => {
  it('keeps two customers carts apart', async () => {
    const a = newSession();
    const b = newSession();

    await addToCart(a, 'classic burger');
    await addToCart(b, 'chocolate shake');

    assert.equal((await getCart(a)).lines[0].name, 'Classic Burger');
    assert.equal((await getCart(b)).lines[0].name, 'Chocolate Shake');
    assert.equal((await getCart(a)).itemCount, 1);
  });
});
