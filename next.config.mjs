/** @type {import('next').NextConfig} */
const nextConfig = {
  // Keep native/runtime packages external so their binaries/assets remain available at runtime.
  serverExternalPackages: ['ffmpeg-static', 'inter-font'],
  // Only trace FFmpeg's runtime files here. Do NOT glob .ttf files: Turbopack treats raw TTFs as modules during build.
  outputFileTracingIncludes: {
    '/api/content/render/production': [
      './node_modules/ffmpeg-static/**/*',
    ],
    '/api/generate/video': [
      './node_modules/ffmpeg-static/**/*',
    ],
  },
};

export default nextConfig;
