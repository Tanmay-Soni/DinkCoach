# Fatigue Score

The session summary — next to the four-hit dink review and the average-dink
avatar — includes a **Fatigue Score**: a 0–100 number (100 = form held steady
all session) that tells the player whether their posture is degrading as the
session wears on, plus the specific coaching insight behind any drop.

This is the "rep-over-rep trend" insight coaches give for free once you're
already tracking form hit by hit — e.g. noticing a player is standing taller
by the end of a session because their legs are tired, well before that shows
up as a missed shot.

## Why this is different from the four-hit review

The four-hit review (`lib/dinkReview.js`) scores each **batch** of four
contacts in isolation and resets between batches — it has no memory of batch 1
versus batch 9. The Fatigue Score instead keeps one sample **per hit** for the
whole session and compares the earliest hits against the latest hits, so it
can say something no single batch can: "your knee bend opened up over the
course of the session," not just "this batch's ready score was 74."

## Pipeline

```text
every dink hit ─(same measurements already computed for the 4-hit review)→ fatigue sample
samples (session-long) → per-metric early-third vs late-third comparison → fatigue score + insights
```

### 1. Sampling — `createFatigueSample` (`src/lib/fatigue.js`)

Rides the exact same hit path as the four-hit review. `App.jsx`'s
`recordDinkHit` already computes `getPostureMeasurements(landmarks)` and a
ready-position score for every hit (not just every fourth) — the fatigue
module reuses those, it does not re-derive posture from landmarks itself. Each
sample carries:

| field | source | meaning |
| --- | --- | --- |
| `kneeBendAngle` | avg of `leftKneeAngle`/`rightKneeAngle` | higher = straighter legs |
| `readyScore` | `getReadyPositionAnalysis(...).score` | 0–100 ready-position score |
| `stanceWidthRatio` | `feetToHipRatio` | feet width relative to hips |
| `torsoLeanMagnitude` | `abs(torsoLean)` | how far off-center the torso is |

### 2. Early/late comparison — `getEarlyLateComparison`

For each metric, valid `(hitIndex, value)` pairs are split into the first
third and last third of the session's hits (by count, not clock time — more
stable with uneven hit pacing) and averaged. A metric needs at least
`MIN_METRIC_SAMPLES` (6) valid values before a comparison is attempted; the
whole panel needs `MIN_SESSION_SAMPLES` (8) hits before it shows anything but
a "keep dinking" placeholder.

`linearRegressionSlope` is exposed alongside the early/late delta for anyone
who wants the trend direction as a single number, but the delta is what
drives the score and the copy — it's what a player can actually picture.

### 3. Concerning direction, per metric

A metric only counts against the score in the direction that reads as
fatigue, never the direction that reads as improvement:

| metric | flags when | reads as |
| --- | --- | --- |
| `kneeBendAngle` | delta > +6° | "standing taller as you tire" |
| `readyScore` | delta < −10 pts | "fatigue showing up in your setup" |
| `stanceWidthRatio` | delta < −0.25x | "not resetting your feet" |
| `torsoLeanMagnitude` | delta > +0.15 | "posture loosening up" |

Knees bending *more* by the end, or a ready score that *improves*, contributes
nothing to the score — it isn't penalized, but it also isn't rewarded. This is
a drift score, not a form score.

### 4. Fatigue Score

Each flagged metric contributes `min(2, |delta| / threshold)` (capped at 2x
its threshold); the score is `100 − (average contribution across all tracked
metrics ÷ 2) × 100`, floored at 0. A single metric drifting right at its
threshold pulls the score down by roughly 25 points (divided across however
many metrics had enough data); nothing flagged means a clean 100.

Status labels: `≥85` "Form held steady", `≥60` "Mild drift", below that
"Significant drift."

## Rendering

`FatigueDriftPanel.jsx` shows the score as a large number (same visual idiom
as the app's other score blocks), the status badge, a small two-point
sparkline per tracked metric (early average → late average), and the
plain-language insight for each metric that actually flagged, sorted by
severity. It renders nothing alarmist when nothing drifted — "your form held
up from your first hits to your last."

## Tuning

All thresholds (`driftThreshold` per metric, `MIN_SESSION_SAMPLES`,
`MIN_METRIC_SAMPLES`) live in `src/lib/fatigue.js`. Like the rest of this
repo's coaching signals, these are hand-authored heuristics, not validated
against labeled fatigue data — see `docs/KNOWN_ISSUES.md`'s "coaching
validity" entry. Validate against real multi-batch session footage (does knee
angle really open up ~6°+ for a visibly tired player, does that vary by camera
distance/angle) before treating the score as more than a prompt for practice.
