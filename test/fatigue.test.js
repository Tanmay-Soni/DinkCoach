import assert from 'node:assert/strict';
import { test } from 'node:test';

import {
  linearRegressionSlope,
  getEarlyLateComparison,
  createFatigueSample,
  analyzeFatigueSession,
  MIN_SESSION_SAMPLES,
} from '../src/lib/fatigue.js';

function sample(hitIndex, overrides = {}) {
  return createFatigueSample({
    hitIndex,
    timestamp: hitIndex * 15000, // one dink roughly every 15s
    readyScore: 80,
    measurements: {
      leftKneeAngle: 150,
      rightKneeAngle: 150,
      feetToHipRatio: 1.8,
      torsoLean: 0.05,
      ...overrides,
    },
  });
}

test('linearRegressionSlope reads a rising trend as positive', () => {
  const points = [0, 1, 2, 3, 4].map((x) => ({ x, y: x * 2 }));
  assert.equal(linearRegressionSlope(points), 2);
});

test('linearRegressionSlope needs at least two points and x spread', () => {
  assert.equal(linearRegressionSlope([{ x: 0, y: 1 }]), null);
  assert.equal(linearRegressionSlope([{ x: 5, y: 1 }, { x: 5, y: 9 }]), null);
});

test('getEarlyLateComparison requires the metric sample floor', () => {
  const points = [0, 1, 2, 3, 4].map((x) => ({ x, y: 100 }));
  assert.equal(getEarlyLateComparison(points), null); // 5 < MIN_METRIC_SAMPLES (6)
});

test('getEarlyLateComparison reports the early/late delta', () => {
  const points = [140, 142, 144, 150, 158, 160, 162, 164, 166].map((y, x) => ({ x, y }));
  const comparison = getEarlyLateComparison(points);
  assert.ok(comparison);
  assert.ok(comparison.late > comparison.early);
  assert.ok(comparison.delta > 15);
});

test('analyzeFatigueSession reports insufficient data below the session floor', () => {
  const samples = Array.from({ length: MIN_SESSION_SAMPLES - 1 }, (_, i) => sample(i));
  const result = analyzeFatigueSession(samples);
  assert.equal(result.insufficientData, true);
  assert.equal(result.driftDetected, false);
  assert.equal(result.insights.length, 0);
  assert.equal(result.fatigueScore, null);
});

test('analyzeFatigueSession flags knees straightening as the session goes on', () => {
  // 15 hits: knee angle climbs from an athletic ~148deg to a standing ~170deg.
  const samples = Array.from({ length: 15 }, (_, i) =>
    sample(i, { leftKneeAngle: 148 + i * 1.6, rightKneeAngle: 148 + i * 1.6 }),
  );
  const result = analyzeFatigueSession(samples);

  assert.equal(result.insufficientData, false);
  assert.equal(result.driftDetected, true);
  assert.ok(result.insights.some((text) => text.includes('standing taller')));
  assert.ok(result.metrics.kneeBendAngle.delta > 6);
  assert.ok(result.fatigueScore < 100);
  assert.notEqual(result.fatigueStatus, 'Form held steady');
});

test('analyzeFatigueSession flags a declining ready score', () => {
  const samples = Array.from({ length: 15 }, (_, i) =>
    createFatigueSample({
      hitIndex: i,
      timestamp: i * 15000,
      readyScore: 90 - i * 2,
      measurements: { leftKneeAngle: 150, rightKneeAngle: 150, feetToHipRatio: 1.8, torsoLean: 0.05 },
    }),
  );
  const result = analyzeFatigueSession(samples);
  assert.ok(result.insights.some((text) => text.includes('ready-position score')));
});

test('analyzeFatigueSession stays quiet and scores 100 when everything holds steady', () => {
  const samples = Array.from({ length: 15 }, (_, i) => sample(i));
  const result = analyzeFatigueSession(samples);
  assert.equal(result.driftDetected, false);
  assert.equal(result.insights.length, 0);
  assert.equal(result.fatigueScore, 100);
  assert.equal(result.fatigueStatus, 'Form held steady');
});

test('analyzeFatigueSession does not flag knees bending more (an improvement)', () => {
  const samples = Array.from({ length: 15 }, (_, i) =>
    sample(i, { leftKneeAngle: 165 - i * 1.5, rightKneeAngle: 165 - i * 1.5 }),
  );
  const result = analyzeFatigueSession(samples);
  assert.ok(!result.insights.some((text) => text.includes('standing taller')));
  // Improvement earns no credit, but it does not get penalized either.
  assert.equal(result.fatigueScore, 100);
});

test('analyzeFatigueSession tolerates missing measurements in some samples', () => {
  const samples = Array.from({ length: 12 }, (_, i) =>
    createFatigueSample({
      hitIndex: i,
      timestamp: i * 15000,
      readyScore: i % 3 === 0 ? null : 80,
      measurements: {
        leftKneeAngle: i % 4 === 0 ? null : 150 + i * 2,
        rightKneeAngle: 150 + i * 2,
        feetToHipRatio: 1.8,
        torsoLean: 0.05,
      },
    }),
  );
  const result = analyzeFatigueSession(samples);
  assert.equal(result.insufficientData, false);
  assert.ok(result.metrics.kneeBendAngle.sampleCount <= samples.length);
});
