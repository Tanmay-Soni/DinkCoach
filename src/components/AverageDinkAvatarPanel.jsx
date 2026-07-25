/**
 * Session-summary panel: the player's "average dink" avatar.
 *
 * Renders alongside the four-hit dink review. Shows the composite mannequin
 * looping the player's own averaged dink, labeled as diagnostic (themselves),
 * with recurring faults highlighted. Falls back to a "keep dinking" state until
 * enough clean reps exist.
 */

import { useState } from 'react';
import CompositeAvatarPlayer from './CompositeAvatarPlayer.jsx';
import { FAULT_LABELS } from '../lib/avatar/faults.js';

const FAULT_COLORS = {
  poor_knee_bend: '#ff4d6d',
  off_balance: '#ff4d6d',
  long_backswing: '#ff9e5e',
  paddle_too_low: '#ff9e5e',
};

export default function AverageDinkAvatarPanel({ composite }) {
  const [showFaults, setShowFaults] = useState(true);

  const ready = composite && !composite.insufficient;

  return (
    <section className="avgDinkPanel" aria-labelledby="avg-dink-heading">
      <div className="avgDinkHeader">
        <div>
          <h2 id="avg-dink-heading">Your Average Dink</h2>
          <p>
            A composite of your own form this session — median-averaged across your
            clean reps and aligned on contact. This is you, not a reference model.
          </p>
        </div>
        {ready && (
          <span className="avgDinkBadge">
            Based on {composite.repCountIncluded} of {composite.totalRecorded} reps
          </span>
        )}
      </div>

      {ready ? (
        <div className="avgDinkContent">
          <div className="avgDinkStage">
            <CompositeAvatarPlayer composite={composite} showFaults={showFaults} />
            <span className="avgDinkStageLabel">median composite · contact-anchored</span>
          </div>

          <div className="avgDinkSide">
            <div className="avgDinkControls">
              <label className="avgDinkToggle">
                <input
                  type="checkbox"
                  checked={showFaults}
                  onChange={(event) => setShowFaults(event.target.checked)}
                />
                Fault highlights
              </label>
            </div>

            <h3>Recurring faults</h3>
            {composite.recurringFaults.length === 0 ? (
              <p className="avgDinkClean">No recurring faults this session. Clean dinks.</p>
            ) : (
              <ul className="avgDinkFaults">
                {composite.recurringFaults.map((fault) => {
                  const stat = composite.faultStats[fault];
                  const pct = Math.round(stat.ratio * 100);
                  return (
                    <li key={fault}>
                      <span
                        className="avgDinkSwatch"
                        style={{ background: FAULT_COLORS[fault] || '#ff4d6d' }}
                      />
                      <span className="avgDinkFaultName">{FAULT_LABELS[fault] || fault}</span>
                      <span className="avgDinkFaultPct">
                        {stat.flagged} / {stat.total} reps · {pct}%
                      </span>
                    </li>
                  );
                })}
              </ul>
            )}
          </div>
        </div>
      ) : (
        <p className="avgDinkEmpty">
          {composite && composite.insufficient
            ? `${composite.reason} Keep dinking — your average builds as clean contacts are recorded.`
            : 'Your average dink appears here once a few clean contacts are recorded.'}
        </p>
      )}
    </section>
  );
}
