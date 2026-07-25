/**
 * Fatigue / drift detection across a session.
 *
 * Every dink hit already produces posture measurements (see App.jsx's
 * getPostureMeasurements) for the four-hit review. This module keeps a
 * hit-by-hit sample of a few of those measurements for the whole session (not
 * just the current four-hit batch) and looks for a trend across hits: is the
 * player's knee bend opening up, is their ready-position score sliding, is
 * their stance narrowing? That is the classic "starting to stand up more as
 * you tire" pattern coaches watch for in real practice.
 *
 * This is a heuristic over a single camera view, not a validated biomechanical
 * fatigue model — see docs/FATIGUE_DRIFT.md and the thresholds below, which
 * should be tuned against labeled session footage before being treated as
 * coaching truth (same caveat the rest of this repo's coaching signals carry).
 */

export const MIN_SESSION_SAMPLES = 8; // two four-hit batches, minimum
export const MIN_METRIC_SAMPLES = 6; // a metric needs this many finite values

function average(values) {
  if (!values.length) {
    return null;
  }
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

/**
 * Ordinary least-squares slope of y over x. Returns null when there are fewer
 * than two points or x has no spread (slope is undefined).
 */
export function linearRegressionSlope(points) {
  if (points.length < 2) {
    return null;
  }

  const n = points.length;
  const sumX = points.reduce((sum, p) => sum + p.x, 0);
  const sumY = points.reduce((sum, p) => sum + p.y, 0);
  const sumXY = points.reduce((sum, p) => sum + p.x * p.y, 0);
  const sumXX = points.reduce((sum, p) => sum + p.x * p.x, 0);
  const denominator = n * sumXX - sumX * sumX;

  if (denominator === 0) {
    return null;
  }

  return (n * sumXY - sumX * sumY) / denominator;
}

/**
 * Compares the average of the first and last third of a session (by hit
 * order) for one metric. Early/late buckets are easier for a player to trust
 * than a raw regression slope, so the slope is used only to confirm the trend
 * is consistent, not to describe it.
 */
export function getEarlyLateComparison(points) {
  if (points.length < MIN_METRIC_SAMPLES) {
    return null;
  }

  const bucketSize = Math.max(1, Math.floor(points.length / 3));
  const early = average(points.slice(0, bucketSize).map((p) => p.y));
  const late = average(points.slice(-bucketSize).map((p) => p.y));

  if (early === null || late === null) {
    return null;
  }

  return {
    early,
    late,
    delta: late - early,
    slope: linearRegressionSlope(points),
    sampleCount: points.length,
  };
}

function averageOrNull(values) {
  const finite = values.filter(Number.isFinite);
  return finite.length ? average(finite) : null;
}

/**
 * One sample per dink hit. Call from the same place a hit is scored for the
 * four-hit review, using the same measurements/readyScore already computed
 * there — this module does not re-derive posture from landmarks.
 */
export function createFatigueSample({ hitIndex, timestamp, measurements, readyScore }) {
  return {
    hitIndex,
    timestamp,
    kneeBendAngle: averageOrNull([measurements.leftKneeAngle, measurements.rightKneeAngle]),
    stanceWidthRatio: Number.isFinite(measurements.feetToHipRatio)
      ? measurements.feetToHipRatio
      : null,
    torsoLeanMagnitude: Number.isFinite(measurements.torsoLean)
      ? Math.abs(measurements.torsoLean)
      : null,
    readyScore: Number.isFinite(readyScore) ? readyScore : null,
  };
}

function pointsFor(samples, key) {
  return samples
    .filter((sample) => Number.isFinite(sample[key]))
    .map((sample) => ({ x: sample.hitIndex, y: sample[key] }));
}

// Each metric's "concerning" direction is the one that reads as fatigue, not
// the one that reads as improvement — a metric only produces an insight when
// its delta crosses driftThreshold in that direction.
const FATIGUE_METRICS = [
  {
    key: 'kneeBendAngle',
    label: 'Knee bend at contact',
    unit: '°',
    driftThreshold: 6,
    isConcerning: (delta) => delta > 6,
    insight: (comparison) =>
      `Your knees straightened by about ${Math.round(comparison.delta)}° over the session (from ${Math.round(
        comparison.early,
      )}° early on to ${Math.round(comparison.late)}° later) — you're standing taller as you tire. Reset into a lower ready position between points.`,
  },
  {
    key: 'readyScore',
    label: 'Ready position score',
    unit: ' pts',
    driftThreshold: 10,
    isConcerning: (delta) => delta < -10,
    insight: (comparison) =>
      `Your ready-position score slipped from ${Math.round(comparison.early)} to ${Math.round(
        comparison.late,
      )} across the session — fatigue is showing up in your setup, not just your swing.`,
  },
  {
    key: 'stanceWidthRatio',
    label: 'Stance width',
    unit: 'x',
    driftThreshold: 0.25,
    isConcerning: (delta) => delta < -0.25,
    insight: (comparison) =>
      `Your stance narrowed as the session went on (${comparison.early.toFixed(2)}x to ${comparison.late.toFixed(
        2,
      )}x feet-to-hip width) — a sign you're not resetting your feet between dinks.`,
  },
  {
    key: 'torsoLeanMagnitude',
    label: 'Torso lean',
    unit: '',
    driftThreshold: 0.15,
    isConcerning: (delta) => delta > 0.15,
    insight: (comparison) =>
      `Your torso lean grew more pronounced later in the session — a sign your posture is loosening up as you tire.`,
  },
];

/**
 * @param samples FatigueSample[] in hit order (see createFatigueSample)
 * @returns { insufficientData, sampleCount, elapsedMinutes, metrics, insights, driftDetected }
 */
export function analyzeFatigueSession(samples) {
  if (samples.length < MIN_SESSION_SAMPLES) {
    return {
      insufficientData: true,
      reason: `Only ${samples.length} hit(s) recorded; need ${MIN_SESSION_SAMPLES} to look for a session trend.`,
      sampleCount: samples.length,
      elapsedMinutes: null,
      metrics: {},
      insights: [],
      driftDetected: false,
      fatigueScore: null,
      fatigueStatus: 'Not enough data',
    };
  }

  const first = samples[0];
  const last = samples[samples.length - 1];
  const elapsedMinutes =
    Number.isFinite(first.timestamp) && Number.isFinite(last.timestamp)
      ? Math.max(0, (last.timestamp - first.timestamp) / 60000)
      : null;

  const metrics = {};
  const flagged = [];
  const trackedContributions = [];

  for (const config of FATIGUE_METRICS) {
    const comparison = getEarlyLateComparison(pointsFor(samples, config.key));
    metrics[config.key] = comparison
      ? { label: config.label, unit: config.unit, ...comparison }
      : { label: config.label, unit: config.unit, insufficient: true };

    if (!comparison) {
      continue;
    }

    const isConcerning = config.isConcerning(comparison.delta);
    // Only fatigue-direction drift counts against the score; a metric that
    // improved (e.g. deeper knee bend by the end) contributes nothing, but it
    // does not add back credit either — this is a drift score, not a form score.
    const severity = Math.abs(comparison.delta) / config.driftThreshold;
    trackedContributions.push(isConcerning ? Math.min(2, severity) : 0);

    if (isConcerning) {
      flagged.push({ key: config.key, severity, text: config.insight(comparison) });
    }
  }

  flagged.sort((a, b) => b.severity - a.severity);

  // 0-100, 100 = no measurable drift. Each tracked metric can pull the score
  // down by up to 50 points (a contribution of 2 = drifted 2x past its
  // threshold), averaged across every metric that had enough data.
  const fatigueScore = trackedContributions.length
    ? Math.max(0, Math.round(100 - (average(trackedContributions) / 2) * 100))
    : null;
  const fatigueStatus =
    fatigueScore === null
      ? 'Not enough data'
      : fatigueScore >= 85
        ? 'Form held steady'
        : fatigueScore >= 60
          ? 'Mild drift'
          : 'Significant drift';

  return {
    insufficientData: false,
    sampleCount: samples.length,
    elapsedMinutes,
    metrics,
    insights: flagged.map((item) => item.text),
    driftDetected: flagged.length > 0,
    fatigueScore,
    fatigueStatus,
  };
}
