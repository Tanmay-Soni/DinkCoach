# DinkAI

DinkAI is a browser-based pickleball dink coaching prototype. It continuously tracks stance, motion, paddle position, and ball movement, then gives the player one focused review after each sequence of four likely dink contacts.

> This is an experimental training aid, not a medical, safety, officiating, or performance-measurement tool. Scores are heuristic estimates from a single camera view.

## What it does today

- Starts a local webcam feed and draws pose landmarks over it.
- Counts a likely dink contact when a fresh ball approaches the calibrated paddle and then reverses away from it.
- Batches four likely contacts into one player-facing review of ready position, contact spacing, and swing consistency.
- Scores a ready position from visible shoulders, hips, knees, ankles, and wrists.
- Shows posture, motion, action, and landmark-debug data.
- Detects a possible paddle near the selected wrist using a calibrated color profile.
- Tracks a calibrated ball-color blob at a fast cadence and uses COCO-SSD as a slower secondary confirmation.
- Lets a player sample a pixel or drag a tight selection over a ball or paddle to calibrate color tracking.

All inference runs in the browser. The app has no backend, user accounts, analytics, or intentional video storage or upload.

## Quick start

### Requirements

- Node.js 20 or newer (Node 22 is used in CI)
- A recent Chromium-, Firefox-, or Safari-based browser
- A webcam and permission to use it

### Install and run

```bash
npm ci
npm run dev
```

Open the URL printed by Vite. Camera access requires `localhost` during development or HTTPS in a deployed environment.

Useful commands:

```bash
npm run test     # unit tests for deterministic coaching geometry
npm run build    # production bundle
npm run check    # test, then build
npm run preview  # serve a completed production bundle
```

## Using the prototype

1. Position the camera far enough away to show your shoulders, hips, knees, and feet. A front-on, stable view works best.
2. Allow webcam access and wait for the status to become “Tracking pose.”
3. Select the hand that holds your paddle.
4. If ball or paddle color tracking is unreliable, select its calibration target and drag a tight box over the object. A click samples one pixel for diagnosis.
5. Watch the “Four-Hit Dink Review” counter. After its fourth dot, use the completed review to guide the next sequence; live tracking continues immediately with a new batch.
6. Treat the coach score as a prompt for practice, not a definitive assessment. Check that the visible skeleton tracks the player before trusting the result.

## Architecture

The application is deliberately client-only:

```text
Webcam → MediaPipe Pose Landmarker → normalized landmarks → coaching/motion heuristics ┐
       ↘ COCO-SSD + calibrated color tracking → likely contact detector → 4-hit review ─┴→ React UI
```

- `src/App.jsx` owns camera lifecycle, model loading, rendering, trackers, and the current prototype UI.
- `src/lib/geometry.js` contains reusable, tested validation and measurement primitives for normalized landmarks.
- `src/lib/dinkReview.js` defines conservative contact qualification and four-hit review aggregation.
- `test/` contains Node’s built-in test runner tests; it does not require a browser or webcam.
- `docs/ARCHITECTURE.md` records runtime boundaries and the intended extraction path.

Models and the MediaPipe WebAssembly runtime are fetched from public CDNs at runtime. Deployments therefore need outbound access to those endpoints or a future asset-hosting strategy.

## Known limits

- The pose model is configured for one person and a front-facing camera. Occlusion, camera angle, loose clothing, poor lighting, and partial-body framing reduce reliability.
- A 2D camera cannot reliably assess depth, joint rotation, spin, contact, or true ball speed. The ball tracker preserves short gaps and follows the closest valid color blob, but it is still not a verified physics or contact tracker.
- COCO-SSD is a general object detector; a regulation pickleball is small and may not be reliably recognized. Color tracking is sensitive to lighting and similarly colored surfaces.
- The score thresholds are hand-authored heuristics, not validated coaching science.
- A “hit” is a conservative visual proxy, not verified ball contact. It needs calibration against real rally footage before performance claims are made.
- The app currently has no camera selector, retry button, recorded-session workflow, user settings persistence, or automated browser tests.

See [known issues](docs/KNOWN_ISSUES.md) and the [near-term roadmap](docs/ROADMAP.md) before planning product work.

## Development workflow

- Keep changes small and test deterministic logic with `npm run test`.
- Run `npm run check` before opening a pull request.
- Do not commit `node_modules`, builds, recordings, or camera captures.
- Keep camera/model work client-side unless a proposed feature explicitly needs server processing.

The CI workflow runs the same `npm ci` and `npm run check` commands on Node 22. Contribution and disclosure expectations are in [CONTRIBUTING.md](CONTRIBUTING.md) and [SECURITY.md](SECURITY.md).

## License

This project is released under the [MIT License](LICENSE).

## Voice reviews

DinkAI speaks the completed four-hit review through the browser’s built-in text-to-speech voice. For an ElevenLabs voice, copy `.env.example` to `.env.local`, set `ELEVENLABS_API_KEY`, and optionally set `ELEVENLABS_VOICE_ID` or `ELEVENLABS_TTS_ENDPOINT`. The local Vite server keeps the key on the server and proxies audio to the browser.

For deployment, set `VITE_TTS_ENDPOINT` to a server-side endpoint that accepts `POST { "text": "..." }` and returns MP3 audio. That endpoint must hold the ElevenLabs key; do not expose it in a `VITE_` variable. Use **Test voice** once after opening the app so the browser permits audio playback.
