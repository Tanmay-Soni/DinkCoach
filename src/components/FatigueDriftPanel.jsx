/**
 * Session-summary panel: the Fatigue Score.
 *
 * Compares each tracked posture metric's early-session average against its
 * late-session average and rolls the fatigue-direction drift into one 0-100
 * score (100 = form held steady all session, lower = more drift), plus
 * plain-language coaching insights for whichever metric drifted (e.g. knees
 * straightening = "standing up more as you tire"). Silent when nothing has
 * drifted — this panel should not manufacture a finding to have something to
 * say.
 */

const METRIC_ORDER = ['kneeBendAngle', 'readyScore', 'stanceWidthRatio', 'torsoLeanMagnitude'];

function formatMetricValue(value, unit) {
  if (value === null || value === undefined) {
    return '—';
  }
  const rounded = Math.abs(value) >= 10 ? Math.round(value) : Math.round(value * 100) / 100;
  return `${rounded}${unit}`;
}

function Sparkline({ early, late, driftedUp }) {
  // Minimal two-point trend line: early-session average -> late-session average.
  const width = 96;
  const height = 28;
  const pad = 4;
  const min = Math.min(early, late);
  const max = Math.max(early, late);
  const span = max - min || 1;
  const yFor = (value) => height - pad - ((value - min) / span) * (height - pad * 2);
  const x0 = pad;
  const x1 = width - pad;
  const y0 = yFor(early);
  const y1 = yFor(late);
  const color = driftedUp === null ? '#98a2b3' : driftedUp ? '#e0575b' : '#0f766e';

  return (
    <svg width={width} height={height} viewBox={`0 0 ${width} ${height}`} aria-hidden="true">
      <line x1={x0} y1={y0} x2={x1} y2={y1} stroke={color} strokeWidth="2.5" strokeLinecap="round" />
      <circle cx={x0} cy={y0} r="3" fill={color} opacity="0.55" />
      <circle cx={x1} cy={y1} r="3.5" fill={color} />
    </svg>
  );
}

const CONCERNING_DIRECTION = {
  kneeBendAngle: 'up',
  readyScore: 'down',
  stanceWidthRatio: 'down',
  torsoLeanMagnitude: 'up',
};

export default function FatigueDriftPanel({ analysis }) {
  if (!analysis || analysis.insufficientData) {
    return (
      <section className="fatiguePanel" aria-labelledby="fatigue-heading">
        <div className="fatigueHeader">
          <div>
            <h2 id="fatigue-heading">Fatigue Score</h2>
            <p>
              DinkAI compares your early-session form to your late-session form
              once enough hits are recorded.
            </p>
          </div>
        </div>
        <p className="fatigueEmpty">
          {analysis?.reason || 'Keep dinking — this panel needs a full session of hits to compare early vs. late form.'}
        </p>
      </section>
    );
  }

  const trackedMetrics = METRIC_ORDER.map((key) => ({ key, ...analysis.metrics[key] })).filter(
    (metric) => !metric.insufficient,
  );

  return (
    <section className="fatiguePanel" aria-labelledby="fatigue-heading">
      <div className="fatigueHeader">
        <div>
          <h2 id="fatigue-heading">Fatigue Score</h2>
          <p>
            Early-session form compared with late-session form across{' '}
            {analysis.sampleCount} hits
            {analysis.elapsedMinutes !== null ? ` over about ${Math.round(analysis.elapsedMinutes)} min` : ''}.
          </p>
        </div>
        <span className={analysis.driftDetected ? 'actionBadge actionBadgeActive' : 'actionBadge'}>
          {analysis.fatigueStatus}
        </span>
      </div>

      <div className="fatigueContent">
        <div className="fatigueScoreBlock">
          <span className="scoreLabel">Fatigue Score</span>
          <strong>{analysis.fatigueScore === null ? '—' : analysis.fatigueScore}</strong>
          <span className="scoreMax">/ 100</span>
          <span className="fatigueScoreHint">100 = form held steady all session</span>
        </div>

        {analysis.insights.length > 0 ? (
          <ul className="fatigueInsights" aria-live="polite">
            {analysis.insights.map((text) => (
              <li key={text}>{text}</li>
            ))}
          </ul>
        ) : (
          <p className="fatigueClean">
            No metric drifted enough to flag this session — your form held up from
            your first hits to your last.
          </p>
        )}

        <div className="fatigueMetricGrid">
          {trackedMetrics.map((metric) => {
            const direction = CONCERNING_DIRECTION[metric.key];
            const driftedUp =
              direction === 'up' ? metric.delta > 0 : direction === 'down' ? metric.delta < 0 : null;
            return (
              <div className="fatigueMetricCard" key={metric.key}>
                <span className="fatigueMetricLabel">{metric.label}</span>
                <Sparkline early={metric.early} late={metric.late} driftedUp={driftedUp} />
                <div className="fatigueMetricValues">
                  <span>{formatMetricValue(metric.early, metric.unit)} early</span>
                  <span>{formatMetricValue(metric.late, metric.unit)} late</span>
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </section>
  );
}
