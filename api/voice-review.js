const DEFAULT_VOICE_ID = 'pNInz6obpgDQGcFmaJgB';

export default async function voiceReview(request, response) {
  if (request.method !== 'POST') {
    response.setHeader('Allow', 'POST');
    response.status(405).send('Method not allowed');
    return;
  }

  const apiKey = process.env.ELEVENLABS_API_KEY;
  if (!apiKey) {
    response.status(503).json({ error: 'ELEVENLABS_API_KEY is not configured.' });
    return;
  }

  try {
    const text = await getRequestText(request);
    const voiceId = process.env.ELEVENLABS_VOICE_ID || DEFAULT_VOICE_ID;
    const endpoint =
      process.env.ELEVENLABS_TTS_ENDPOINT ||
      `https://api.elevenlabs.io/v1/text-to-speech/${voiceId}`;
    const elevenLabsResponse = await fetch(endpoint, {
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
    });

    if (!elevenLabsResponse.ok) {
      console.error('ElevenLabs voice request failed:', elevenLabsResponse.status);
      response.status(502).json({ error: 'ElevenLabs could not generate the review.' });
      return;
    }

    response.setHeader(
      'Content-Type',
      elevenLabsResponse.headers.get('content-type') || 'audio/mpeg',
    );
    response.setHeader('Cache-Control', 'no-store');
    response.status(200).send(Buffer.from(await elevenLabsResponse.arrayBuffer()));
  } catch (error) {
    console.error('Voice review request failed:', error);
    response.status(400).json({ error: 'A short review message is required.' });
  }
}

async function getRequestText(request) {
  const body = request.body ?? (await readRequestBody(request));
  const parsedBody = typeof body === 'string' ? JSON.parse(body) : body;
  const { text } = parsedBody || {};

  if (typeof text !== 'string' || !text.trim() || text.length > 2000) {
    throw new Error('Invalid review text.');
  }

  return text.trim();
}

function readRequestBody(request) {
  return new Promise((resolve, reject) => {
    let body = '';

    request.on('data', (chunk) => {
      body += chunk;
      if (body.length > 4000) {
        reject(new Error('Request body is too large.'));
        request.destroy();
      }
    });
    request.on('end', () => resolve(body));
    request.on('error', reject);
  });
}
