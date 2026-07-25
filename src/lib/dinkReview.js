export const HITS_PER_DINK_REVIEW = 4;

const MIN_HIT_INTERVAL_MS = 220;
const MAX_BALL_AGE_MS = 450;
const MAX_CONTACT_DISTANCE = 0.22;
const MIN_CONTACT_EXIT_DISTANCE = 0.035;
const MIN_APPROACH_SPEED = 0.025;
const MIN_DEPARTURE_SPEED = 0.025;
const PENDING_CONTACT_HOLD_MS = 850;

function average(values) {
  if (!values.length) {
    return null;
  }

  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

function getVariation(values) {
  const mean = average(values);

  if (!mean) {
    return null;
  }

  const variance = average(values.map((value) => (value - mean) ** 2));
  return Math.sqrt(variance) / mean;
}

function isTrackedPoint(point) {
  return (
    Boolean(point) &&
    Number.isFinite(point.normalizedX) &&
    Number.isFinite(point.normalizedY)
  );
}

function getBallPaddleRelationship(ball, paddle, ballVelocity) {
  if (!isTrackedPoint(ball) || !isTrackedPoint(paddle) || !ballVelocity) {
    return null;
  }

  const offsetX = ball.normalizedX - paddle.normalizedX;
  const offsetY = ball.normalizedY - paddle.normalizedY;
  const distance = Math.hypot(offsetX, offsetY);

  if (distance === 0) {
    return null;
  }

  return {
    distance,
    radialVelocity:
      (ballVelocity.x * offsetX + ballVelocity.y * offsetY) / distance,
  };
}

/**
 * Detects a likely dink contact from a ball that approaches the paddle and
 * then departs from it. A compact paddle hit can therefore count without a
 * large wrist-speed spike. Thresholds intentionally favor slight trajectory
 * changes, while a hand-thrown ball moving only away from the paddle cannot
 * create the required approach/reversal sequence.
 */
export function getDinkContactUpdate({
  timestamp,
  lastHitAt,
  ball,
  paddle,
  ballSpeed,
  ballVelocity,
  pendingContact,
}) {
  const activePendingContact =
    pendingContact && timestamp - pendingContact.timestamp <= PENDING_CONTACT_HOLD_MS
      ? pendingContact
      : null;

  if (
    !isTrackedPoint(ball) ||
    !isTrackedPoint(paddle) ||
    timestamp - ball.timestamp > MAX_BALL_AGE_MS
  ) {
    return { pendingContact: activePendingContact, hit: null };
  }

  const relationship = getBallPaddleRelationship(ball, paddle, ballVelocity);

  if (!relationship) {
    return { pendingContact: activePendingContact, hit: null };
  }

  if (activePendingContact) {
    const hasDeparted =
      relationship.distance >= MIN_CONTACT_EXIT_DISTANCE &&
      relationship.radialVelocity >= MIN_DEPARTURE_SPEED;

    if (hasDeparted && timestamp - lastHitAt >= MIN_HIT_INTERVAL_MS) {
      return {
        pendingContact: null,
        hit: {
          timestamp,
          ballSpeed: Number.isFinite(ballSpeed) ? ballSpeed : null,
          contactDistance: activePendingContact.contactDistance,
        },
      };
    }

    return { pendingContact: activePendingContact, hit: null };
  }

  const isApproachingPaddle =
    relationship.distance <= MAX_CONTACT_DISTANCE &&
    relationship.radialVelocity <= -MIN_APPROACH_SPEED;

  return {
    pendingContact: isApproachingPaddle
      ? {
          timestamp,
          contactDistance: relationship.distance,
          incomingRadialVelocity: relationship.radialVelocity,
        }
      : null,
    hit: null,
  };
}

/**
 * Builds one player-facing review from exactly four likely dink contacts.
 */
export function createDinkReview(hits) {
  if (hits.length !== HITS_PER_DINK_REVIEW) {
    return null;
  }

  const readyScores = hits
    .map((hit) => hit.readyScore)
    .filter(Number.isFinite);
  const contactDistances = hits
    .map((hit) => hit.contactDistance)
    .filter(Number.isFinite);
  const velocities = hits
    .map((hit) => hit.wristVelocity)
    .filter(Number.isFinite);
  const averageReadyScore = average(readyScores);
  const averageContactDistance = average(contactDistances);
  const velocityVariation = getVariation(velocities);
  const readinessComponent = averageReadyScore ?? 50;
  const contactComponent =
    averageContactDistance === null
      ? 0
      : Math.max(0, 100 - (averageContactDistance / MAX_CONTACT_DISTANCE) * 100);
  const tempoComponent =
    velocityVariation === null
      ? 0
      : Math.max(0, 100 - velocityVariation * 180);
  const score = Math.round(
    readinessComponent * 0.4 + contactComponent * 0.35 + tempoComponent * 0.25,
  );
  const tips = [];

  if (averageReadyScore === null) {
    tips.push('Keep your full body in frame so DinkAI can review your stance on each hit.');
  } else if (averageReadyScore < 65) {
    tips.push('Reset into a lower, wider ready position before the next dink.');
  } else {
    tips.push('Your ready position stayed usable across this four-hit sequence.');
  }

  if (averageContactDistance !== null && averageContactDistance > 0.13) {
    tips.push('Aim to meet the ball closer to the center of the paddle for a more controlled dink.');
  } else {
    tips.push('Ball and paddle tracking stayed close at the likely contact moments.');
  }

  if (velocityVariation !== null && velocityVariation > 0.3) {
    tips.push('Use a more repeatable, compact swing; your paddle speed varied across the four hits.');
  } else {
    tips.push('Your swing tempo was consistent across the sequence.');
  }

  return {
    hitCount: hits.length,
    score,
    averageReadyScore,
    averageContactDistance,
    velocityVariation,
    tips,
  };
}

/**
 * Keeps completed four-hit reviews in one session-level summary. Each new
 * batch remains available as its own review while the session numbers show
 * the player's accumulated pattern across 4, 8, 12, and later hits.
 */
export function createSessionDinkReview(reviews) {
  if (!reviews.length) {
    return null;
  }

  const scores = reviews.map((review) => review.score).filter(Number.isFinite);
  const readyScores = reviews
    .map((review) => review.averageReadyScore)
    .filter(Number.isFinite);
  const contactDistances = reviews
    .map((review) => review.averageContactDistance)
    .filter(Number.isFinite);
  const velocityVariations = reviews
    .map((review) => review.velocityVariation)
    .filter(Number.isFinite);
  const firstScore = scores[0];
  const latestScore = scores[scores.length - 1];

  return {
    reviewCount: reviews.length,
    hitCount: reviews.length * HITS_PER_DINK_REVIEW,
    averageScore: Math.round(average(scores)),
    averageReadyScore: average(readyScores),
    averageContactDistance: average(contactDistances),
    averageVelocityVariation: average(velocityVariations),
    scoreTrend:
      scores.length < 2
        ? 'first review'
        : latestScore > firstScore + 3
          ? 'improving'
          : latestScore < firstScore - 3
            ? 'needs attention'
            : 'steady',
  };
}
