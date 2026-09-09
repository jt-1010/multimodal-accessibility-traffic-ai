/**
 * Attach photos to menu items from the Fast Food Classification Dataset (V2).
 *
 *   https://www.kaggle.com/datasets/utkarshsaxenadn/fast-food-classification-dataset
 *   ~20k images, CC0, 10 classes:
 *     Baked Potato, Burger, Crispy Chicken, Donut, Fries,
 *     Hot Dog, Pizza, Sandwich, Taco, Taquito
 *
 * WHAT THE PHOTOS ARE
 *
 * Illustrative, not literal. The dataset labels categories, not products, so
 * it has no photograph of a Big Mac -- only photographs of burgers. Each menu
 * item gets its OWN burger rather than all thirteen sharing one, because a
 * grid of identical thumbnails is useless for telling items apart, but nobody
 * should read these as pictures of the specific product.
 *
 * Assignment is deterministic: items are sorted within their class and dealt
 * images in order, so re-running produces the same result and diffs stay clean.
 *
 * WHAT THIS DATASET CANNOT DO
 *
 * It cannot read a customer's request -- those arrive as ASL glosses or text,
 * never as images. Understanding requests belongs to the sign classifier and
 * the LLM, not here.
 *
 * SETUP (needs a Kaggle API token at ~/.kaggle/kaggle.json)
 *
 *   npm run data:images
 */
import { readdir, mkdir, copyFile, readFile, writeFile, stat, rm } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import path from 'node:path';

const SRC_ROOT = path.join('data', 'food-images');
const PUBLIC_DIR = path.join('web', 'public', 'menu-images');
const MENU_CSV = path.join('data', 'menu', 'menu.csv');
const EXTRAS_CSV = path.join('data', 'menu', 'extras.csv');

/**
 * Usable file-size window.
 *
 * Both ends matter. Below the floor are thumbnails and corrupt stubs. Above
 * the ceiling, in a scraped dataset, are mostly promotional posters, logos and
 * text banners -- graphics with flat colour and lettering compress differently
 * from photographs, so "biggest file" selects for exactly the images you do
 * not want. Sorting by size descending picked a poster of a Big Mac box
 * instead of a burger.
 */
const MIN_BYTES = 6_000;
const MAX_BYTES = 90_000;

/**
 * Dataset class -> the words in our item names that should use that photo.
 * Checked in order, so the specific ones come first: "Crispy Chicken" has to
 * win over "Sandwich" for a Crispy Chicken Sandwich.
 */
const CLASS_KEYWORDS = [
  ['Crispy Chicken', [/crispy chicken/i, /chicken.*(sandwich|filet)/i, /mcchicken/i, /nugget/i, /tender/i]],
  ['Burger', [/burger/i, /big mac/i, /quarter pounder/i, /\bmac\b/i, /mcdouble/i, /mcrib/i]],
  ['Fries', [/fries/i, /hash brown/i]],
  ['Baked Potato', [/potato/i]],
  // Baked goods only. A donut photo on a McFlurry or a sundae is a picture of
  // the wrong food, and for someone reading the image instead of the name that
  // is worse than no picture at all.
  ['Donut', [/donut|doughnut/i, /\bpie\b/i, /cookie/i]],
  // Deliberately NOT /salad/: the Sandwich class contains sandwiches, and
  // putting one on a salad would actively mislead.
  ['Sandwich', [/sandwich/i, /\bclub\b/i, /wrap/i, /filet-o-fish/i]],
  ['Hot Dog', [/hot ?dog/i]],
  ['Pizza', [/pizza/i]],
  ['Taco', [/taco(?!uito)/i]],
  ['Taquito', [/taquito/i]],
];

function classFor(itemName) {
  for (const [cls, patterns] of CLASS_KEYWORDS) {
    if (patterns.some((re) => re.test(itemName))) return cls;
  }
  return null;
}

/** Find class directories case-insensitively; the zip nests Train/Valid/Test. */
async function findClassDirs(root) {
  const found = new Map();

  async function walk(dir, depth) {
    if (depth > 3) return;
    let entries;
    try {
      entries = await readdir(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const e of entries) {
      if (!e.isDirectory()) continue;
      const full = path.join(dir, e.name);
      const match = CLASS_KEYWORDS.find(
        ([cls]) => cls.toLowerCase() === e.name.toLowerCase().replace(/_/g, ' '),
      );
      // Prefer the directory with the most images (usually Train).
      if (match) {
        const count = (await readdir(full)).length;
        const prev = found.get(match[0]);
        if (!prev || count > prev.count) found.set(match[0], { dir: full, count });
      } else {
        await walk(full, depth + 1);
      }
    }
  }

  await walk(root, 0);
  return found;
}

function parseCsv(text) {
  const lines = text.trim().split('\n');
  const header = lines.shift().split(',');
  return { header, rows: lines.map((l) => l.split(/,(?=(?:[^"]*"[^"]*")*[^"]*$)/)) };
}

if (!existsSync(SRC_ROOT)) {
  console.error(`Dataset not found at ${SRC_ROOT}.`);
  console.error('Run: npm run data:images');
  process.exit(1);
}

const classDirs = await findClassDirs(SRC_ROOT);
if (classDirs.size === 0) {
  console.error(`No recognised class folders under ${SRC_ROOT}.`);
  process.exit(1);
}
console.log(`Found ${classDirs.size} classes: ${[...classDirs.keys()].join(', ')}`);

// --- build a usable image pool per class ---------------------------------
const pools = new Map();
for (const [cls, { dir }] of classDirs) {
  const names = (await readdir(dir)).filter((f) => /\.(jpe?g|png|webp)$/i.test(f));
  const sized = [];
  for (const n of names) {
    const { size } = await stat(path.join(dir, n));
    if (size >= MIN_BYTES && size <= MAX_BYTES) sized.push({ name: n, size });
  }
  // Alphabetical: stable across machines and reruns, and uncorrelated with
  // content, so we are not selecting for any particular kind of image.
  sized.sort((a, b) => a.name.localeCompare(b.name));
  pools.set(cls, { dir, files: sized });
  console.log(`  ${cls}: ${names.length} images, ${sized.length} usable`);
}

// --- read the menus, group items by class --------------------------------
const files = [MENU_CSV, EXTRAS_CSV];
const parsed = new Map();
const byClass = new Map();

for (const csvPath of files) {
  const { header, rows } = parseCsv(await readFile(csvPath, 'utf8'));
  for (const key of ['image_url', 'image_source']) {
    if (!header.includes(key)) header.push(key);
  }
  const nameIdx = header.indexOf('name');
  const slugIdx = header.indexOf('slug');

  for (const row of rows) {
    while (row.length < header.length) row.push('');

    // Clear first, then re-assign below. Without this, an item that matched a
    // class on a previous run but no longer does keeps a stale URL pointing at
    // a file this run just deleted -- a broken image on the menu.
    row[header.indexOf('image_url')] = '';
    row[header.indexOf('image_source')] = '';

    const cls = classFor(row[nameIdx] ?? '');
    if (!cls) continue;
    if (!byClass.has(cls)) byClass.set(cls, []);
    byClass.get(cls).push({ row, header, slug: row[slugIdx], name: row[nameIdx] });
  }
  parsed.set(csvPath, { header, rows });
}

// --- deal each item its own image ----------------------------------------
await rm(PUBLIC_DIR, { recursive: true, force: true });
await mkdir(PUBLIC_DIR, { recursive: true });

let assigned = 0;
const unmatched = [];

for (const [cls, items] of byClass) {
  const pool = pools.get(cls);
  if (!pool || pool.files.length === 0) {
    unmatched.push(...items.map((i) => i.name));
    continue;
  }

  // Stable order in, stable images out.
  items.sort((a, b) => a.slug.localeCompare(b.slug));

  // Spread picks across the whole pool rather than taking a contiguous run --
  // scraped folders tend to be clustered, so neighbouring files are often near
  // duplicates of each other.
  const stride = Math.max(1, Math.floor(pool.files.length / Math.max(1, items.length)));

  for (let i = 0; i < items.length; i++) {
    const { row, header, slug } = items[i];
    const pick = pool.files[(i * stride) % pool.files.length];
    const ext = path.extname(pick.name).toLowerCase();
    const dest = `${slug}${ext}`;

    await copyFile(path.join(pool.dir, pick.name), path.join(PUBLIC_DIR, dest));
    row[header.indexOf('image_url')] = `/menu-images/${dest}`;
    row[header.indexOf('image_source')] = `kaggle-fastfood-v2:${cls}`;
    assigned++;
  }

  const reused = Math.max(0, items.length - pool.files.length);
  console.log(
    `  ${cls}: ${items.length} items -> ${items.length - reused} distinct photos` +
      (reused ? ` (${reused} reused, pool exhausted)` : ''),
  );
}

for (const [csvPath, { header, rows }] of parsed) {
  await writeFile(csvPath, [header.join(','), ...rows.map((r) => r.join(','))].join('\n') + '\n');
}

console.log(`\nAssigned ${assigned} items a photo of their own.`);
if (unmatched.length) {
  console.log(`No class matches ${unmatched.length} items:`);
  console.log('  ' + unmatched.slice(0, 10).join(', ') + (unmatched.length > 10 ? ' …' : ''));
}
console.log('\nPhotos are illustrative, not photographs of the actual products.');
console.log('Next: stop the dev server, then npm --prefix web run db:seed -- --force');
