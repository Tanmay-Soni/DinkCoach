import assert from 'node:assert/strict';
import test from 'node:test';
import {
  areFrameLandmarksUsable,
  getAngle,
  getDistance,
  getMidpoint,
  getTiltAngle,
  isUsableLandmark,
} from '../src/lib/geometry.js';

test('accepts only finite landmarks visible in the camera frame', () => {
  assert.equal(isUsableLandmark({ x: 0, y: 1 }), true);
  assert.equal(isUsableLandmark({ x: -0.01, y: 0.5 }), false);
  assert.equal(isUsableLandmark({ x: 0.5, y: Number.NaN }), false);
  assert.equal(areFrameLandmarksUsable([{ x: 0.5, y: 0.5 }], [0]), true);
});

test('calculates normalized landmark distance and midpoint', () => {
  const start = { x: 0.1, y: 0.2, z: -0.1 };
  const end = { x: 0.4, y: 0.6, z: 0.3 };

  assert.equal(getDistance(start, end), 0.5);
  const midpoint = getMidpoint(start, end);
  assert.equal(midpoint.x, 0.25);
  assert.equal(midpoint.y, 0.4);
  assert.ok(Math.abs(midpoint.z - 0.1) < Number.EPSILON);
  assert.equal(getDistance(start, { x: 1.2, y: 0.6 }), null);
});

test('calculates joint and body tilt angles', () => {
  assert.equal(getAngle({ x: 0, y: 0 }, { x: 0, y: 1 }, { x: 1, y: 1 }), 90);
  assert.equal(getTiltAngle({ x: 0, y: 0.5 }, { x: 1, y: 0.5 }), 0);
  assert.equal(getTiltAngle({ x: 0.5, y: 0 }, { x: 0.5, y: 1 }), 90);
  assert.equal(getAngle({ x: 0, y: 0 }, { x: 0, y: 0 }, { x: 1, y: 1 }), null);
});
