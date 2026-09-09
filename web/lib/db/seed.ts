import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { getDb } from './index';
import { menuItems, modifiers } from './schema';

/**
 * Load the menu from CSV.
 *
 * The menu is data, not code. Item names, calories and protein come from a
 * published dataset (TidyTuesday 2018-09-04, from the openintro R package);
 * prices do not, because no open dataset of fast-food prices exists. Each row
 * carries its own provenance into the database so the distinction survives
 * into anything we report.
 *
 * See data/menu/README.md. To change the menu, edit the CSVs.
 */

const DATA_DIR = path.join(process.cwd(), '..', 'data', 'menu');
const MENU_FILES = ['menu.csv', 'extras.csv'];

type MenuRow = {
  slug: string;
  name: string;
  category: string;
  price_cents: string;
  price_source: string;
  calories: string;
  protein_g: string;
  aliases: string;
  nutrition_source: string;
  image_url?: string;
  image_source?: string;
};

/** Minimal RFC-4180 parser. Item names contain commas, so quotes must be honoured. */
function parseCsv(text: string): Record<string, string>[] {
  const rows: string[][] = [];
  let row: string[] = [];
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

  const header = rows.shift()!.map((h) => h.trim());
  return rows
    .filter((r) => r.length === header.length && r.some((v) => v !== ''))
    .map((r) => Object.fromEntries(header.map((h, i) => [h, r[i]])));
}

async function loadMenuRows(): Promise<MenuRow[]> {
  const all: MenuRow[] = [];
  for (const file of MENU_FILES) {
    const full = path.join(DATA_DIR, file);
    try {
      all.push(...(parseCsv(await readFile(full, 'utf8')) as MenuRow[]));
    } catch (err) {
      // Loud, not silent. A half-loaded menu is worse than no menu: the
      // assistant would confidently tell someone we do not sell fries.
      throw new Error(
        `Could not read ${full}. Run \`node scripts/build-menu.mjs\` from the repo root first. (${
          err instanceof Error ? err.message : String(err)
        })`,
      );
    }
  }
  return all;
}

/** Modifiers are genuinely ours: no dataset describes "no onion". */
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

export async function seed({ force = false } = {}) {
  const db = await getDb();

  const existing = await db.select().from(menuItems).limit(1);
  if (existing.length > 0 && !force) {
    console.log('Menu already seeded - skipping. Pass --force to reload from CSV.');
    return;
  }
  if (force) {
    await db.delete(menuItems);
    await db.delete(modifiers);
  }

  const rows = await loadMenuRows();
  const seen = new Set<string>();

  const values = rows
    .filter((r) => r.slug && !seen.has(r.slug) && seen.add(r.slug))
    .map((r) => ({
      slug: r.slug,
      name: r.name,
      description: '',
      category: r.category || 'other',
      priceCents: Number(r.price_cents) || 0,
      calories: r.calories ? Number(r.calories) : null,
      proteinG: r.protein_g ? Number(r.protein_g) : null,
      aliases: r.aliases ? r.aliases.split('|').filter(Boolean) : [],
      priceSource: r.price_source || 'estimated',
      nutritionSource: r.nutrition_source || '',
      imageUrl: r.image_url || null,
      imageSource: r.image_source || '',
    }));

  await db.insert(menuItems).values(values);
  await db.insert(modifiers).values(
    MODIFIERS.map(([slug, name, priceDeltaCents, appliesTo, aliases]) => ({
      slug,
      name,
      priceDeltaCents,
      appliesTo,
      aliases,
    })),
  );

  const estimated = values.filter((v) => v.priceSource === 'estimated').length;
  const withPhoto = values.filter((v) => v.imageUrl).length;
  console.log(`Seeded ${values.length} menu items and ${MODIFIERS.length} modifiers.`);
  console.log(`  ${withPhoto}/${values.length} have a photo.`);
  if (estimated > 0) {
    console.log(
      `  ${estimated}/${values.length} prices are ESTIMATED, not observed. ` +
        `See data/menu/README.md before citing any of them.`,
    );
  }
}

if (process.argv[1]?.endsWith('seed.ts')) {
  seed({ force: process.argv.includes('--force') }).then(() => process.exit(0));
}
