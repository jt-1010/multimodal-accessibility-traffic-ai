import { getDb } from './index';
import { menuItems, modifiers } from './schema';

/**
 * A plausible fast-food menu.
 *
 * `aliases` matter more than they look: they carry the ASL glosses and the
 * casual names a person actually uses. The sign for "drink" or "milk" has to
 * resolve to a real row, and someone saying "coke" must not miss a row named
 * "Fountain Soda". Search hits name + aliases, so this is the layer that
 * absorbs the gap between how people refer to food and how the menu spells it.
 */
const ITEMS: [string, string, string, string, number, number, string[]][] = [
  // --- Burgers ---
  ['classic-burger', 'Classic Burger', 'Quarter-pound beef patty, lettuce, tomato, pickles', 'burgers', 599, 540, ['burger', 'hamburger', 'beef']],
  ['cheeseburger', 'Cheeseburger', 'Classic burger with American cheese', 'burgers', 649, 610, ['cheese burger', 'cheese']],
  ['double-burger', 'Double Burger', 'Two patties, two slices of cheese', 'burgers', 899, 880, ['double', 'big burger']],
  ['bacon-burger', 'Bacon Burger', 'Beef patty, smoked bacon, cheddar', 'burgers', 849, 790, ['bacon']],
  ['veggie-burger', 'Veggie Burger', 'Plant-based patty, lettuce, tomato', 'burgers', 749, 470, ['vegetarian', 'veggie', 'plant']],
  // --- Chicken ---
  ['crispy-chicken', 'Crispy Chicken Sandwich', 'Breaded chicken breast, pickles, mayo', 'chicken', 699, 620, ['chicken', 'chicken sandwich']],
  ['grilled-chicken', 'Grilled Chicken Sandwich', 'Marinated grilled breast, lettuce, tomato', 'chicken', 749, 450, ['grilled chicken', 'healthy chicken']],
  ['chicken-nuggets-6', 'Chicken Nuggets (6 pc)', 'Six breaded white-meat nuggets', 'chicken', 449, 270, ['nuggets', 'nugget', 'six piece']],
  ['chicken-nuggets-10', 'Chicken Nuggets (10 pc)', 'Ten breaded white-meat nuggets', 'chicken', 649, 450, ['nuggets', 'ten piece', 'big nuggets']],
  ['spicy-chicken', 'Spicy Chicken Sandwich', 'Nashville-style hot chicken, slaw', 'chicken', 749, 660, ['spicy', 'hot chicken']],
  // --- Sides ---
  ['fries-small', 'Small Fries', 'Golden salted fries', 'sides', 249, 230, ['fries', 'small fries', 'chips']],
  ['fries-medium', 'Medium Fries', 'Golden salted fries', 'sides', 329, 340, ['fries', 'medium fries']],
  ['fries-large', 'Large Fries', 'Golden salted fries', 'sides', 399, 490, ['fries', 'big fries', 'large fries']],
  ['onion-rings', 'Onion Rings', 'Beer-battered, crispy', 'sides', 379, 410, ['rings', 'onion']],
  ['side-salad', 'Side Salad', 'Mixed greens, cherry tomato, vinaigrette', 'sides', 349, 120, ['salad', 'greens', 'vegetable']],
  ['apple-slices', 'Apple Slices', 'Fresh cut apple', 'sides', 179, 35, ['apple', 'fruit']],
  ['mozzarella-sticks', 'Mozzarella Sticks', 'Four sticks, marinara dip', 'sides', 449, 380, ['cheese sticks', 'mozzarella']],
  // --- Drinks ---
  ['soda-small', 'Small Soft Drink', 'Your choice of fountain soda', 'drinks', 179, 150, ['drink', 'soda', 'coke', 'pop', 'small drink']],
  ['soda-medium', 'Medium Soft Drink', 'Your choice of fountain soda', 'drinks', 219, 210, ['drink', 'soda', 'coke', 'medium drink']],
  ['soda-large', 'Large Soft Drink', 'Your choice of fountain soda', 'drinks', 259, 300, ['drink', 'soda', 'coke', 'big drink', 'large drink']],
  ['water', 'Bottled Water', '500ml still water', 'drinks', 199, 0, ['water', 'still']],
  ['milk', 'Milk', 'Cold 2% milk', 'drinks', 189, 120, ['milk', 'white milk']],
  ['chocolate-milk', 'Chocolate Milk', 'Cold chocolate milk', 'drinks', 209, 190, ['chocolate milk', 'chocolate']],
  ['orange-juice', 'Orange Juice', 'Not-from-concentrate OJ', 'drinks', 269, 160, ['juice', 'orange', 'oj']],
  ['coffee', 'Coffee', 'Freshly brewed, hot', 'drinks', 199, 5, ['coffee', 'hot coffee']],
  ['iced-coffee', 'Iced Coffee', 'Cold brew over ice', 'drinks', 279, 90, ['iced coffee', 'cold coffee']],
  // --- Desserts ---
  ['vanilla-cone', 'Vanilla Cone', 'Soft-serve vanilla', 'desserts', 199, 200, ['ice cream', 'cone', 'vanilla']],
  ['chocolate-shake', 'Chocolate Shake', 'Thick chocolate milkshake', 'desserts', 429, 530, ['shake', 'milkshake', 'chocolate shake']],
  ['strawberry-shake', 'Strawberry Shake', 'Thick strawberry milkshake', 'desserts', 429, 510, ['shake', 'strawberry']],
  ['cookie', 'Chocolate Chip Cookie', 'Warm, baked in house', 'desserts', 159, 230, ['cookie', 'chocolate chip']],
  ['apple-pie', 'Apple Pie', 'Warm hand pie, cinnamon apple', 'desserts', 229, 320, ['pie', 'apple pie']],
  // --- Combos ---
  ['combo-classic', 'Classic Burger Combo', 'Classic burger, medium fries, medium drink', 'combos', 999, 1090, ['combo', 'meal', 'burger combo']],
  ['combo-chicken', 'Crispy Chicken Combo', 'Crispy chicken sandwich, medium fries, medium drink', 'combos', 1099, 1170, ['combo', 'chicken combo', 'chicken meal']],
  ['combo-nuggets', 'Nuggets Combo', '10 pc nuggets, medium fries, medium drink', 'combos', 1049, 1000, ['combo', 'nugget combo', 'nugget meal']],
  ['kids-meal', 'Kids Meal', '4 pc nuggets, apple slices, small milk', 'combos', 649, 425, ['kids', 'child', 'kid meal']],
];

const MODIFIERS: [string, string, number, string[], string[]][] = [
  ['no-onion', 'No Onion', 0, ['burgers', 'chicken'], ['no onion', 'without onion']],
  ['no-pickle', 'No Pickles', 0, ['burgers', 'chicken'], ['no pickle', 'without pickles']],
  ['no-cheese', 'No Cheese', -30, ['burgers', 'chicken'], ['no cheese', 'without cheese']],
  ['no-mayo', 'No Mayo', 0, ['burgers', 'chicken'], ['no mayo', 'no sauce']],
  ['extra-cheese', 'Extra Cheese', 90, ['burgers', 'chicken'], ['extra cheese', 'more cheese']],
  ['add-bacon', 'Add Bacon', 150, ['burgers', 'chicken'], ['bacon', 'add bacon']],
  ['no-salt', 'No Salt', 0, ['sides'], ['no salt', 'unsalted']],
  ['no-ice', 'No Ice', 0, ['drinks'], ['no ice', 'without ice']],
  ['extra-ice', 'Extra Ice', 0, ['drinks'], ['extra ice', 'more ice']],
  ['gluten-free-bun', 'Gluten-Free Bun', 120, ['burgers', 'chicken'], ['gluten free', 'gf bun']],
];

export async function seed() {
  const db = await getDb();

  const existing = await db.select().from(menuItems).limit(1);
  if (existing.length > 0) {
    console.log('Menu already seeded - skipping.');
    return;
  }

  await db.insert(menuItems).values(
    ITEMS.map(([slug, name, description, category, priceCents, calories, aliases]) => ({
      slug,
      name,
      description,
      category,
      priceCents,
      calories,
      aliases,
    })),
  );

  await db.insert(modifiers).values(
    MODIFIERS.map(([slug, name, priceDeltaCents, appliesTo, aliases]) => ({
      slug,
      name,
      priceDeltaCents,
      appliesTo,
      aliases,
    })),
  );

  console.log(`Seeded ${ITEMS.length} menu items and ${MODIFIERS.length} modifiers.`);
}

// Only when run directly (`npm run db:seed`), never on import -- the test
// suite imports `seed` and must control when it runs.
if (process.argv[1]?.endsWith('seed.ts')) {
  seed().then(() => process.exit(0));
}
