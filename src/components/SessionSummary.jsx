/**
 * The full-page session summary shown after "End session."
 *
 * Reuses the same panel language as the live view (score blocks, badges,
 * panel headers) so the summary reads as a continuation of the live review,
 * not a different app. Leads with the comprehensive session score already
 * accumulated live (createSessionDinkReview), then the batch-by-batch
 * breakdown, then the two session-long panels that only make sense once a
 * session is over: the average-dink avatar ("AR visual" of the player's own
 * form) and the Fatigue Score.
 */

import AverageDinkAvatarPanel from './AverageDinkAvatarPanel.jsx';
import FatigueDriftPanel from './FatigueDriftPanel.jsx';

function formatPercent(value) {
  return `${Math.round((1 - Math.min(1, value)) * 100)}%`;
}

export default function SessionSummary({
  sessionDinkReview,
  dinkReviewHistory,
  sessionComposite,
  fatigueAnalysis,
  totalHitsRecorded,
  sessionDurationMinutes,
  onStartNewSession,
}) {
  const hasReviews = Boolean(sessionDinkReview);

  return (
    <section className="stage summaryStage" aria-label="DinkAI session summary">
      <div className="stageHeader">
        <h1>Session Summary</h1>
        <button type="button" className="primaryButton" onClick={onStartNewSession}>
          Start new session
        </button>
      </div>

      <section className="summaryHero" aria-labelledby="summary-hero-heading">
        <div className="summaryHeroHeader">
          <div>
            <p className="summaryEyebrow">Comprehensive session score</p>
            <h2 id="summary-hero-heading">
              {hasReviews ? `Session ${sessionDinkReview.scoreTrend}` : 'No completed batches yet'}
            </h2>
            <p>
              {totalHitsRecorded} total hit{totalHitsRecorded === 1 ? '' : 's'} recorded
              {sessionDurationMinutes !== null
                ? ` across about ${Math.max(1, Math.round(sessionDurationMinutes))} min`
                : ''}
              .
            </p>
          </div>
        </div>

        {hasReviews ? (
          <div className="summaryHeroContent">
            <div className="scoreBlock summaryHeroScore">
              <span className="scoreLabel">Session average</span>
              <strong>{sessionDinkReview.averageScore}</strong>
              <span className="scoreMax">/ 100</span>
            </div>

            <div className="summaryStatGrid">
              <div className="summaryStat">
                <span>Four-hit reviews completed</span>
                <strong>{sessionDinkReview.reviewCount}</strong>
              </div>
              <div className="summaryStat">
                <span>Total hits reviewed</span>
                <strong>{sessionDinkReview.hitCount}</strong>
              </div>
              <div className="summaryStat">
                <span>Avg. ready position</span>
                <strong>
                  {sessionDinkReview.averageReadyScore === null
                    ? 'not visible'
                    : `${Math.round(sessionDinkReview.averageReadyScore)} / 100`}
                </strong>
              </div>
              <div className="summaryStat">
                <span>Avg. contact spacing</span>
                <strong>
                  {sessionDinkReview.averageContactDistance === null
                    ? '-'
                    : sessionDinkReview.averageContactDistance.toFixed(3)}
                </strong>
              </div>
              <div className="summaryStat">
                <span>Swing consistency</span>
                <strong>
                  {sessionDinkReview.averageVelocityVariation === null
                    ? '-'
                    : formatPercent(sessionDinkReview.averageVelocityVariation)}
                </strong>
              </div>
              <div className="summaryStat">
                <span>Score trend</span>
                <strong>{sessionDinkReview.scoreTrend}</strong>
              </div>
            </div>
          </div>
        ) : (
          <p className="summaryEmpty">
            This session ended before a full four-hit review completed. Play a
            full rally of at least four likely contacts next time for a
            comprehensive score.
          </p>
        )}
      </section>

      {dinkReviewHistory.length > 0 && (
        <section className="summaryBatches" aria-labelledby="summary-batches-heading">
          <h2 id="summary-batches-heading">Batch-by-batch</h2>
          <ol className="summaryBatchList">
            {dinkReviewHistory.map((review, index) => (
              <li key={index}>
                <span className="summaryBatchNumber">Batch {index + 1}</span>
                <span className="summaryBatchScore">{review.score} / 100</span>
                <span className="summaryBatchDetail">
                  Ready:{' '}
                  {review.averageReadyScore === null ? 'not visible' : Math.round(review.averageReadyScore)}
                </span>
                <span className="summaryBatchDetail">
                  Swing:{' '}
                  {review.velocityVariation === null ? '-' : formatPercent(review.velocityVariation)}
                </span>
              </li>
            ))}
          </ol>
        </section>
      )}

      <AverageDinkAvatarPanel composite={sessionComposite} />

      <FatigueDriftPanel analysis={fatigueAnalysis} />
    </section>
  );
}
