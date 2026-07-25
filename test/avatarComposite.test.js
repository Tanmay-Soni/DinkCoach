import assert from 'node:assert/strict';
import { test } from 'node:test';

import { LANDMARK_INDEX } from '../src/lib/avatar/constants.js';
import { createPoseHitRecorder } from '../src/lib/avatar/poseHitRecorder.js';
import { resampleRepToContactWindow } from '../src/lib/avatar/normalize.js';
import { buildComposite } from '../src/lib/avatar/average.js';
import { detectRepFaults, aggregateSessionFaults, resolveFaultJoints } from '../src/lib/avatar/faults.js';
import { buildSessionComposite } from '../src/lib/avatar/composite.js';

// Build a full 33-length landmark array; overrides set named joints.
function makeLandmarks(overrides = {}) {
  const kp = Array.from({ length: 33 }, () => ({ x: 0.5, y: 0.5, z: 0, visibility: 0.9 }));
  for (const [name, value] of Object.entries(overrides)) {
    kp[LANDMARK_INDEX[name]] = { x: value[0], y: value[1], z: 0, visibility: value[2] ?? 0.9 };
  }
  return kp;
}

function makeRep(contactT, overrides = {}) {
  const frames = [];
  for (let t = contactT - 100; t <= contactT + 100; t += 20) {
    frames.push({ t, kp: makeLandmarks(overrides) });
  }
  return {
    repId: `rep-${contactT}`,
    contactT,
    startT: frames[0].t,
    endT: frames[frames.length - 1].t,
    frames,
    meanVisibility: 0.9,
  };
}

test('pose recorder slices a window around a registered contact', () => {
  const recorder = createPoseHitRecorder({ windowBeforeMs: 100, windowAfterMs: 100, bufferMs: 2000 });
  let reps = 0;
  recorder.setOnReps(() => { reps += 1; });

  for (let t = 0; t <= 300; t += 20) {
    recorder.pushFrame({ t, kp: makeLandmarks() });
  }
  recorder.registerHit(150);
  recorder.pushFrame({ t: 320, kp: makeLandmarks() }); // now >= 150 + 100 -> finalize

  const stored = recorder.getReps();
  assert.equal(stored.length, 1);
  assert.equal(reps, 1);
  assert.equal(stored[0].contactT, 150);
  assert.ok(stored[0].frames.every((f) => f.t >= 50 && f.t <= 250));
});

test('recorder ignores empty pose frames', () => {
  const recorder = createPoseHitRecorder();
  recorder.pushFrame({ t: 0, kp: [] });
  recorder.registerHit(0);
  recorder.pushFrame({ t: 1000, kp: [] });
  assert.equal(recorder.getReps().length, 0);
});

test('contact-anchored resampling yields the right slot grid and contact frame', () => {
  const frames = [
    { t: 0, kp: makeLandmarks({ leftWrist: [0.2, 0.5] }) },
    { t: 100, kp: makeLandmarks({ leftWrist: [0.5, 0.5] }) },
    { t: 200, kp: makeLandmarks({ leftWrist: [0.8, 0.5] }) },
  ];
  const rep = { contactT: 100, frames };
  const norm = resampleRepToContactWindow(rep, { windowBefore: 1, windowAfter: 1 });

  assert.equal(norm.length, 3);
  assert.deepEqual(norm.map((f) => f.slot), [-1, 0, 1]);
  // slot 0 == contact time == middle frame
  assert.ok(Math.abs(norm[1].kp.leftWrist[0] - 0.5) < 1e-9);
  assert.ok(Math.abs(norm[0].kp.leftWrist[0] - 0.2) < 1e-9);
  assert.ok(Math.abs(norm[2].kp.leftWrist[0] - 0.8) < 1e-9);
});

test('buildComposite takes the per-joint median across reps', () => {
  const slot = (x) => [{ slot: 0, kp: { leftWrist: [x, 0.5] } }];
  const norm = [slot(0.4), slot(0.6), slot(0.5)];
  const frames = buildComposite(norm, { minJointSamples: 3, method: 'median' });

  assert.equal(frames.length, 1);
  assert.equal(frames[0].phase, 'contact');
  assert.ok(Math.abs(frames[0].keypoints.leftWrist[0] - 0.5) < 1e-9);
});

test('buildComposite nulls a joint below the sample floor', () => {
  const norm = [
    [{ slot: 0, kp: { leftWrist: [0.4, 0.5] } }],
    [{ slot: 0, kp: { leftWrist: [0.6, 0.5] } }],
  ];
  const frames = buildComposite(norm, { minJointSamples: 3 });
  assert.equal(frames[0].keypoints.leftWrist, null);
});

test('detectRepFaults flags straight knees as poor knee bend', () => {
  const straightLegs = {
    leftHip: [0.45, 0.4], leftKnee: [0.45, 0.6], leftAnkle: [0.45, 0.8],
    rightHip: [0.55, 0.4], rightKnee: [0.55, 0.6], rightAnkle: [0.55, 0.8],
    rightWrist: [0.55, 0.3], rightShoulder: [0.55, 0.3],
  };
  const flags = detectRepFaults(makeRep(100, straightLegs), 'right');
  assert.ok(flags.includes('poor_knee_bend'));
});

test('session fault aggregation respects the recurrence threshold', () => {
  const reps = [
    { faultFlags: ['poor_knee_bend', 'off_balance'] },
    { faultFlags: ['poor_knee_bend'] },
    { faultFlags: ['poor_knee_bend'] },
    { faultFlags: [] },
  ];
  const { recurringFaults } = aggregateSessionFaults(reps, 0.3);
  assert.ok(recurringFaults.includes('poor_knee_bend')); // 3/4 = 75%
  assert.ok(!recurringFaults.includes('off_balance')); // 1/4 = 25% < 30%
});

test('resolveFaultJoints maps swing placeholders to the paddle side', () => {
  const joints = resolveFaultJoints(['long_backswing'], 'left');
  assert.ok(joints.includes('leftShoulder'));
  assert.ok(joints.includes('leftElbow'));
  assert.ok(!joints.includes('rightShoulder'));
});

test('buildSessionComposite gates on minimum clean reps', () => {
  const few = [makeRep(100), makeRep(300)];
  const insufficient = buildSessionComposite(few, { minRepsForComposite: 4 });
  assert.equal(insufficient.insufficient, true);
  assert.equal(insufficient.repCountIncluded, 2);

  const enough = [makeRep(100), makeRep(300), makeRep(500), makeRep(700)];
  const asset = buildSessionComposite(enough, { swingSide: 'right' });
  assert.equal(asset.insufficient, undefined);
  assert.equal(asset.repCountIncluded, 4);
  assert.equal(asset.source, 'session_composite');
  assert.ok(asset.frames.length > 0);
  assert.ok(Array.isArray(asset.highlightJoints));
});
