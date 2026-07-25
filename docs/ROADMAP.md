# Near-term roadmap

This sequence keeps the current browser-only coaching prototype intact while making it reliable enough to learn from users.

## 1. Validate four-hit dink reviews

**Goal:** ensure each four-hit review represents four real dink contacts and provides useful coaching.

- Record consented, representative rally clips and compare likely-contact counts with manually labeled hits.
- Tune trajectory reversal timing, paddle/ball spacing, and confidence thresholds by device and camera distance.
- Have coaches review the four-hit feedback language, score bands, and suggested corrections.
- Add a clear “tracking confidence is insufficient” outcome rather than silently waiting for four hits.

**Done when:** four-hit batches meet a documented hit-count accuracy target and coaches approve the feedback criteria.

## 2. Reliable session startup

**Goal:** a player can consistently start, recover, and understand a session.

- Add explicit states for unsupported browser, permission denied, no camera, model loading, ready, and recoverable failure.
- Add retry and camera-device selection.
- Add a first-run framing guide that verifies a whole body is visible before scoring.
- Define a manual browser/device acceptance checklist.

**Done when:** a user can recover from a denied or busy camera without reloading, and the UI does not produce a score until required landmarks are visible.

## 3. Make coaching signals trustworthy

**Goal:** replace unvalidated confidence with measurable, coach-reviewed feedback.

- Extract scoring rules into testable modules and add landmark fixtures for good, narrow, upright, and off-frame stances.
- Validate wording and score bands with pickleball coaches.
- Add an “insufficient confidence” state for unstable or occluded landmarks.
- Measure ball/paddle tracker precision and false positives on consented clips.

**Done when:** every displayed coaching rule has fixtures and acceptance criteria, and the UI distinguishes estimate quality from score quality.

## 4. Focus the practice experience

**Goal:** turn the diagnostic prototype into a guided ready-position drill.

- Add a clear Start/Stop session flow and a concise player-facing coach panel.
- Capture only derived, local session summaries (score trend, checklist completion) after explicit user consent.
- Move raw landmark/debug panels behind a developer mode.
- Add a short post-session summary with one or two actionable drills.

**Done when:** a first-time player can complete one focused drill without interpreting developer metrics.

## Later, only after validation

- Recorded-video analysis with an explicit upload/storage policy.
- More techniques (dinks, volleys, serves) and multi-angle capture.
- Personalized baselines and longitudinal progress.
- A self-hosted model asset strategy and offline-capable deployment.
