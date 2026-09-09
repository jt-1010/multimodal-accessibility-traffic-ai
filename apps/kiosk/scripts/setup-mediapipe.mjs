/**
 * Vendor MediaPipe's WASM runtime and model files into public/.
 *
 * The obvious alternative is loading both from a CDN. We do not, for one
 * reason: this is demoed in a lecture hall. Venue wifi fails, and a kiosk that
 * cannot see a person because a .task file did not download is a kiosk that
 * does not demo. Everything needed to run is on disk after `npm run setup`.
 */
import { mkdir, copyFile, readdir, stat, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import path from 'node:path';

const ROOT = process.cwd();
const WASM_SRC = path.join(ROOT, 'node_modules', '@mediapipe', 'tasks-vision', 'wasm');
const WASM_DEST = path.join(ROOT, 'public', 'mediapipe', 'wasm');
const MODEL_DEST = path.join(ROOT, 'public', 'models');

const MODELS = [
  {
    name: 'pose_landmarker_lite.task',
    url: 'https://storage.googleapis.com/mediapipe-models/pose_landmarker/pose_landmarker_lite/float16/1/pose_landmarker_lite.task',
  },
  {
    name: 'hand_landmarker.task',
    url: 'https://storage.googleapis.com/mediapipe-models/hand_landmarker/hand_landmarker/float16/1/hand_landmarker.task',
  },
];

async function copyWasm() {
  await mkdir(WASM_DEST, { recursive: true });
  const files = await readdir(WASM_SRC);
  for (const f of files) {
    await copyFile(path.join(WASM_SRC, f), path.join(WASM_DEST, f));
  }
  console.log(`wasm: copied ${files.length} files`);
}

async function fetchModels() {
  await mkdir(MODEL_DEST, { recursive: true });
  for (const m of MODELS) {
    const dest = path.join(MODEL_DEST, m.name);
    if (existsSync(dest)) {
      const { size } = await stat(dest);
      console.log(`model: ${m.name} already present (${(size / 1e6).toFixed(1)} MB)`);
      continue;
    }
    process.stdout.write(`model: downloading ${m.name} ... `);
    const res = await fetch(m.url);
    if (!res.ok) throw new Error(`${res.status} ${res.statusText} for ${m.url}`);
    const buf = Buffer.from(await res.arrayBuffer());
    await writeFile(dest, buf);
    console.log(`${(buf.length / 1e6).toFixed(1)} MB`);
  }
}

await copyWasm();
await fetchModels();
console.log('MediaPipe assets ready.');
