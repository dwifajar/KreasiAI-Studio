/** @type {import('next').NextConfig} */
const nextConfig = {
  serverExternalPackages: ['ffmpeg-static'],
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
