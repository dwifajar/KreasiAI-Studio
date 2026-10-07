/** @type {import('next').NextConfig} */
const nextConfig = {
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
