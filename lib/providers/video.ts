export type VideoProviderId = 'smart' | 'veo' | 'local';

export type VideoGenerationRequest = {
  prompt: string;
  aspectRatio: '16:9' | '9:16';
  resolution: '720p' | '1080p' | '4K';
  durationSeconds: 4 | 6 | 8;
  model?: string;
};

export function getVideoProvider(id: string) {
  if (id === 'veo') {
    return {
      id: 'veo' as const,
      label: 'Google Veo 3.1',
      configured: Boolean(process.env.GOOGLE_API_KEY?.trim()),
      nativeAudio: true,
    };
  }
  if (id === 'local') {
    return {
      id: 'local' as const,
      label: 'KreasiAI Local Scene Preview',
      configured: Boolean(process.env.FFMPEG_PATH?.trim()) || true,
      nativeAudio: false,
    };
  }
  if (id === 'smart' || id === 'auto') {
    return {
      id: 'smart' as const,
      label: 'Smart Auto',
      configured: true,
      nativeAudio: true,
    };
  }
  throw new Error(`Provider video tidak dikenal: ${id}`);
}

export function defaultVideoProvider(): VideoProviderId {
  return 'smart';
}
