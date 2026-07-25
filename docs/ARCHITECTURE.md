# Architecture

## Runtime flow

`App.jsx` requests a user-facing webcam stream and attaches it to a muted video element. Once video metadata is available, it starts two independent browser-side workloads:

1. MediaPipe Pose Landmarker runs on each new video frame and yields one normalized landmark set.
2. A calibrated color tracker runs independently at a short interval for ball continuity. TensorFlow.js COCO-SSD runs less frequently as a secondary ball confirmation so its inference latency does not block the color path.

The pose frame updates the canvas overlay, motion history, paddle tracker, and periodically smoothed coaching measurements. A contact is eligible when a fresh ball approaches the calibrated paddle and then departs from it, rather than from wrist speed alone. Eligible contacts are accumulated in memory; exactly four produce one review, then the next batch begins. Every raw pose frame is also buffered by `poseHitRecorder`, which slices a window around each eligible contact into a "rep" for the session-long average-dink avatar and Fatigue Score; both rebuild as reps/hits accumulate rather than resetting every four hits. React state drives the panels below the video. Cleanup stops animation frames, timeouts, webcam tracks, and model objects when the component unmounts.

## Data boundaries

- Video frames, landmarks, calibration values, and scores stay in browser memory only.
- No API calls are made by this repository for user data.
- Third-party model/WASM assets are loaded from the URLs declared in `App.jsx`; this is a runtime availability and privacy-review boundary for a production deployment.

## Source layout

```text
src/
  App.jsx                       camera lifecycle, trackers, scoring orchestration, UI
  lib/dinkReview.js             likely-contact qualification and four-hit review rules
  lib/geometry.js                pure normalized-landmark validation and geometry
  lib/avatar/                    post-session composite "average dink" avatar pipeline
    poseHitRecorder.js           slices a pose-frame window around each contact into a rep
    normalize.js, average.js     contact-anchored resampling and per-joint median averaging
    faults.js, composite.js      per-rep fault detection and the session composite asset
  lib/fatigue.js                 session-long early-vs-late trend comparison (Fatigue Score)
  components/
    avatarBodyRenderer.js, CompositeAvatarPlayer.jsx, AverageDinkAvatarPanel.jsx
    FatigueDriftPanel.jsx        Fatigue Score panel
  main.jsx                      React entry point
  styles.css                    visual presentation
test/
  geometry.test.js       deterministic unit coverage for geometry helpers
  dinkReview.test.js     four-hit review and contact-qualification coverage
  avatarComposite.test.js  average-dink-avatar pipeline coverage
  fatigue.test.js         Fatigue Score pipeline coverage
```

## Extraction path

The initial prototype intentionally remains one screen, but `App.jsx` is large. Extract in this order to avoid broad behavior changes:

1. Move coaching measurement/scoring functions into `src/lib/coaching/` with fixture-based tests.
2. Move ball and paddle color-tracking code into `src/lib/tracking/`, separating frame processing from React state.
3. Encapsulate webcam/model setup in a `useCameraTracking` hook with explicit lifecycle states.
4. Split the diagnostic panels into presentational components once their inputs are stable.

Do not move model initialization into a server process: this prototype’s privacy posture depends on local browser inference.
