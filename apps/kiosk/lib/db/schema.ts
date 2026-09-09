import {
  pgTable,
  serial,
  text,
  integer,
  boolean,
  timestamp,
  jsonb,
  index,
} from 'drizzle-orm/pg-core';

/**
 * Money is stored as integer cents everywhere. Never floats.
 *
 * `0.1 + 0.2 !== 0.3` in IEEE-754, and a kiosk that is a penny off on a
 * six-item order is a kiosk that loses an audit. Cents in, cents out,
 * format to dollars only at the last moment in the UI.
 */

export const menuItems = pgTable(
  'menu_items',
  {
    id: serial('id').primaryKey(),
    slug: text('slug').notNull().unique(),
    name: text('name').notNull(),
    description: text('description').notNull().default(''),
    category: text('category').notNull(),
    priceCents: integer('price_cents').notNull(),
    calories: integer('calories'),
    /** Lowercase search aliases, incl. the ASL glosses that map to this item. */
    aliases: jsonb('aliases').$type<string[]>().notNull().default([]),
    available: boolean('available').notNull().default(true),
  },
  (t) => [index('menu_items_category_idx').on(t.category)],
);

export const modifiers = pgTable('modifiers', {
  id: serial('id').primaryKey(),
  slug: text('slug').notNull().unique(),
  name: text('name').notNull(),
  /** Signed: +150 for "add bacon", 0 for "no onion", -50 for a downsize. */
  priceDeltaCents: integer('price_delta_cents').notNull().default(0),
  /** Categories this modifier can apply to. Empty = applies to anything. */
  appliesTo: jsonb('applies_to').$type<string[]>().notNull().default([]),
  aliases: jsonb('aliases').$type<string[]>().notNull().default([]),
});

/**
 * A cart IS an order with status 'cart'. Keeping the in-progress cart in the
 * same table as the completed order means the agent's tools read and write the
 * same rows the receipt is generated from, so there is no second source of
 * truth to drift out of sync.
 */
export const orders = pgTable(
  'orders',
  {
    id: serial('id').primaryKey(),
    sessionId: text('session_id').notNull(),
    status: text('status', { enum: ['cart', 'confirmed', 'abandoned'] })
      .notNull()
      .default('cart'),
    createdAt: timestamp('created_at').notNull().defaultNow(),
    confirmedAt: timestamp('confirmed_at'),
  },
  (t) => [index('orders_session_idx').on(t.sessionId, t.status)],
);

export const orderItems = pgTable(
  'order_items',
  {
    id: serial('id').primaryKey(),
    orderId: integer('order_id')
      .notNull()
      .references(() => orders.id, { onDelete: 'cascade' }),
    menuItemId: integer('menu_item_id')
      .notNull()
      .references(() => menuItems.id),
    qty: integer('qty').notNull().default(1),
    /** Snapshot of the price at time of add — menu prices may change later. */
    unitPriceCents: integer('unit_price_cents').notNull(),
    modifiers: jsonb('modifiers')
      .$type<{ slug: string; name: string; priceDeltaCents: number }[]>()
      .notNull()
      .default([]),
  },
  (t) => [index('order_items_order_idx').on(t.orderId)],
);

export type MenuItem = typeof menuItems.$inferSelect;
export type Modifier = typeof modifiers.$inferSelect;
export type Order = typeof orders.$inferSelect;
export type OrderItem = typeof orderItems.$inferSelect;
