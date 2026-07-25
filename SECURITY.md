# Security policy

## Supported version

Security fixes are applied to the current `main` branch while this project is in prototype development.

## Reporting a vulnerability

Please do not open a public issue for a suspected vulnerability, privacy concern, exposed credential, or model-asset supply-chain problem. Report it privately to the repository owner through the hosting platform’s private vulnerability-reporting feature, or use the owner’s published security contact.

Include a description, reproduction steps, affected files or dependency versions, and any suggested mitigation. Do not include user camera recordings or personally identifiable media unless explicitly requested through a secure channel.

## Scope notes

DinkAI requests a webcam stream in the browser and loads third-party model assets at runtime. Changes that transmit, store, log, or otherwise retain video, landmarks, calibration data, or session data require a privacy and security review before merge.
