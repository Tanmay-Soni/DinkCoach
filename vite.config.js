import { defineConfig, loadEnv } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';

function voiceReviewApi() {
  return {
    name: 'voice-review-api',
    configureServer(server) {
      server.middlewares.use('/api/voice-review', createVoiceReviewHandler());
    },
    configurePreviewServer(server) {
      server.middlewares.use('/api/voice-review', createVoiceReviewHandler());
    },
  };
}

function createVoiceReviewHandler() {
  return async (request, response) => {
    if (request.method !== 'POST') {
      response.writeHead(405, { Allow: 'POST' });
      response.end('Method not allowed');
      return;
    }

    const apiKey = process.env.ELEVENLABS_API_KEY;
    // Adam is a warm, conversational voice that suits short coaching feedback.
    const voiceId = process.env.ELEVENLABS_VOICE_ID || 'pNInz6obpgDQGcFmaJgB';
    const elevenLabsEndpoint =
      process.env.ELEVENLABS_TTS_ENDPOINT ||
      `https://api.elevenlabs.io/v1/text-to-speech/${voiceId}`;

    if (!apiKey) {
      response.writeHead(503, { 'Content-Type': 'application/json' });
      response.end(JSON.stringify({ error: 'ELEVENLABS_API_KEY is not configured.' }));
      return;
    }

    try {
      const text = await getRequestText(request);
      const elevenLabsResponse = await fetch(
        elevenLabsEndpoint,
        {
          method: 'POST',
          headers: {
            Accept: 'audio/mpeg',
            'Content-Type': 'application/json',
            'xi-api-key': apiKey,
          },
          body: JSON.stringify({
            text,
            model_id: 'eleven_multilingual_v2',
            voice_settings: { stability: 0.55, similarity_boost: 0.75 },
          }),
        },
      );

      if (!elevenLabsResponse.ok) {
        const error = await elevenLabsResponse.text();
        console.error('ElevenLabs voice request failed:', elevenLabsResponse.status, error);
        response.writeHead(502, { 'Content-Type': 'application/json' });
        response.end(JSON.stringify({ error: 'ElevenLabs could not generate the review.' }));
        return;
      }

      response.writeHead(200, {
        'Content-Type': elevenLabsResponse.headers.get('content-type') || 'audio/mpeg',
        'Cache-Control': 'no-store',
      });
      response.end(Buffer.from(await elevenLabsResponse.arrayBuffer()));
    } catch (error) {
      console.error('Voice review request failed:', error);
      response.writeHead(400, { 'Content-Type': 'application/json' });
      response.end(JSON.stringify({ error: 'A short review message is required.' }));
    }
  };
}

function getRequestText(request) {
  return new Promise((resolve, reject) => {
    let body = '';

    request.on('data', (chunk) => {
      body += chunk;
      if (body.length > 4000) {
        reject(new Error('Request body is too large.'));
        request.destroy();
      }
    });
    request.on('end', () => {
      try {
        const { text } = JSON.parse(body);
        if (typeof text !== 'string' || !text.trim() || text.length > 2000) {
          throw new Error('Invalid review text.');
        }
        resolve(text.trim());
      } catch (error) {
        reject(error);
      }
    });
    request.on('error', reject);
  });
}

export default defineConfig(({ mode }) => {
  const environment = loadEnv(mode, process.cwd(), '');
  Object.assign(process.env, environment);

  return {
    plugins: [react(), tailwindcss(), voiceReviewApi()],
  };
});
