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

export type RenderScene = {
  scene: number;
  role?: string;
  duration_seconds?: number;
  narration?: string;
  visual_prompt?: string;
  camera?: string;
  transition?: string;
  voice_asset_id?: string | null;
  voice_url?: string | null;
  video_asset_id?: string | null;
  video_url?: string | null;
  video_duration_seconds?: number | null;
  trim_start_seconds?: number;
  trim_end_seconds?: number;
};

export type EditorRenderSettings = {
  subtitle?: { size?: 'small' | 'medium' | 'large'; position?: 'bottom' | 'center' | 'top'; background?: 'box' | 'shadow' | 'none' };
  watermark?: { enabled?: boolean; text?: string; opacity?: number; position?: 'top-left' | 'top-right' | 'bottom-left' | 'bottom-right' };
  masterVolume?: number;
  music?: { assetId?: string | null; volume?: number };
  transitions?: Record<string, { type?: string; duration?: number }>;
};

export type ProductionRenderOptions = {
  resolution: '720p' | '1080p' | '4K';
  fps: 24 | 30 | 60;
  aspectRatio: '16:9' | '9:16';
  includeVoice: boolean;
  burnSubtitles: boolean;
  useSceneVideos: boolean;
  useSceneAudio: boolean;
  editor?: EditorRenderSettings;
};

export type RenderResult = {
  outputPath: string;
  subtitlePath: string;
  durationSeconds: number;
  sceneCount: number;
};

function dimensions(resolution: ProductionRenderOptions['resolution'], aspectRatio: ProductionRenderOptions['aspectRatio']) {
  if (aspectRatio === '9:16') {
    if (resolution === '4K') return { width: 2160, height: 3840 };
    if (resolution === '1080p') return { width: 1080, height: 1920 };
    return { width: 540, height: 960 };
  }
  if (resolution === '4K') return { width: 3840, height: 2160 };
  if (resolution === '1080p') return { width: 1920, height: 1080 };
  return { width: 1280, height: 720 };
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

function secondsToSrt(seconds: number) {
  const ms = Math.max(0, Math.round(seconds * 1000));
  const h = Math.floor(ms / 3_600_000);
  const m = Math.floor((ms % 3_600_000) / 60_000);
  const s = Math.floor((ms % 60_000) / 1000);
  const milli = ms % 1000;
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')},${String(milli).padStart(3, '0')}`;
}

function getFfmpegStaticPath() {
  try {
    const mod: any = runtimeRequire('ffmpeg-static');
    const value = typeof mod === 'string' ? mod : (typeof mod?.default === 'string' ? mod.default : '');
    return value ? path.resolve(value) : '';
  } catch {
    const mod: any = ffmpegStatic as any;
    const value = typeof mod === 'string' ? mod : (typeof mod?.default === 'string' ? mod.default : '');
    return value ? path.resolve(value) : '';
  }
}

async function resolveFfmpeg() {
  const configured = process.env.FFMPEG_PATH?.trim();
  const staticCandidate = getFfmpegStaticPath();
  const cwdCandidate = process.platform === 'win32'
    ? path.join(process.cwd(), 'node_modules', 'ffmpeg-static', 'ffmpeg.exe')
    : path.join(process.cwd(), 'node_modules', 'ffmpeg-static', 'ffmpeg');
  const candidates = (process.env.VERCEL
    ? [staticCandidate, cwdCandidate, configured, 'ffmpeg']
    : [configured, staticCandidate, cwdCandidate, 'ffmpeg']).filter(Boolean) as string[];
  let lastError: unknown = null;
  for (const candidate of [...new Set(candidates)]) {
    try {
      await execFileAsync(candidate, ['-version'], { timeout: 10_000, windowsHide: true });
      if (process.platform !== 'win32') {
        await fs.chmod(candidate, 0o755).catch(() => undefined);
      }
      return candidate;
    } catch (error) {
      lastError = error;
    }
  }
  const detail = lastError instanceof Error ? ` ${lastError.message}` : '';
  throw new Error(`FFmpeg tidak ditemukan di runtime. Pastikan dependency ffmpeg-static terpasang dan tersedia pada deployment, atau set FFMPEG_PATH. ${detail}`);
}

async function runFfmpeg(ffmpeg: string, args: string[]) {
  try {
    await execFileAsync(ffmpeg, args, { timeout: 5 * 60_000, windowsHide: true, maxBuffer: 20 * 1024 * 1024 });
  } catch (error: any) {
    const stderr = String(error?.stderr || error?.message || 'FFmpeg gagal').trim();
    throw new Error(`FFmpeg: ${stderr.slice(-5000)}`);
  }
}


function wrapTextFile(text: string, maxChars: number) {
  const words = String(text || '').trim().split(/\s+/).filter(Boolean);
  const lines: string[] = [];
  let line = '';
  for (const word of words) {
    const next = line ? `${line} ${word}` : word;
    if (next.length > maxChars && line) { lines.push(line); line = word; }
    else line = next;
  }
  if (line) lines.push(line);
  return lines.join('\n');
}

function sceneColor(index: number) {
  const palette = ['0x0c1c2a', '0x17251c', '0x2a1d13', '0x1a1830', '0x1e2819', '0x23191d', '0x10262a', '0x2a2112'];
  return palette[index % palette.length];
}

function buildSceneSrt(
  scene: RenderScene,
  duration: number,
  width: number,
  height: number,
  editor: EditorRenderSettings = {},
  burnSubtitles: boolean,
) {
  const slash = String.fromCharCode(92);
  const end = subtitleTime(duration);
  const x = Math.round(width * 0.07);
  const yTitle = Math.round(height * 0.06);
  const yVisual = Math.round(height * 0.15);
  const yMeta = Math.round(height * 0.59);
  const position = editor.subtitle?.position || 'bottom';
  const ySubtitle = position === 'top' ? Math.round(height * 0.14) : position === 'center' ? Math.round(height * 0.50) : Math.round(height * 0.82);
  const align = position === 'top' ? 8 : position === 'center' ? 5 : 2;
  const size = editor.subtitle?.size === 'small' ? 26 : editor.subtitle?.size === 'large' ? 42 : 32;
  const lines = [
    '1',
    `00:00:00,000 --> ${end}`,
    `{${slash}an7${slash}pos(${x},${yTitle})${slash}fs28${slash}b1}SCENE ${scene.scene} • ${(scene.role || 'SCENE').toUpperCase()}`,
    '',
    '2',
    `00:00:00,000 --> ${end}`,
    `{${slash}an7${slash}pos(${x},${yVisual})${slash}fs34}${escapeSubtitleText(scene.visual_prompt || 'Local scene preview')}`,
    '',
    '3',
    `00:00:00,000 --> ${end}`,
    `{${slash}an7${slash}pos(${x},${yMeta})${slash}fs20${slash}alpha&H33&}${escapeSubtitleText(`${scene.camera || 'camera'} • ${scene.transition || 'cut'}`)}`,
    '',
  ];
  let nextId = 4;
  if (burnSubtitles && String(scene.narration || '').trim()) {
    lines.push(String(nextId++), `00:00:00,000 --> ${end}`, `{${slash}an${align}${slash}pos(${Math.round(width / 2)},${ySubtitle})${slash}fs${size}}${escapeSubtitleText(scene.narration || '')}`, '');
  }
  const wm = editor.watermark || {};
  if (wm.enabled && String(wm.text || '').trim()) {
    const alignWm = wm.position === 'top-left' ? 7 : wm.position === 'top-right' ? 9 : wm.position === 'bottom-left' ? 1 : 3;
    const xWm = wm.position?.includes('right') ? Math.round(width * 0.93) : Math.round(width * 0.07);
    const yWm = wm.position?.includes('top') ? Math.round(height * 0.07) : Math.round(height * 0.92);
    const opacity = Math.max(0.05, Math.min(1, Number(wm.opacity ?? 0.72)));
    const alpha = Math.round((1 - opacity) * 255).toString(16).padStart(2, '0').toUpperCase();
    lines.push(String(nextId++), `00:00:00,000 --> ${end}`, `{${slash}an${alignWm}${slash}pos(${xWm},${yWm})${slash}fs22${slash}alpha&H${alpha}&}${escapeSubtitleText(String(wm.text))}`, '');
  }
  return lines.join(String.fromCharCode(10));
}

function buildSceneFilter(srtFile: string, editor: EditorRenderSettings = {}) {
  const background = editor.subtitle?.background === 'box';
  const borderStyle = background ? 3 : 1;
  const outline = background ? 18 : 2;
  const shadow = editor.subtitle?.background === 'shadow' ? 4 : 2;
  const backColour = background ? '&H99000000' : '&H00000000';
  const style = `FontName=Arial,PrimaryColour=&H00FFFFFF,OutlineColour=&HAA000000,BackColour=${backColour},BorderStyle=${borderStyle},Outline=${outline},Shadow=${shadow}`;
  return `subtitles=filename='${escapeFilterFilename(srtFile)}':force_style='${style}'`;
}

function concatFileLine(filePath: string) {
  return `file '${filePath.replace(/'/g, "'\\''")}'`;
}

export async function renderProductionVideo(
  scenes: RenderScene[],
  options: ProductionRenderOptions,
  voiceFiles: Map<number, string>,
  videoFiles: Map<number, string>,
  musicFile?: string,
): Promise<RenderResult> {
  if (!scenes.length) throw new Error('Tidak ada scene untuk dirender.');
  const ffmpeg = await resolveFfmpeg();
  const dims = dimensions(options.resolution, options.aspectRatio);
  const workdir = await fs.mkdtemp(path.join(os.tmpdir(), 'kreasiai-phase8-'));
  const sceneDir = path.join(workdir, 'scenes');
  await fs.mkdir(sceneDir, { recursive: true });
  const sceneFiles: string[] = [];
  const srtLines: string[] = [];
  let cursor = 0;

  try {
    for (let i = 0; i < scenes.length; i += 1) {
      const scene = scenes[i];
      const baseDuration = Math.max(1, Number(scene.duration_seconds || 1));
      const sourceDuration = Math.max(baseDuration, Number(scene.video_duration_seconds || baseDuration));
      const hasExplicitTrim = scene.trim_start_seconds !== undefined || scene.trim_end_seconds !== undefined;
      const trimStart = hasExplicitTrim ? Math.max(0, Math.min(sourceDuration - 0.25, Number(scene.trim_start_seconds || 0))) : 0;
      const defaultTrimEnd = Math.min(sourceDuration, trimStart + baseDuration);
      const trimEnd = hasExplicitTrim ? Math.max(trimStart + 0.25, Math.min(sourceDuration, Number(scene.trim_end_seconds ?? defaultTrimEnd))) : defaultTrimEnd;
      const duration = Math.max(1, Number((trimEnd - trimStart).toFixed(3)));
      const transition = options.editor?.transitions?.[String(scene.scene)] || { type: 'cut', duration: 0 };
      const sceneBase = String(i + 1).padStart(3, '0');
      const sceneSrt = path.join(sceneDir, `${sceneBase}.srt`);
      await fs.writeFile(sceneSrt, buildSceneSrt(scene, duration, dims.width, dims.height, options.editor, options.burnSubtitles), 'utf8');

      if (options.burnSubtitles && String(scene.narration || '').trim()) {
        srtLines.push(String(i + 1));
        srtLines.push(`${secondsToSrt(cursor)} --> ${secondsToSrt(cursor + duration)}`);
        srtLines.push(String(scene.narration || '').trim());
        srtLines.push('');
      }

      const output = path.join(sceneDir, `${sceneBase}.mp4`);
      const sourceVideoPath = options.useSceneVideos ? videoFiles.get(Number(scene.scene)) : undefined;
      const inputArgs = ['-y'];
      if (sourceVideoPath) {
        inputArgs.push('-stream_loop', '-1');
        if (trimStart > 0) inputArgs.push('-ss', trimStart.toFixed(3));
        inputArgs.push('-i', sourceVideoPath);
      } else {
        inputArgs.push('-f', 'lavfi', '-i', `color=c=${sceneColor(i)}:s=${dims.width}x${dims.height}:r=${options.fps}:d=${duration}`);
      }
      const voicePath = options.includeVoice ? voiceFiles.get(Number(scene.scene)) : undefined;
      const sceneAudioAvailable = Boolean(sourceVideoPath && options.useSceneAudio);
      let baseAudioIndex: number;
      if (voicePath) {
        inputArgs.push('-i', voicePath);
        baseAudioIndex = 1;
      } else if (sceneAudioAvailable) {
        baseAudioIndex = 0;
      } else {
        inputArgs.push('-f', 'lavfi', '-i', 'anullsrc=r=48000:cl=stereo');
        baseAudioIndex = 1;
      }
      let musicIndex: number | null = null;
      if (musicFile) {
        musicIndex = baseAudioIndex + 1;
        inputArgs.push('-stream_loop', '-1', '-i', musicFile);
      }
      const baseVideoFilter = sourceVideoPath ? `scale=${dims.width}:${dims.height}:force_original_aspect_ratio=increase,crop=${dims.width}:${dims.height},setsar=1` : '';
      const subtitleFilter = buildSceneFilter(sceneSrt, options.editor);
      const transitionType = String(transition.type || 'cut');
      const transitionDuration = Math.max(0, Math.min(duration / 2, Number(transition.duration || 0)));
      const transitionFilter = (transitionType === 'fade' || transitionType === 'dissolve') && transitionDuration > 0
        ? `fade=t=in:st=0:d=${transitionDuration.toFixed(3)},fade=t=out:st=${Math.max(0, duration - transitionDuration).toFixed(3)}:d=${transitionDuration.toFixed(3)}`
        : '';
      const filter = [baseVideoFilter, subtitleFilter, transitionFilter].filter(Boolean).join(',');
      const masterVolume = Math.max(0, Math.min(1.5, Number(options.editor?.masterVolume ?? 1)));
      const musicVolume = Math.max(0, Math.min(0.5, Number(options.editor?.music?.volume ?? 0.14)));
      const audioFilter = musicIndex !== null
        ? `[${baseAudioIndex}:a]volume=${masterVolume.toFixed(3)},aresample=48000[basea];[${musicIndex}:a]volume=${musicVolume.toFixed(3)},aresample=48000[musica];[basea][musica]amix=inputs=2:duration=first:dropout_transition=2,apad,atrim=duration=${duration.toFixed(3)}[a]`
        : `[${baseAudioIndex}:a]volume=${masterVolume.toFixed(3)},apad,atrim=duration=${duration.toFixed(3)}[a]`;
      inputArgs.push(
        '-filter_complex', `[0:v]${filter},format=yuv420p[v];${audioFilter}`,
        '-map', '[v]',
        '-map', '[a]',
        '-t', duration.toFixed(3),
        '-r', String(options.fps),
        '-c:v', 'libx264',
        '-preset', options.resolution === '4K' ? 'medium' : 'veryfast',
        '-crf', options.resolution === '4K' ? '18' : options.resolution === '1080p' ? '20' : '22',
        '-c:a', 'aac',
        '-b:a', '192k',
        '-movflags', '+faststart',
        output,
      );
      await runFfmpeg(ffmpeg, inputArgs);
      sceneFiles.push(output);
      cursor += duration;
    }

    const concatPath = path.join(sceneDir, 'concat.txt');
    await fs.writeFile(concatPath, sceneFiles.map(concatFileLine).join('\n'), 'utf8');
    const outputPath = path.join(workdir, `kreasiai-final-${crypto.randomUUID()}.mp4`);
    await runFfmpeg(ffmpeg, [
      '-y', '-f', 'concat', '-safe', '0', '-i', concatPath,
      '-c', 'copy',
      '-movflags', '+faststart',
      outputPath,
    ]);

    const subtitlePath = path.join(workdir, 'kreasiai-subtitles.srt');
    await fs.writeFile(subtitlePath, srtLines.join('\n'), 'utf8');
    const durationSeconds = scenes.reduce((sum, scene) => sum + Math.max(1, Number(scene.duration_seconds || 1)), 0);
    return { outputPath, subtitlePath, durationSeconds, sceneCount: scenes.length };
  } catch (error) {
    throw error;
  } finally {
    // Output files are consumed by the caller before cleanup; leave cleanup to route.
  }
}

export async function cleanupProductionRender(outputPath: string) {
  const root = path.dirname(outputPath);
  if (!path.basename(root).startsWith('kreasiai-phase8-') && !path.basename(root).startsWith('kreasiai-phase6-')) return;
  await fs.rm(root, { recursive: true, force: true }).catch(() => undefined);
}
