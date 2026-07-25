/**
 * Per-rep fault detection + session-level aggregation.
 *
 * Detection reuses the same geometry the live coach uses (../geometry.js), keyed
 * off each rep's contact frame. Thresholds are proposals — tune against real
 * session data (see the roadmap's "make coaching signals trustworthy").
 */

import {
  isUsableLandmark,
  getAngle,
  getTiltAngle,
  getMidpoint,
} from '../geometry.js';
import { LANDMARK_INDEX } from './constants.js';

// Fault -> joints to highlight. 'swing*' entries resolve to the paddle side.
export const FAULT_JOINT_MAP = {
  poor_knee_bend: ['leftKnee', 'rightKnee', 'leftHip', 'rightHip'],
  long_backswing: ['swingShoulder', 'swingElbow', 'swingWrist'],
  paddle_too_low: ['swingWrist', 'swingElbow'],
  off_balance: ['leftShoulder', 'rightShoulder', 'leftHip', 'rightHip'],
};

export const FAULT_LABELS = {
  poor_knee_bend: 'Poor knee bend',
  long_backswing: 'Long backswing',
  paddle_too_low: 'Paddle too low',
  off_balance: 'Off balance',
};

const THRESHOLDS = {
  kneeAngleMax: 168,     // avg knee angle at contact (deg)
  tiltMax: 12,           // max(shoulderTilt, hipTilt) at contact (deg)
  backswingTravel: 0.22, // normalized swing-wrist travel from shoulder
};

function contactFrame(rep) {
  let best = rep.frames[0];
  let bestGap = Infinity;
  for (const frame of rep.frames) {
    const gap = Math.abs(frame.t - rep.contactT);
    if (gap < bestGap) {
      bestGap = gap;
      best = frame;
    }
  }
  return best;
}

const at = (frame, joint) => frame.kp[LANDMARK_INDEX[joint]];

export function detectRepFaults(rep, swingSide = 'right') {
  const frame = contactFrame(rep);
  const flags = [];

  const leftKnee = getAngle(at(frame, 'leftHip'), at(frame, 'leftKnee'), at(frame, 'leftAnkle'));
  const rightKnee = getAngle(at(frame, 'rightHip'), at(frame, 'rightKnee'), at(frame, 'rightAnkle'));
  if (leftKnee !== null && rightKnee !== null && (leftKnee + rightKnee) / 2 > THRESHOLDS.kneeAngleMax) {
    flags.push('poor_knee_bend');
  }

  const shoulderTilt = getTiltAngle(at(frame, 'leftShoulder'), at(frame, 'rightShoulder'));
  const hipTilt = getTiltAngle(at(frame, 'leftHip'), at(frame, 'rightHip'));
  if (shoulderTilt !== null && hipTilt !== null && Math.max(shoulderTilt, hipTilt) > THRESHOLDS.tiltMax) {
    flags.push('off_balance');
  }

  const swingWrist = at(frame, swingSide === 'left' ? 'leftWrist' : 'rightWrist');
  const hipMid = getMidpoint(at(frame, 'leftHip'), at(frame, 'rightHip'));
  if (isUsableLandmark(swingWrist) && hipMid && swingWrist.y > hipMid.y) {
    flags.push('paddle_too_low');
  }

  const swingShoulderName = swingSide === 'left' ? 'leftShoulder' : 'rightShoulder';
  const swingWristName = swingSide === 'left' ? 'leftWrist' : 'rightWrist';
  let maxTravel = 0;
  for (const f of rep.frames) {
    if (f.t > rep.contactT) {
      break;
    }
    const shoulder = at(f, swingShoulderName);
    const wrist = at(f, swingWristName);
    if (isUsableLandmark(shoulder) && isUsableLandmark(wrist)) {
      maxTravel = Math.max(maxTravel, Math.hypot(wrist.x - shoulder.x, wrist.y - shoulder.y));
    }
  }
  if (maxTravel > THRESHOLDS.backswingTravel) {
    flags.push('long_backswing');
  }

  return flags;
}

/**
 * @returns { recurringFaults: string[], stats: { [fault]: {flagged,total,ratio} } }
 */
export function aggregateSessionFaults(reps, threshold = 0.3) {
  const total = reps.length;
  const counts = {};
  for (const rep of reps) {
    for (const fault of rep.faultFlags || []) {
      counts[fault] = (counts[fault] || 0) + 1;
    }
  }

  const stats = {};
  const recurringFaults = [];
  for (const fault of Object.keys(counts)) {
    const ratio = total ? counts[fault] / total : 0;
    stats[fault] = { flagged: counts[fault], total, ratio };
    if (ratio >= threshold) {
      recurringFaults.push(fault);
    }
  }
  recurringFaults.sort((a, b) => stats[b].ratio - stats[a].ratio);
  return { recurringFaults, stats };
}

export function resolveFaultJoints(recurringFaults, swingSide = 'right') {
  const side = swingSide === 'left' ? 'left' : 'right';
  const cap = (s) => s[0].toUpperCase() + s.slice(1);
  const set = new Set();
  for (const fault of recurringFaults) {
    for (const joint of FAULT_JOINT_MAP[fault] || []) {
      set.add(joint.startsWith('swing') ? side + cap(joint.slice(5)) : joint);
    }
  }
  return [...set];
}
