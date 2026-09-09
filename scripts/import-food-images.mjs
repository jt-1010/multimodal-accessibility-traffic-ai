/**
 * Attach photos to menu items from the Fast Food Classification Dataset (V2).
 *
 *   https://www.kaggle.com/datasets/utkarshsaxenadn/fast-food-classification-dataset
 *   ~20k images, 10 classes:
 *     Baked Potato, Burger, Crispy Chicken, Donut, Fries,
 *     Hot Dog, Pizza, Sandwich, Taco, Taquito
 *
 * WHAT THIS DATASET CAN AND CANNOT DO
 *
 * It maps an IMAGE to a food CATEGORY. That is genuinely useful here -- it
 * gives every menu item a real photo, which is the one description that needs
 * no shared language.
 *
 * It cannot tell a Big Mac from a Quarter Pounder. Both are "Burger" to it.
 * So photos land per category, not per item, and the class list only overlaps
 * part of our menu: Hot Dog, Pizza, Taco and Taquito are not on a McDonald's
 * menu at all, and our drinks, salads and desserts beyond donuts have no class.
 * Expect roughly half the menu to get a photo from this source.
 *
 * It also cannot read a customer's request. Requests arrive as ASL glosses or
 * text, never as images, so an image classifier is not in that path.
 *
 * SETUP (needs a Kaggle API token at ~/.kaggle/kaggle.json)
 *
 *   pip install kaggle
 *   kaggle datasets download -d utkarshsaxenadn/fast-food-classification-dataset \
 *     -p data/food-images --unzip
 *   node scripts/import-food-images.mjs
 *   npm --prefix web run db:seed -- --force
 *
 * Pass --limit N to copy more than one photo per class.
 */
import { readdir, mkdir, copyFile, readFile, writeFile, stat } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import path from 'node:path';

const SRC_ROOT = path.join('data', 'food-images');
const PUBLIC_DIR = path.join('web', 'public', 'menu-images');
const MENU_CSV = path.join('data', 'menu', 'menu.csv');
const EXTRAS_CSV = path.join('data', 'menu', 'extras.csv');

const PER_CLASS = Number(process.argv.find((a) => a.startsWith('--limit='))?.split('=')[1] ?? 1);

/**
 * Dataset class -> the words in our item names that should use that photo.
 * Checked in order, so put the specific ones first: "Crispy Chicken" has to
 * win over "Sandwich" for a Crispy Chicken Sandwich.
 */
const CLASS_KEYWORDS = [
  ['Crispy Chicken', [/crispy chicken/i, /chicken.*(sandwich|filet)/i, /mcchicken/i, /nugget/i]],
  ['Burger', [/burger/i, /big mac/i, /quarter pounder/i, /mac\b/i]],
  ['Fries', [/fries/i, /hash brown/i]],
  ['Baked Potato', [/potato/i]],
  ['Donut', [/donut|doughnut/i, /pie\b/i, /cookie/i]],
  ['Sandwich', [/sandwich/i, /club/i, /wrap/i]],
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

/** Find a class directory case-insensitively; the zip nests Train/Valid/Test. */
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
      if (match && !found.has(match[0])) found.set(match[0], full);
      else await walk(full, depth + 1);
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
  console.error('Download it first — see the comment at the top of this file.');
  process.exit(1);
}

const classDirs = await findClassDirs(SRC_ROOT);
if (classDirs.size === 0) {
  console.error(`No recognised class folders under ${SRC_ROOT}.`);
  console.error(`Expected directories named: ${CLASS_KEYWORDS.map(([c]) => c).join(', ')}`);
  process.exit(1);
}
console.log(`Found ${classDirs.size} classes: ${[...classDirs.keys()].join(', ')}`);

await mkdir(PUBLIC_DIR, { recursive: true });

// --- copy representative photos ------------------------------------------
const classImage = new Map();
for (const [cls, dir] of classDirs) {
  const files = (await readdir(dir)).filter((f) => /\.(jpe?g|png|webp)$/i.test(f));
  if (files.length === 0) continue;

  const chosen = files.slice(0, PER_CLASS);
  for (let i = 0; i < chosen.length; i++) {
    const ext = path.extname(chosen[i]).toLowerCase();
    const name = `${cls.toLowerCase().replace(/\s+/g, '-')}${i === 0 ? '' : `-${i}`}${ext}`;
    await copyFile(path.join(dir, chosen[i]), path.join(PUBLIC_DIR, name));
    if (i === 0) classImage.set(cls, `/menu-images/${name}`);
  }
  const { size } = await stat(path.join(PUBLIC_DIR, path.basename(classImage.get(cls))));
  console.log(`  ${cls}: ${files.length} available, copied ${chosen.length} (${(size / 1024).toFixed(0)} KB)`);
}

// --- write image_url back into the menu CSVs ------------------------------
let matched = 0;
let unmatched = [];

for (const csvPath of [MENU_CSV, EXTRAS_CSV]) {
  const { header, rows } = parseCsv(await readFile(csvPath, 'utf8'));

  let urlIdx = header.indexOf('image_url');
  let srcIdx = header.indexOf('image_source');
  if (urlIdx === -1) {
    header.push('image_url');
    urlIdx = header.length - 1;
  }
  if (srcIdx === -1) {
    header.push('image_source');
    srcIdx = header.length - 1;
  }

  const nameIdx = header.indexOf('name');
  const out = rows.map((row) => {
    while (row.length < header.length) row.push('');
    const cls = classFor(row[nameIdx] ?? '');
    const url = cls ? classImage.get(cls) : undefined;
    if (url) {
      row[urlIdx] = url;
      row[srcIdx] = `kaggle-fastfood-v2:${cls}`;
      matched++;
    } else {
      unmatched.push(row[nameIdx]);
    }
    return row;
  });

  await writeFile(csvPath, [header.join(','), ...out.map((r) => r.join(','))].join('\n') + '\n');
}

console.log(`\nMatched ${matched} items to a photo.`);
if (unmatched.length) {
  console.log(`No photo for ${unmatched.length} items (no matching class in this dataset):`);
  console.log('  ' + unmatched.slice(0, 12).join(', ') + (unmatched.length > 12 ? ' …' : ''));
  console.log('  Drinks, salads and shakes have no class here — photograph those yourselves.');
}
console.log('\nNext: npm --prefix web run db:seed -- --force');
