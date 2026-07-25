/**
 * Contact-anchored temporal normalization.
 *
 * Reps differ in length and tempo, so we resample each onto a common grid of
 * slots relative to its contact frame (slot 0 = contact). This is what makes
 * averaging meaningful — never average raw frame-index to frame-index across
 * reps of different length.
 */

import { isUsableLandmark } from '../geometry.js';
import { COMPOSITE_JOINTS, JOINT_TO_INDEX, NORMALIZE_DEFAULTS } from './constants.js';
import { lerp } from './math.js';

function meanFrameDt(frames) {
  if (frames.length < 2) {
    return 1000 / 30;
  }
  return (frames[frames.length - 1].t - frames[0].t) / (frames.length - 1);
}

function bracket(frames, targetT) {
  if (targetT <= frames[0].t) {
    return [frames[0], frames[0], 0];
  }
  const last = frames[frames.length - 1];
  if (targetT >= last.t) {
    return [last, last, 0];
  }
  for (let i = 1; i < frames.length; i += 1) {
    if (frames[i].t >= targetT) {
      const a = frames[i - 1];
      const b = frames[i];
      const span = b.t - a.t || 1;
      return [a, b, (targetT - a.t) / span];
    }
  }
  return [last, last, 0];
}

/**
 * @returns NormFrame[] length (windowBefore + windowAfter + 1). Each:
 *   { slot, kp: { [jointName]: [x, y] | null } }
 * A joint is null for a slot when either bracketing sample is unusable.
 */
export function resampleRepToContactWindow(rep, options = {}) {
  const { windowBefore, windowAfter } = { ...NORMALIZE_DEFAULTS, ...options };
  const { frames, contactT } = rep;
  const dt = meanFrameDt(frames);
  const out = [];

  for (let slot = -windowBefore; slot <= windowAfter; slot += 1) {
    const targetT = contactT + slot * dt;
    const [a, b, u] = bracket(frames, targetT);
    const kp = {};

    for (const joint of COMPOSITE_JOINTS) {
      const idx = JOINT_TO_INDEX[joint];
      const la = a.kp[idx];
      const lb = b.kp[idx];
      kp[joint] =
        isUsableLandmark(la) && isUsableLandmark(lb)
          ? [lerp(la.x, lb.x, u), lerp(la.y, lb.y, u)]
          : null;
    }
    out.push({ slot, kp });
  }
  return out;
}
