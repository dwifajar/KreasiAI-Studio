/** @type {import('next').NextConfig} */
const nextConfig = {
  serverExternalPackages: ['ffmpeg-static', 'inter-font'],
  outputFileTracingIncludes: {
    '/api/content/render/production': [
      './node_modules/ffmpeg-static/**/*',
      './node_modules/inter-font/ttf/**/*',
    ],
    '/api/generate/video': [
      './node_modules/ffmpeg-static/**/*',
      './node_modules/inter-font/ttf/**/*',
    ],
  },
};

export default nextConfig;
