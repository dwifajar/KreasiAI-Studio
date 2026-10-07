import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import crypto from 'node:crypto';
import { createRequire } from 'node:module';
import ffmpegStatic from 'ffmpeg-static';

const runtimeRequire = createRequire(import.meta.url);

const execFileAsync = promisify(execFile);

function escapePath(value: string) {
  return value.replace(/\\/g, '/').replace(/:/g, '\\:').replace(/'/g, "\\'");
}

function resolveFfmpeg() {
  const configured = process.env.FFMPEG_PATH?.trim();
  let staticCandidate = '';
  try {
    const mod: any = runtimeRequire('ffmpeg-static');
    staticCandidate = typeof mod === 'string' ? mod : (typeof mod?.default === 'string' ? mod.default : '');
  } catch {
    const mod: any = ffmpegStatic as any;
    staticCandidate = typeof mod === 'string' ? mod : (typeof mod?.default === 'string' ? mod.default : '');
  }
  const cwdCandidate = process.platform === 'win32'
    ? path.join(process.cwd(), 'node_modules', 'ffmpeg-static', 'ffmpeg.exe')
    : path.join(process.cwd(), 'node_modules', 'ffmpeg-static', 'ffmpeg');
  return process.env.VERCEL
    ? staticCandidate || cwdCandidate || configured || 'ffmpeg'
    : configured || staticCandidate || cwdCandidate || 'ffmpeg';
}

async function findFont() {
  const packageFont = 'Inter-VariableFont_slnt,wght.ttf';
  const candidates: string[] = [
    process.env.KAI_FONT_FILE?.trim(),
    path.join(process.cwd(), 'node_modules', 'inter-font', packageFont),
    '/var/task/node_modules/inter-font/Inter-VariableFont_slnt,wght.ttf',
    process.platform === 'win32' ? path.join(process.env.WINDIR || 'C:\\Windows', 'Fonts', 'arial.ttf') : '',
    process.platform === 'win32' ? path.join(process.env.WINDIR || 'C:\\Windows', 'Fonts', 'segoeui.ttf') : '',
    '/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf',
    '/usr/share/fonts/truetype/liberation2/LiberationSans-Regular.ttf',
  ].filter(Boolean) as string[];



  for (const candidate of candidates) {
    try { await fs.access(candidate); return candidate; } catch {}
  }

  throw new Error('Font tidak ditemukan untuk Local Video. Pastikan dependency inter-font sudah ada di package.json/package-lock.json dan lakukan redeploy.');
}

export async function generateLocalVideoClip(input: {
  prompt: string;
  camera?: string;
  tone?: string;
  durationSeconds: 4 | 6 | 8;
  resolution: '720p' | '1080p' | '4K';
  aspectRatio: '16:9' | '9:16';
}) {
  const ffmpeg = resolveFfmpeg();
  const font = await findFont();
  if (!font) throw new Error('Font tidak ditemukan untuk Local Video. Set KAI_FONT_FILE di .env.local.');

  const dims = input.aspectRatio === '9:16'
    ? input.resolution === '4K' ? '2160x3840' : input.resolution === '1080p' ? '1080x1920' : '540x960'
    : input.resolution === '4K' ? '3840x2160' : input.resolution === '1080p' ? '1920x1080' : '1280x720';

  const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'kreasiai-local-video-'));
  const output = path.join(tmpDir, `local-${crypto.randomUUID()}.mp4`);
  const visualFile = path.join(tmpDir, 'visual.txt');
  const metaFile = path.join(tmpDir, 'meta.txt');
  const safeFont = escapePath(font);
  await fs.writeFile(visualFile, String(input.prompt || 'Local scene preview').trim(), 'utf8');
  await fs.writeFile(metaFile, `${input.camera || 'camera'} • ${input.tone || 'cinematic'}`, 'utf8');

  const filter = [
    `drawtext=fontfile='${safeFont}':text='KreasiAI Local Scene Preview':x=w*0.06:y=h*0.07:fontsize=w*0.022:fontcolor=0x9ee6b9:box=1:boxcolor=black@0.28:boxborderw=12`,
    `drawtext=fontfile='${safeFont}':textfile='${escapePath(visualFile)}':x=w*0.06:y=h*0.20:fontsize=w*0.032:fontcolor=white:line_spacing=14:box=1:boxcolor=black@0.33:boxborderw=20`,
    `drawtext=fontfile='${safeFont}':textfile='${escapePath(metaFile)}':x=w*0.06:y=h*0.78:fontsize=w*0.017:fontcolor=white@0.78`,
    `drawtext=fontfile='${safeFont}':text='LOCAL FALLBACK - NO AI QUOTA USED':x=w*0.06:y=h*0.90:fontsize=w*0.014:fontcolor=0xffd27d`,
  ].join(',');

  try {
    await execFileAsync(ffmpeg, [
      '-y', '-f', 'lavfi', '-i', `color=c=0x07110d:s=${dims}:r=25:d=${input.durationSeconds}`,
      '-vf', filter,
      '-t', String(input.durationSeconds),
      '-r', '25',
      '-an',
      '-c:v', 'libx264',
      '-preset', input.resolution === '4K' ? 'medium' : 'veryfast',
      '-crf', input.resolution === '4K' ? '18' : input.resolution === '1080p' ? '20' : '22',
      '-pix_fmt', 'yuv420p',
      '-movflags', '+faststart',
      output,
    ], { timeout: 5 * 60_000, windowsHide: true, maxBuffer: 20 * 1024 * 1024 });

    const buffer = await fs.readFile(output);
    return { buffer, outputPath: output, durationSeconds: input.durationSeconds, provider: 'local', model: 'kreasiai-local-scene-v1' };
  } catch (error: any) {
    const stderr = String(error?.stderr || error?.message || 'FFmpeg local video gagal').trim();
    throw new Error(`Local Video: ${stderr.slice(-5000)}`);
  } finally {
    await fs.rm(tmpDir, { recursive: true, force: true }).catch(() => undefined);
  }
}
