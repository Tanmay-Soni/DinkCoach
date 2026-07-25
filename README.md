# DinkAI

React + Vite webcam pose tracking prototype using MediaPipe Pose Landmarker.

## Run locally

```bash
npm install
npm run dev
```

Open the local Vite URL in a browser and allow camera access. The app runs fully in the browser and draws pose landmarks plus skeleton connections over the webcam feed.

## Voice reviews

DinkAI counts a fast wrist movement as an estimated hit and gives a ready-position review after every four hits. It works immediately with the browser's built-in text-to-speech voice.

For an ElevenLabs voice, copy `.env.example` to `.env.local`, add your `ELEVENLABS_API_KEY`, and optionally choose an `ELEVENLABS_VOICE_ID` or full `ELEVENLABS_TTS_ENDPOINT`. Start the app with `npm run dev`; the local Vite server keeps the key on the server and proxies audio to the browser. Use the **Test voice** button once after opening the app so the browser permits audio playback.

For deployment, set `VITE_TTS_ENDPOINT` to a server-side endpoint that accepts `POST { "text": "..." }` and returns MP3 audio. That endpoint must hold the ElevenLabs key; do not expose it in a `VITE_` variable.
