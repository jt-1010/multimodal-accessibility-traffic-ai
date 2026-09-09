/**
 * Build the served menu from a published nutrition dataset.
 *
 * Source: TidyTuesday 2018-09-04 "Fast Food Calories", derived from the
 * fastfood dataset in the openintro R package (CC0). 515 real menu items
 * across 8 US chains, with measured nutrition per item.
 *   https://github.com/rfordatascience/tidytuesday/tree/master/data/2018/2018-09-04
 *
 * WHAT IS REAL AND WHAT IS NOT
 *
 *   item name   real, from the dataset
 *   calories    real, from the dataset
 *   protein     real, from the dataset
 *   category    derived here by keyword, so it is our inference
 *   price       NOT REAL. The dataset carries no prices, and there is no
 *               open dataset of fast-food prices. Every price below is an
 *               estimate and is tagged price_source=estimated so it can be
 *               found and replaced. Replace before quoting any of this in
 *               the report.
 *
 * Run once, then hand-edit data/menu/menu.csv. That CSV is the menu; this
 * script only bootstraps it.
 *
 *   node scripts/build-menu.mjs [ChainName]
 */
import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';

const CHAIN = process.argv[2] ?? 'Mcdonalds';
const SRC = path.join('data', 'menu', 'fastfood_nutrition.csv');
const OUT = path.join('data', 'menu', 'menu.csv');

/** Minimal RFC-4180 parser: the source file quotes fields and we must respect it. */
function parseCsv(text) {
  const rows = [];
  let row = [];
  let field = '';
  let quoted = false;

  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (quoted) {
      if (c === '"') {
        if (text[i + 1] === '"') {
          field += '"';
          i++;
        } else quoted = false;
      } else field += c;
    } else if (c === '"') quoted = true;
    else if (c === ',') {
      row.push(field);
      field = '';
    } else if (c === '\n') {
      row.push(field);
      rows.push(row);
      row = [];
      field = '';
    } else if (c !== '\r') field += c;
  }
  if (field || row.length) {
    row.push(field);
    rows.push(row);
  }

  const header = rows.shift().map((h) => h.trim());
  return rows
    .filter((r) => r.length === header.length)
    .map((r) => Object.fromEntries(header.map((h, i) => [h, r[i]])));
}

/** Order matters: the first pattern that matches wins. */
const CATEGORY_RULES = [
  [/shake|mccafe|smoothie|frapp|sundae|cone|mcflurry|pie|cookie/i, 'desserts'],
  [/salad/i, 'salads'],
  [/biscuit|mcgriddle|mcmuffin|hotcake|burrito|breakfast|sausage.*egg|egg.*sausage/i, 'breakfast'],
  [/fries|hash brown|apple slices|mozzarella|nugget|onion ring/i, 'sides'],
  [/chicken|mcchicken|filet|fish|club/i, 'chicken'],
  [/burger|mac|quarter pounder|cheeseburger|hamburger|slider/i, 'burgers'],
  [/coffee|soda|coke|drink|juice|milk|water|tea|latte|mocha/i, 'drinks'],
];

function categorize(item) {
  for (const [re, category] of CATEGORY_RULES) if (re.test(item)) return category;
  return 'other';
}

/**
 * Estimated prices, by category and portion size.
 *
 * A crude heuristic on purpose: it is obviously a placeholder rather than
 * something that might be mistaken for sourced data. Calories stand in for
 * portion size, which is roughly how fast-food pricing tiers work.
 */
const BASE_CENTS = {
  burgers: 549,
  chicken: 599,
  sides: 229,
  drinks: 169,
  desserts: 249,
  salads: 549,
  breakfast: 399,
  other: 399,
};

function estimatePrice(category, calories) {
  const base = BASE_CENTS[category] ?? 399;
  const bump = Math.min(400, Math.max(0, Math.round(((calories - 300) / 100) * 40)));
  return Math.round((base + bump) / 10) * 10 - 1; // land on a .x9 price
}

function slugify(name) {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 60);
}

/**
 * Search aliases: the casual words and ASL glosses a person actually uses.
 * "burger" has to find "Big Mac"; the sign for DRINK has to find a drink.
 */
function aliasesFor(name, category) {
  const set = new Set();
  const lower = name.toLowerCase();

  const CATEGORY_ALIASES = {
    burgers: ['burger'],
    chicken: ['chicken'],
    sides: ['side'],
    drinks: ['drink', 'soda'],
    desserts: ['dessert', 'sweet'],
    salads: ['salad'],
    breakfast: ['breakfast'],
  };
  for (const a of CATEGORY_ALIASES[category] ?? []) set.add(a);

  for (const word of ['fries', 'nugget', 'shake', 'coffee', 'cheese', 'bacon', 'fish', 'egg']) {
    if (lower.includes(word)) set.add(word);
  }
  return [...set].join('|');
}

const rows = parseCsv(await readFile(SRC, 'utf8')).filter((r) => r.restaurant === CHAIN);
if (rows.length === 0) throw new Error(`No rows for chain "${CHAIN}" in ${SRC}`);

const seen = new Set();
const out = [];

for (const r of rows) {
  const slug = slugify(r.item);
  if (!slug || seen.has(slug)) continue;
  seen.add(slug);

  const calories = Number(r.calories) || 0;
  const category = categorize(r.item);

  out.push({
    slug,
    name: r.item,
    category,
    price_cents: estimatePrice(category, calories),
    price_source: 'estimated',
    calories,
    protein_g: Number(r.protein) || '',
    aliases: aliasesFor(r.item, category),
    nutrition_source: `tidytuesday-2018-09-04:${CHAIN}`,
  });
}

out.sort((a, b) => a.category.localeCompare(b.category) || a.name.localeCompare(b.name));

const header = Object.keys(out[0]);
const csv = [
  header.join(','),
  ...out.map((row) =>
    header.map((h) => (String(row[h]).includes(',') ? `"${row[h]}"` : row[h])).join(','),
  ),
].join('\n');

await writeFile(OUT, csv + '\n');

const byCategory = out.reduce((acc, r) => ({ ...acc, [r.category]: (acc[r.category] ?? 0) + 1 }), {});
console.log(`Wrote ${out.length} items from ${CHAIN} to ${OUT}`);
console.log('By category:', byCategory);
console.log('\nPrices are ESTIMATED. Replace them in the CSV before citing any of this.');
