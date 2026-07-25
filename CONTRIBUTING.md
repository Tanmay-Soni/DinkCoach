# Contributing

Thanks for helping improve DinkAI. This repository is a browser-only prototype, so changes should preserve the user’s privacy and avoid implying clinical or validated coaching accuracy.

## Before opening a pull request

1. Create a focused branch and describe the user-facing behavior being changed.
2. Run `npm ci` and `npm run check`.
3. Add or update deterministic tests when changing scoring, geometry, or tracker-selection logic.
4. Manually verify webcam startup, cleanup, and calibration in a browser when touching camera or canvas code.
5. Do not commit videos, screenshots containing people, recordings, secrets, or `node_modules`.

## Development principles

- Keep inference in the browser unless the product explicitly adopts a reviewed server-side data policy.
- Treat camera data and pose landmarks as sensitive user data.
- Prefer an “insufficient data” result to a confident-looking guess.
- Keep thresholds, model versions, and their intended behavior documented and testable.

## Pull request checklist

- [ ] `npm run check` passes locally.
- [ ] Documentation reflects user-visible or architectural changes.
- [ ] Camera/model resources are cleaned up on unmount or retry.
- [ ] New score or feedback claims include validation criteria.
- [ ] No personal media, tokens, or generated build output is included.

For vulnerabilities, use the private reporting process in [SECURITY.md](SECURITY.md) rather than a public issue.
