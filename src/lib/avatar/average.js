/**
 * Per-slot, per-joint averaging across normalized reps.
 *
 * Median is the default: cheap and robust to the outlier reps this tracking
 * pipeline produces. Component-wise (median of xs, median of ys) is enough for a
 * first version.
 */

import { COMPOSITE_JOINTS, AVERAGE_DEFAULTS } from './constants.js';
import { median, mean } from './math.js';

const reducers = { median, mean };

export function phaseForSlot(slot) {
  if (slot === 0) {
    return 'contact';
  }
  return slot < 0 ? `pre_contact_${slot}` : `post_contact_+${slot}`;
}

/**
 * @param normReps NormFrame[][] — resampleRepToContactWindow output per rep.
 * @returns CompositeFrame[] — { phase, slot, keypoints: { joint: [x,y] | null } }
 */
export function buildComposite(normReps, options = {}) {
  const { minJointSamples, method } = { ...AVERAGE_DEFAULTS, ...options };
  const reduce = reducers[method] || median;

  if (!normReps.length) {
    return [];
  }

  const slotCount = normReps[0].length;
  const frames = [];

  for (let s = 0; s < slotCount; s += 1) {
    const { slot } = normReps[0][s];
    const keypoints = {};

    for (const joint of COMPOSITE_JOINTS) {
      const xs = [];
      const ys = [];
      for (const rep of normReps) {
        const kp = rep[s] && rep[s].kp[joint];
        if (kp) {
          xs.push(kp[0]);
          ys.push(kp[1]);
        }
      }
      keypoints[joint] =
        xs.length >= minJointSamples ? [reduce(xs), reduce(ys)] : null;
    }

    frames.push({ phase: phaseForSlot(slot), slot, keypoints });
  }
  return frames;
}
