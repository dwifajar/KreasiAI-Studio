import { ElevenLabsClient } from '@elevenlabs/elevenlabs-js';

function getErrorMessage(error: unknown) {
  if (error instanceof Error) return error.message;
  if (typeof error === 'string') return error;
  try { return JSON.stringify(error); } catch { return 'ElevenLabs request failed'; }
}

export async function generateSpeech(text: string, voiceId?: string) {
  const apiKey = process.env.ELEVENLABS_API_KEY?.trim();
  const resolvedVoiceId = (voiceId || process.env.ELEVENLABS_VOICE_ID)?.trim();
  const modelId = (process.env.ELEVENLABS_MODEL_ID || 'eleven_v3').trim();

  if (!apiKey) throw new Error('ELEVENLABS_API_KEY belum diatur di .env.local.');
  if (!resolvedVoiceId) throw new Error('ELEVENLABS_VOICE_ID belum diatur di .env.local.');

  try {
    const client = new ElevenLabsClient({ apiKey });
    const audio = await client.textToSpeech.convert(resolvedVoiceId, {
      text: text.trim(),
      modelId,
      outputFormat: 'mp3_44100_128',
    });
    return Buffer.from(await new Response(audio as BodyInit).arrayBuffer());
  } catch (error) {
    const message = getErrorMessage(error);
    throw new Error(`ElevenLabs: ${message}`);
  }
}
