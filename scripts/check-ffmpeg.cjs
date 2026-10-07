const { execFileSync } = require('node:child_process');
const custom = process.env.FFMPEG_PATH && process.env.FFMPEG_PATH.trim();
const command = custom || 'ffmpeg';
try {
  const out = execFileSync(command, ['-version'], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true });
  const first = String(out).split(/\r?\n/)[0] || 'FFmpeg detected';
  console.log(`✓ ${first}`);
} catch (error) {
  console.error('✗ FFmpeg tidak ditemukan. Install FFmpeg dan pastikan "ffmpeg" tersedia di PATH, atau set FFMPEG_PATH.');
  process.exit(1);
}
