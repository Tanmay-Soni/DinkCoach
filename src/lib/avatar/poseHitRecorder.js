/**
 * Captures a window of pose frames around each detected dink contact.
 *
 * Rather than run its own swing segmentation, this recorder rides the contact
 * detection already in dinkReview.js: App.jsx pushes every pose frame here, and
 * calls registerHit(contactTimestamp) whenever getDinkContactUpdate reports a hit.
 * The recorder keeps a short rolling buffer and, once enough post-contact frames
 * have arrived, slices [contact - windowBefore, contact + windowAfter] into a rep.
 *
 * A CapturedFrame is { t: number(ms), kp: Array<{x,y,z,visibility}> } (kp length 33).
 * A Rep is { repId, contactT, startT, endT, frames, meanVisibility }.
 */

import { LANDMARK_INDEX, CORE_JOINTS, RECORDER_DEFAULTS } from './constants.js';

function coreMeanVisibility(frames) {
  let total = 0;
  let count = 0;
  for (const frame of frames) {
    for (const joint of CORE_JOINTS) {
      const lm = frame.kp[LANDMARK_INDEX[joint]];
      if (lm && Number.isFinite(lm.visibility)) {
        total += lm.visibility;
        count += 1;
      }
    }
  }
  return count ? total / count : 0;
}

export function createPoseHitRecorder(config = {}) {
  const cfg = { ...RECORDER_DEFAULTS, ...config };

  let buffer = [];       // rolling CapturedFrame[]
  let pending = [];       // [{ contactT }] awaiting enough post-contact frames
  const closedReps = [];
  let repCounter = 0;
  let onReps = null;      // optional callback fired when a rep finalizes

  function finalizePending(now) {
    let changed = false;
    pending = pending.filter((p) => {
      const windowReady = now >= p.contactT + cfg.windowAfterMs;
      const expired = now - p.contactT > cfg.maxPendingMs;
      if (!windowReady && !expired) {
        return true; // keep waiting
      }

      const frames = buffer.filter(
        (f) => f.t >= p.contactT - cfg.windowBeforeMs && f.t <= p.contactT + cfg.windowAfterMs,
      );

      if (frames.length >= 4) {
        repCounter += 1;
        closedReps.push({
          repId: `rep-${repCounter}-${Math.round(p.contactT)}`,
          contactT: p.contactT,
          startT: frames[0].t,
          endT: frames[frames.length - 1].t,
          frames,
          meanVisibility: coreMeanVisibility(frames),
        });
        changed = true;
      }
      return false; // done with this pending contact
    });

    if (changed && onReps) {
      onReps(closedReps.length);
    }
  }

  return {
    /** Call every pose frame with the raw landmark array. */
    pushFrame(frame) {
      if (!frame || !frame.kp || !frame.kp.length) {
        return;
      }
      buffer.push(frame);
      const cutoff = frame.t - cfg.bufferMs;
      if (buffer.length && buffer[0].t < cutoff) {
        buffer = buffer.filter((f) => f.t >= cutoff);
      }
      finalizePending(frame.t);
    },

    /** Call when dinkReview reports a hit at contactTimestamp. */
    registerHit(contactT) {
      pending.push({ contactT });
    },

    /** Fires with the new rep count whenever a rep finalizes. */
    setOnReps(callback) {
      onReps = callback;
    },

    getReps() {
      return closedReps.slice();
    },

    getRepCount() {
      return closedReps.length;
    },

    reset() {
      buffer = [];
      pending = [];
      closedReps.length = 0;
      repCounter = 0;
    },
  };
}
