import assert from 'node:assert/strict';
import test from 'node:test';
import {
  HITS_PER_DINK_REVIEW,
  createDinkReview,
  createSessionDinkReview,
  getDinkContactUpdate,
} from '../src/lib/dinkReview.js';

const trackedBall = { normalizedX: 0.5, normalizedY: 0.5, timestamp: 1_000 };
const trackedPaddle = { normalizedX: 0.55, normalizedY: 0.5 };

test('counts an incoming ball only after it reverses away from the paddle', () => {
  const approaching = getDinkContactUpdate({
    timestamp: 1_100,
    lastHitAt: 0,
    ball: trackedBall,
    paddle: trackedPaddle,
    ballSpeed: 0.8,
    ballVelocity: { x: 1, y: 0 },
    pendingContact: null,
  });

  assert.equal(approaching.hit, null);
  assert.ok(approaching.pendingContact);

  const departing = getDinkContactUpdate({
    timestamp: 1_220,
    lastHitAt: 0,
    ball: { normalizedX: 0.7, normalizedY: 0.5, timestamp: 1_220 },
    paddle: trackedPaddle,
    ballSpeed: 0.9,
    ballVelocity: { x: 1, y: 0 },
    pendingContact: approaching.pendingContact,
  });

  assert.ok(departing.hit);
  assert.equal(departing.pendingContact, null);
});

test('does not count a ball that only moves away from the paddle', () => {
  assert.equal(
    getDinkContactUpdate({
      timestamp: 1_100,
      lastHitAt: 0,
      ball: trackedBall,
      paddle: trackedPaddle,
      ballSpeed: 0.8,
      ballVelocity: { x: -1, y: 0 },
      pendingContact: null,
    }).hit,
    null,
  );
});

test('creates a player-facing review only after four hits', () => {
  const hits = Array.from({ length: HITS_PER_DINK_REVIEW }, (_, index) => ({
    timestamp: 1_000 + index * 700,
    side: 'Right',
    wristVelocity: 1.2 + index * 0.02,
    contactDistance: 0.05,
    readyScore: 82,
  }));

  assert.equal(createDinkReview(hits.slice(0, 3)), null);

  const review = createDinkReview(hits);
  assert.equal(review.hitCount, 4);
  assert.ok(review.score >= 80);
  assert.match(review.tips.join(' '), /ready position/i);
});

test('accumulates each completed four-hit review into a session summary', () => {
  const firstReview = {
    score: 70,
    averageReadyScore: 68,
    averageContactDistance: 0.1,
    velocityVariation: 0.2,
  };
  const secondReview = {
    score: 82,
    averageReadyScore: 78,
    averageContactDistance: 0.08,
    velocityVariation: 0.12,
  };

  const session = createSessionDinkReview([firstReview, secondReview]);
  assert.equal(session.reviewCount, 2);
  assert.equal(session.hitCount, 8);
  assert.equal(session.averageScore, 76);
  assert.equal(session.scoreTrend, 'improving');
});
