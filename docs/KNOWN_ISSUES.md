# Known issues and product gaps

## Current issues

| Priority | Area | Issue | Impact | Recommended resolution |
| --- | --- | --- | --- | --- |
| High | Model reliability | Ball and paddle detections, and therefore four-hit batching, are heuristic and have no accuracy benchmark. | False or missed contacts can make a four-hit review misleading. | Collect consented test clips, label real contacts, define hit-count accuracy targets, and evaluate before treating a batch as coaching input. |
| High | Coaching validity | Ready-position thresholds are hand-tuned rather than coach-validated. | A numeric score can imply accuracy that has not been established. | Add a calibration/validation plan with certified coaches and show confidence/insufficient-data states. |
| High | Camera lifecycle | Camera/model setup, tracking, drawing, and view rendering are coupled in `App.jsx`. | Hard to change safely and difficult to test. | Follow the extraction path in `ARCHITECTURE.md`. |
| Medium | Browser support | The app has not been tested against a browser/camera support matrix. | Some devices may fail to initialize models, WebGL, or camera permissions. | Add manual acceptance coverage for Chrome, Safari, Firefox, desktop, and mobile. |
| Medium | User recovery | There is no in-app retry, camera selector, or explanatory permission state. | A denied/busy camera leaves users without an obvious recovery path. | Add a camera state machine, retry action, and device picker. |
| Medium | Accessibility | Pointer-based calibration has no keyboard-equivalent workflow. | Keyboard-only users cannot create a calibration region. | Provide numeric/manual calibration controls or an accessible guided alternative. |
| Medium | Runtime assets | Model and WASM assets depend on public CDNs. | Offline, restrictive-network, or supply-chain conditions can prevent startup. | Pin and self-host assets with integrity/version review before production. |
| Low | Persistence | Calibration and session context reset on reload. | Repeated setup creates friction. | Persist explicit user-approved preferences locally after a privacy review. |
| Low | Performance observability | There is no structured performance/error telemetry. | Regressions are difficult to detect. | Add opt-in, privacy-preserving telemetry only after product consent and policy work. |

## Resolved in this baseline pass

- Switching the paddle-hand control no longer tears down and restarts the camera/model pipeline.
- Core normalized-landmark geometry is now isolated and unit tested.
- The repository now has an install/build/test contract, CI, contribution guidance, security reporting instructions, and a scoped roadmap.
