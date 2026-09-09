/**
 * Download the source nutrition dataset.
 *
 * Not committed: it is third-party data with its own provenance, and vendoring
 * someone else's dataset into our repo muddies the licensing story. Fetch it,
 * derive menu.csv from it, and commit the derivative.
 *
 * TidyTuesday 2018-09-04 "Fast Food Calories", from the openintro R package.
 * 515 items, 8 US chains, measured nutrition. CC0.
 */
import { mkdir, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import path from 'node:path';

const URL =
  'https://raw.githubusercontent.com/rfordatascience/tidytuesday/master/data/2018/2018-09-04/fastfood_calories.csv';
const DEST = path.join('data', 'menu', 'fastfood_nutrition.csv');

if (existsSync(DEST)) {
  console.log(`${DEST} already present.`);
} else {
  await mkdir(path.dirname(DEST), { recursive: true });
  const res = await fetch(URL);
  if (!res.ok) throw new Error(`${res.status} ${res.statusText} fetching ${URL}`);
  const text = await res.text();
  await writeFile(DEST, text);
  console.log(`Wrote ${DEST} (${(text.length / 1024).toFixed(0)} KB)`);
}
console.log('Next: node scripts/build-menu.mjs && npm --prefix web run db:seed');
