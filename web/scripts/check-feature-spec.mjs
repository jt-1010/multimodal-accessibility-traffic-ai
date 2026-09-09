/**
 * Fails if the TS mirror has drifted from the canonical JSON spec.
 * A silent mismatch here degrades model accuracy with no error to trace.
 */
import { readFile } from 'node:fs/promises';
import path from 'node:path';

const json = JSON.parse(
  await readFile(path.join(process.cwd(), '..', 'ml', 'feature_spec.json'), 'utf8'),
);
const ts = await readFile(path.join(process.cwd(), 'lib', 'mediapipe', 'featureSpec.ts'), 'utf8');

const checks = [
  ['frames', json.frames, `frames: ${json.frames}`],
  ['dims', json.dims, `dims: ${json.dims}`],
  ['featureLength', json.feature_length, `featureLength: ${json.feature_length}`],
  ['hands.count', json.hands.count, `count: ${json.hands.count}`],
  ['pointsPerHand', json.hands.points_per_hand, `pointsPerHand: ${json.hands.points_per_hand}`],
  ['poseIndices', json.pose_indices, `poseIndices: [${json.pose_indices.join(', ')}]`],
];

const failures = checks.filter(([, , needle]) => !ts.includes(needle));

if (failures.length) {
  console.error('feature spec DRIFT between ml/feature_spec.json and featureSpec.ts:');
  for (const [name, value] of failures) console.error(`  ${name} should be ${JSON.stringify(value)}`);
  process.exit(1);
}

const derived =
  json.hands.count * json.hands.points_per_hand * json.dims +
  json.pose_indices.length * json.dims;
if (derived !== json.feature_length) {
  console.error(`feature_length is ${json.feature_length} but the landmarks sum to ${derived}`);
  process.exit(1);
}

console.log(`feature spec OK (${json.feature_length} floats/frame, ${json.frames} frames)`);
