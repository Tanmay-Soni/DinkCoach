/** Public surface for the composite-avatar pipeline. */
export * from './constants.js';
export { lerp, median, mean } from './math.js';
export { createPoseHitRecorder } from './poseHitRecorder.js';
export { resampleRepToContactWindow } from './normalize.js';
export { buildComposite, phaseForSlot } from './average.js';
export {
  detectRepFaults,
  aggregateSessionFaults,
  resolveFaultJoints,
  FAULT_JOINT_MAP,
  FAULT_LABELS,
} from './faults.js';
export { buildSessionComposite } from './composite.js';
