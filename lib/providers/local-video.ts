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

function escapeSubtitleText(text: string) {
  return String(text || '')
    .replaceAll(String.fromCharCode(13), '')
    .replaceAll(String.fromCharCode(10), ' ')
    .replaceAll('{', '(')
    .replaceAll('}', ')');
}

function subtitleTime(seconds: number) {
  const ms = Math.max(0, Math.round(seconds * 1000));
  const h = Math.floor(ms / 3600000);
  const m = Math.floor((ms % 3600000) / 60000);
  const s = Math.floor((ms % 60000) / 1000);
  const milli = ms % 1000;
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')},${String(milli).padStart(3, '0')}`;
}

function escapeFilterFilename(value: string) {
  const slash = String.fromCharCode(92);
  return String(value).split(slash).join('/').split(':').join(slash + ':').split("'").join(slash + "'");
}

function buildLocalSrt(input: { prompt: string; camera?: string; tone?: string }, duration: number, width: number, height: number) {
  const slash = String.fromCharCode(92);
  const end = subtitleTime(duration);
  const lines = [
    '1',
    `00:00:00,000 --> ${end}`,
    `{${slash}an7${slash}pos(${Math.round(width * 0.06)},${Math.round(height * 0.07)})${slash}fs28${slash}b1}KreasiAI Local Scene Preview`,
    '',
    '2',
    `00:00:00,000 --> ${end}`,
    `{${slash}an7${slash}pos(${Math.round(width * 0.06)},${Math.round(height * 0.20)})${slash}fs38}${escapeSubtitleText(input.prompt || 'Local scene preview')}`,
    '',
    '3',
    `00:00:00,000 --> ${end}`,
    `{${slash}an7${slash}pos(${Math.round(width * 0.06)},${Math.round(height * 0.78)})${slash}fs20}${escapeSubtitleText(`${input.camera || 'camera'} • ${input.tone || 'cinematic'}`)}`,
    '',
    '4',
    `00:00:00,000 --> ${end}`,
    `{${slash}an1${slash}pos(${Math.round(width * 0.06)},${Math.round(height * 0.90)})${slash}fs18}LOCAL FALLBACK - NO AI QUOTA USED`,
    '',
  ];
  return lines.join(String.fromCharCode(10));
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

  const dims = input.aspectRatio === '9:16'
    ? input.resolution === '4K' ? '2160x3840' : input.resolution === '1080p' ? '1080x1920' : '540x960'
    : input.resolution === '4K' ? '3840x2160' : input.resolution === '1080p' ? '1920x1080' : '1280x720';

  const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'kreasiai-local-video-'));
  const output = path.join(tmpDir, `local-${crypto.randomUUID()}.mp4`);
  const srtFile = path.join(tmpDir, 'local.srt');
  await fs.writeFile(srtFile, buildLocalSrt(input, input.durationSeconds, Number(dims.split('x')[0]), Number(dims.split('x')[1])), 'utf8');
  const filter = `subtitles=filename='${escapeFilterFilename(srtFile)}':force_style='FontName=Arial,PrimaryColour=&H00FFFFFF,OutlineColour=&HAA000000,BackColour=&H99000000,BorderStyle=3,Outline=18,Shadow=2'`;

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
