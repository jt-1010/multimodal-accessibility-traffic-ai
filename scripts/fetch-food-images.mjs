/**
 * Download the Fast Food Classification dataset, then attach photos to the menu.
 *
 * Kaggle requires authentication for every dataset download, so this cannot run
 * unattended. It checks for the token, tells you exactly how to get one if it is
 * missing, and otherwise runs the whole pipeline.
 */
import { spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import path from 'node:path';
import os from 'node:os';

const TOKEN = path.join(os.homedir(), '.kaggle', 'kaggle.json');
const DEST = path.join('data', 'food-images');
const SLUG = 'utkarshsaxenadn/fast-food-classification-dataset';

if (!existsSync(TOKEN)) {
  console.error(`No Kaggle token at ${TOKEN}\n`);
  console.error('Kaggle needs one to download anything. To create it:');
  console.error('  1. Sign in at https://www.kaggle.com');
  console.error('  2. Open https://www.kaggle.com/settings/account');
  console.error('  3. Under "API", click "Create New Token" — it downloads kaggle.json');
  console.error(`  4. Move that file to ${TOKEN}`);
  console.error('\nThen run this again. Do not paste the token anywhere else.');
  process.exit(1);
}

const run = (cmd, args) => {
  console.log(`\n$ ${cmd} ${args.join(' ')}`);
  const r = spawnSync(cmd, args, { stdio: 'inherit', shell: process.platform === 'win32' });
  if (r.status !== 0) process.exit(r.status ?? 1);
};

if (existsSync(DEST)) {
  console.log(`${DEST} already exists — skipping download.`);
} else {
  // ~2GB. Expect this to take a while.
  run('python', ['-m', 'kaggle', 'datasets', 'download', '-d', SLUG, '-p', DEST, '--unzip']);
}

run('node', ['scripts/import-food-images.mjs']);
run('npm', ['--prefix', 'web', 'run', 'db:seed', '--', '--force']);

console.log('\nDone. Reload the page and open "Browse the menu instead" to see the photos.');
