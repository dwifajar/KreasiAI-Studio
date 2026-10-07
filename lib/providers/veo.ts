import { GoogleGenAI } from '@google/genai';
import type { VideoGenerationRequest } from './video';

function client() {
  const apiKey = process.env.GOOGLE_API_KEY?.trim();
  if (!apiKey) throw new Error('GOOGLE_API_KEY belum diatur. Tambahkan API key Google di .env.local.');
  return new GoogleGenAI({ apiKey });
}

function normalizeResolution(value: string) {
  return value === '4K' ? '4k' : value;
}

function normalizeDuration(value: number, resolution: string): 4 | 6 | 8 {
  if (resolution !== '720p') return 8;
  if (value <= 4) return 4;
  if (value <= 6) return 6;
  return 8;
}

export function getVeoModel() {
  return process.env.VEO_MODEL?.trim() || 'veo-3.1-generate-preview';
}

export function chooseVeoDuration(sceneSeconds: number, resolution: string) {
  return normalizeDuration(Number(sceneSeconds || 0), resolution);
}

export async function startVideoGeneration(request: VideoGenerationRequest) {
  const ai = client();
  const model = request.model?.trim() || getVeoModel();
  const durationSeconds = normalizeDuration(request.durationSeconds, request.resolution);
  const operation = await ai.models.generateVideos({
    model,
    prompt: request.prompt,
    config: {
      aspectRatio: request.aspectRatio,
      resolution: normalizeResolution(request.resolution),
      durationSeconds,
      numberOfVideos: 1,
      personGeneration: 'allow_all',
    } as never,
  });
  if (!operation.name) throw new Error('Veo tidak mengembalikan operation name.');
  return { name: operation.name, model, durationSeconds };
}

export async function getVideoOperation(name: string) {
  return client().operations.getVideosOperation({ operation: { name } as never });
}

export async function downloadVideo(video: unknown) {
  const ai = client();
  const file = video as any;
  const os = await import('node:os');
  const path = `${os.tmpdir()}/${Date.now()}-kreasiai-veo.mp4`;
  await ai.files.download({ file, downloadPath: path });
  const fs = await import('node:fs/promises');
  const data = await fs.readFile(path);
  await fs.rm(path, { force: true }).catch(() => undefined);
  return data;
}
