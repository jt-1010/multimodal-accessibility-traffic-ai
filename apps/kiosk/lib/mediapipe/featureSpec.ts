/**
 * TypeScript mirror of ml/feature_spec.json.
 *
 * The JSON file is canonical; this is a hand-kept copy so the Next.js bundler
 * does not have to reach outside the app root. `npm run check:spec` fails the
 * build if the two ever disagree - which matters more than it sounds, because
 * a mismatch here does not throw. It just feeds the model a subtly different
 * vector than it was trained on, and accuracy quietly falls off a cliff.
 */
export const FEATURE_SPEC = {
  frames: 32,
  fpsTarget: 30,
  hands: { count: 2, pointsPerHand: 21 },
  /** Indices into MediaPipe's 33-point pose output. */
  poseIndices: [0, 11, 12, 13, 14, 15, 16, 23, 24],
  poseIndexNames: [
    'nose',
    'left_shoulder',
    'right_shoulder',
    'left_elbow',
    'right_elbow',
    'left_wrist',
    'right_wrist',
    'left_hip',
    'right_hip',
  ],
  dims: 3,
  featureLength: 153,
} as const;

export const HAND_POINTS = FEATURE_SPEC.hands.count * FEATURE_SPEC.hands.pointsPerHand;

/** Presence thresholds. Tuned to "at the counter", not "walking past". */
export const PRESENCE = {
  /** Normalised shoulder width; larger means closer to the camera. */
  minShoulderWidth: 0.12,
  /** Hold this long before greeting, so passers-by do not trigger it. */
  enterMs: 1500,
  /** Absence this long ends the session. */
  exitMs: 5000,
} as const;
