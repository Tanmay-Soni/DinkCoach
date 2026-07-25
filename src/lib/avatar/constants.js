/**
 * Constants for the post-session "Average Dink" composite avatar.
 *
 * The avatar synthesizes one skeleton sequence from every clean dink rep the
 * player hit this session (the same four-hit contacts `dinkReview.js` already
 * detects), aligned on contact and median-averaged, then renders it as a
 * volumetric body in the session summary.
 *
 * Landmark indices match the MediaPipe Pose Landmarker set used in App.jsx.
 */

export const LANDMARK_INDEX = {
  nose: 0,
  leftShoulder: 11,
  rightShoulder: 12,
  leftElbow: 13,
  rightElbow: 14,
  leftWrist: 15,
  rightWrist: 16,
  leftHip: 23,
  rightHip: 24,
  leftKnee: 25,
  rightKnee: 26,
  leftAnkle: 27,
  rightAnkle: 28,
  leftFootIndex: 31,
  rightFootIndex: 32,
};

// Named joints the composite asset carries (stable order).
export const COMPOSITE_JOINTS = [
  'nose',
  'leftShoulder', 'rightShoulder',
  'leftElbow', 'rightElbow',
  'leftWrist', 'rightWrist',
  'leftHip', 'rightHip',
  'leftKnee', 'rightKnee',
  'leftAnkle', 'rightAnkle',
  'leftFootIndex', 'rightFootIndex',
];

export const JOINT_TO_INDEX = COMPOSITE_JOINTS.reduce((acc, name) => {
  acc[name] = LANDMARK_INDEX[name];
  return acc;
}, {});

// Bones for body/ghost rendering (named-joint pairs).
export const POSE_BONES = [
  ['leftShoulder', 'rightShoulder'],
  ['leftShoulder', 'leftElbow'], ['leftElbow', 'leftWrist'],
  ['rightShoulder', 'rightElbow'], ['rightElbow', 'rightWrist'],
  ['leftShoulder', 'leftHip'], ['rightShoulder', 'rightHip'],
  ['leftHip', 'rightHip'],
  ['leftHip', 'leftKnee'], ['leftKnee', 'leftAnkle'],
  ['rightHip', 'rightKnee'], ['rightKnee', 'rightAnkle'],
];

// Core joints for the per-rep confidence gate.
export const CORE_JOINTS = [
  'leftShoulder', 'rightShoulder', 'leftHip', 'rightHip',
  'leftKnee', 'rightKnee', 'leftAnkle', 'rightAnkle',
];

// ---- pose-hit recorder ----
// Contacts come from dinkReview.getDinkContactUpdate; the recorder just slices a
// window of buffered pose frames around each contact timestamp.
export const RECORDER_DEFAULTS = {
  bufferMs: 3000,       // rolling pose buffer length
  windowBeforeMs: 520,  // captured before contact (backswing/ready)
  windowAfterMs: 360,   // captured after contact (follow-through)
  maxPendingMs: 1500,   // give up finalizing a rep if frames never arrive
};

// ---- contact-anchored normalization ----
export const NORMALIZE_DEFAULTS = {
  windowBefore: 15, // slots before contact
  windowAfter: 10,  // slots after contact
};

// ---- averaging ----
export const AVERAGE_DEFAULTS = {
  minJointSamples: 3,
  method: 'median', // 'median' | 'mean'
};

// ---- session-level composite gate ----
export const COMPOSITE_DEFAULTS = {
  minMeanVisibility: 0.5,
  minRepsForComposite: 4, // one full four-hit batch is the floor
  fps: 30,
  faultThreshold: 0.3,
};

// ---- body renderer (volumetric mannequin) ----
// Radii are fractions of on-screen shoulder width `u`; two-value arrays taper.
export const BODY_RADII = {
  upperArm: [0.115, 0.088],
  forearm: [0.088, 0.062],
  thigh: [0.135, 0.1],
  shin: [0.1, 0.066],
  hand: 0.058,
  foot: 0.07,
  shoulderBall: 0.15,
  hipBall: 0.132,
  neck: 0.085,
  headRx: 0.3,
  headRy: 0.36,
  torsoExpandX: 0.1,
};

export const BODY_COLORS = {
  fill: '#0d8076',
  light: '#1ec4b2',
  outline: '#00f5d4',
  joint: '#ff4d6d',
  socket: '#06181c',
  faultKnee: '#ff4d6d',
  faultSwing: '#ff9e5e',
};
