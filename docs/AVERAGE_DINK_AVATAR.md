# Average dink avatar

The post-session summary shows a composite skeleton that represents the player's
**own average dink** across the session — not a reference "correct" clip and not a
single rep, but a synthesized composite built from their recorded contacts. It is
diagnostic (showing them themselves), not prescriptive.

This is the "short post-session summary" from roadmap item 4, rendered as a
volumetric body rather than raw debug landmarks.

## Why averaging is non-trivial

Reps differ in duration, tempo, and start/end alignment. Averaging raw
frame-index to frame-index across reps of different length blends one rep's
backswing against another's contact frame and produces a meaningless skeleton.
The fix is temporal alignment before averaging: every rep is anchored on its
contact frame and resampled onto a common slot grid, then averaged per slot.

## Pipeline

```text
pose frames ─┐
             ├─(dink contact from lib/dinkReview.js)→ poseHitRecorder → reps
             ┘
reps → confidence gate → contact-anchored resample → per-joint median → composite asset → CompositeAvatarPlayer
                                                                        └→ recurring-fault aggregation → highlighted joints
```

### 1. Recording — `src/lib/avatar/poseHitRecorder.js`

The recorder does **not** run its own swing segmentation. It rides the contact
detection already in `lib/dinkReview.js`:

- `App.jsx` calls `pushFrame({ t, kp })` every pose frame (raw 33-landmark array),
  keeping a short rolling buffer.
- When `getDinkContactUpdate` reports a hit, `App.jsx` calls
  `registerHit(contactT)`.
- Once enough post-contact frames have arrived, the recorder slices
  `[contactT − windowBeforeMs, contactT + windowAfterMs]` into a rep and fires its
  `onReps` callback so the composite rebuilds.

### 2. Confidence gate — `composite.js`

A rep joins the averaging pool only if its mean core-joint `visibility` clears
`minMeanVisibility` and the contact frame has all core joints in-frame
(`isUsableLandmark`). Excluded reps are counted for the "based on N of M reps"
caption.

### 3. Normalization — `normalize.js`

Contact-anchored (Option B). Each rep is resampled to slots
`[−windowBefore … +windowAfter]` relative to contact via linear interpolation in
time. A joint is `null` for a slot when tracking was unusable there — nulls are
skipped downstream, never fabricated.

### 4. Averaging — `average.js`

Per slot, per joint: component-wise **median** of `(x, y)` across reps (robust to
tracking-noise outliers). A joint needs `minJointSamples` contributing reps or it
is `null` for that slot.

### 5. Faults — `faults.js`

Per-rep detection reuses the live geometry (`lib/geometry.js`) at the contact
frame:

| fault | signal |
| --- | --- |
| `poor_knee_bend` | avg knee angle at contact > 168° |
| `off_balance` | max(shoulder tilt, hip tilt) at contact > 12° |
| `paddle_too_low` | swing wrist below hip midpoint at contact |
| `long_backswing` | swing-wrist travel from shoulder > 0.22 (normalized) |

A fault is "recurring" when it fires in ≥ `faultThreshold` (default 30%) of the
session's reps. Recurring faults highlight **all at once** on the composite —
this is a review screen, so the live one-at-a-time rule does not apply.

### 6. Rendering — `src/components/`

`avatarBodyRenderer.js` draws each composite frame as a fleshed-out mannequin:

- Tapered **capsule** limbs (a filled quad between two joints plus a circle cap of
  each end's radius), a filled torso quad with rounded shoulder/hip balls and a
  spine capsule, an ellipse head and a neck capsule.
- Radii scale to on-screen shoulder width so the body auto-sizes to framing.
- Two passes — a bright rim (`radius + 3px`) then a darker fill (`radius`) —
  produce a clean outline without per-segment seams.
- The tracked landmarks are drawn as markers on top; recurring-fault joints get a
  persistent pulsing ring (steady when `prefers-reduced-motion`).

`CompositeAvatarPlayer.jsx` loops the frames at the asset's `fps`, honoring the
live view's mirroring (`facingMode: 'user'`) so left/right match the session.
`AverageDinkAvatarPanel.jsx` frames it with the rep-count caption and the
recurring-fault legend, and falls back to a "keep dinking" state until enough
clean reps exist.

## Data contract

`buildSessionComposite` returns:

```jsonc
{
  "fps": 30,
  "joints": ["nose", "leftShoulder", "rightShoulder", "..."],
  "source": "session_composite",
  "swingSide": "right",
  "repCountIncluded": 14,
  "repsExcludedLowConfidence": 3,
  "totalRecorded": 17,
  "recurringFaults": ["poor_knee_bend", "long_backswing"],
  "faultStats": { "poor_knee_bend": { "flagged": 9, "total": 14, "ratio": 0.64 } },
  "highlightJoints": ["leftKnee", "rightKnee", "rightShoulder", "rightElbow"],
  "frames": [
    { "phase": "pre_contact_-15", "slot": -15, "keypoints": { "leftWrist": [0.41, 0.54], "...": null } }
  ]
}
```

`keypoints` values are `[x, y]` normalized 0–1, the same space the pose model
outputs and the live overlay renders. When a session has fewer than
`minRepsForComposite` clean reps, the builder returns `{ insufficient: true, ... }`
and the panel shows the "keep dinking" state.

## Tuning

All parameters live in `src/lib/avatar/constants.js` (recorder window, slot grid,
median sample floor, confidence gate, fps) and the `THRESHOLDS` in `faults.js`.
Per the roadmap's "make coaching signals trustworthy," validate the fault
thresholds against labeled session footage before treating them as coaching truth.
