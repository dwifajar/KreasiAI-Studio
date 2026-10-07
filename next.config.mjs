/** @type {import('next').NextConfig} */
const nextConfig = {
  serverExternalPackages: ['ffmpeg-static'],
  outputFileTracingIncludes: {
    '/api/content/render/production': [
      './node_modules/ffmpeg-static/**/*',
      './node_modules/@fontsource/inter/files/**/*',
    ],
    '/api/generate/video': [
      './node_modules/ffmpeg-static/**/*',
      './node_modules/@fontsource/inter/files/**/*',
    ],
    '/api/content/plan': [
      './node_modules/@fontsource/inter/files/**/*',
    ],
  },
};

export default nextConfig;
