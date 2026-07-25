/**
 * Orchestrator: recorded reps -> the composite-avatar asset shown in the summary.
 *
 *   const asset = buildSessionComposite(recorder.getReps(), { swingSide });
 *   if (!asset.insufficient) render <AverageDinkAvatarPanel composite={asset} />;
 */

import { isUsableLandmark } from '../geometry.js';
import {
  COMPOSITE_JOINTS,
  CORE_JOINTS,
  LANDMARK_INDEX,
  COMPOSITE_DEFAULTS,
} from './constants.js';
import { resampleRepToContactWindow } from './normalize.js';
import { buildComposite } from './average.js';
import {
  detectRepFaults,
  aggregateSessionFaults,
  resolveFaultJoints,
} from './faults.js';

function contactUsable(rep) {
  let best = rep.frames[0];
  let gap = Infinity;
  for (const frame of rep.frames) {
    const g = Math.abs(frame.t - rep.contactT);
    if (g < gap) {
      gap = g;
      best = frame;
    }
  }
  return CORE_JOINTS.every((joint) => isUsableLandmark(best.kp[LANDMARK_INDEX[joint]]));
}

/**
 * @param reps recorder.getReps()
 * @param opts { swingSide, sessionId, fps, faultThreshold, minMeanVisibility,
 *               minRepsForComposite, normalize, average }
 * @returns composite asset (data contract), or { insufficient: true, ... }
 */
export function buildSessionComposite(reps, opts = {}) {
  const {
    swingSide = 'right',
    sessionId = null,
    fps = COMPOSITE_DEFAULTS.fps,
    faultThreshold = COMPOSITE_DEFAULTS.faultThreshold,
    minMeanVisibility = COMPOSITE_DEFAULTS.minMeanVisibility,
    minRepsForComposite = COMPOSITE_DEFAULTS.minRepsForComposite,
    normalize: normalizeOpts,
    average: averageOpts,
  } = opts;

  const totalRecorded = reps.length;
  const included = reps.filter(
    (rep) => rep.meanVisibility >= minMeanVisibility && contactUsable(rep),
  );
  const excluded = totalRecorded - included.length;

  if (included.length < minRepsForComposite) {
    return {
      insufficient: true,
      reason: `Only ${included.length} clean rep(s); need ${minRepsForComposite}.`,
      repCountIncluded: included.length,
      repsExcludedLowConfidence: excluded,
      totalRecorded,
    };
  }

  for (const rep of included) {
    rep.faultFlags = detectRepFaults(rep, swingSide);
  }
  const { recurringFaults, stats } = aggregateSessionFaults(included, faultThreshold);

  const normReps = included.map((rep) => resampleRepToContactWindow(rep, normalizeOpts));
  const frames = buildComposite(normReps, averageOpts);

  return {
    fps,
    joints: COMPOSITE_JOINTS,
    source: 'session_composite',
    sessionId,
    swingSide,
    repCountIncluded: included.length,
    repsExcludedLowConfidence: excluded,
    totalRecorded,
    recurringFaults,
    faultStats: stats,
    highlightJoints: resolveFaultJoints(recurringFaults, swingSide),
    frames,
  };
}
