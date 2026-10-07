import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import crypto from 'node:crypto';
import ffmpegStatic from 'ffmpeg-static';

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

function escapeFilterText(text: string) {
  return text.replace(/\\/g, '\\\\').replace(/'/g, "\\'").replace(/:/g, '\\:').replace(/,/g, '\\,').replace(/\[/g, '\\[').replace(/\]/g, '\\]');
}

function secondsToSrt(seconds: number) {
  const ms = Math.max(0, Math.round(seconds * 1000));
  const h = Math.floor(ms / 3_600_000);
  const m = Math.floor((ms % 3_600_000) / 60_000);
  const s = Math.floor((ms % 60_000) / 1000);
  const milli = ms % 1000;
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')},${String(milli).padStart(3, '0')}`;
}

async function findFont() {
  const candidates = [
    process.env.KAI_FONT_FILE,
    process.platform === 'win32' ? 'C:\\Windows\\Fonts\\arial.ttf' : undefined,
    process.platform === 'win32' ? 'C:\\Windows\\Fonts\\segoeui.ttf' : undefined,
    '/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf',
    '/usr/share/fonts/truetype/liberation2/LiberationSans-Regular.ttf',
  ].filter(Boolean) as string[];
  for (const candidate of candidates) {
    try { await fs.access(candidate); return candidate; } catch {}
  }
  return '';
}

async function resolveFfmpeg() {
  const configured = process.env.FFMPEG_PATH?.trim();
  const staticCandidate = typeof ffmpegStatic === 'string' ? ffmpegStatic : '';
  const candidates = (process.env.VERCEL
    ? [staticCandidate, configured, 'ffmpeg']
    : [configured, staticCandidate, 'ffmpeg']).filter(Boolean) as string[];
  let lastError: unknown = null;
  for (const candidate of candidates) {
    try {
      await execFileAsync(candidate, ['-version'], { timeout: 10_000, windowsHide: true });
      return candidate;
    } catch (error) {
      lastError = error;
    }
  }
  const detail = lastError instanceof Error ? ` ${lastError.message}` : '';
  throw new Error(`FFmpeg tidak ditemukan. Install FFmpeg lalu pastikan perintah "ffmpeg" tersedia di PATH, atau set FFMPEG_PATH di .env.local.${detail}`);
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

function buildSceneFilter(
  scene: RenderScene,
  duration: number,
  fontFile: string,
  textFiles: { visual: string; narration: string; meta: string },
  burnSubtitles: boolean,
  sourceVideo: boolean,
  width: number,
  height: number,
  editor: EditorRenderSettings = {},
  transition: { type?: string; duration?: number } = {},
) {
  const safeFont = escapeFilterText(fontFile.replace(/\\/g, '/'));
  const subtitle = editor.subtitle || {};
  const subtitleSize = subtitle.size === 'small' ? 0.017 : subtitle.size === 'large' ? 0.029 : 0.022;
  const subtitleY = subtitle.position === 'top' ? 'h*0.14' : subtitle.position === 'center' ? 'h*0.46' : 'h*0.72';
  const subtitleParts = subtitle.background === 'none'
    ? `shadowcolor=black@0.8:shadowx=2:shadowy=2`
    : subtitle.background === 'shadow'
      ? `shadowcolor=black@0.85:shadowx=3:shadowy=3`
      : `box=1:boxcolor=black@0.68:boxborderw=28`;
  const title = `SCENE ${scene.scene}  •  ${(scene.role || 'SCENE').toUpperCase()}`;
  const meta = `${scene.camera || 'camera'}  •  ${scene.transition || 'cut'}`;
  const filters = [
    sourceVideo ? `scale=${width}:${height}:force_original_aspect_ratio=increase,crop=${width}:${height},setsar=1` : '',
    `drawtext=fontfile='${safeFont}':text='${escapeFilterText(title)}':x=w*0.07:y=h*0.06:fontsize=w*0.018:fontcolor=0x9ee6b9`,
    `drawtext=fontfile='${safeFont}':textfile='${escapeFilterText(textFiles.visual.replace(/\\/g, '/'))}':reload=0:x=w*0.07:y=h*0.15:fontsize=w*0.028:fontcolor=white:line_spacing=12:box=1:boxcolor=black@0.24:boxborderw=18`,
    `drawtext=fontfile='${safeFont}':textfile='${escapeFilterText(textFiles.meta.replace(/\\/g, '/'))}':reload=0:x=w*0.07:y=h*0.59:fontsize=w*0.014:fontcolor=white@0.72`,
    burnSubtitles ? `drawtext=fontfile='${safeFont}':textfile='${escapeFilterText(textFiles.narration.replace(/\\/g, '/'))}':reload=0:x=w*0.06:y=${subtitleY}:fontsize=w*${subtitleSize}:fontcolor=white:line_spacing=10:${subtitleParts}` : '',
  ];
  const wm = editor.watermark || {};
  if (wm.enabled && String(wm.text || '').trim()) {
    const opacity = Math.max(0.05, Math.min(1, Number(wm.opacity ?? 0.72)));
    const pos = wm.position || 'bottom-right';
    const x = pos.endsWith('right') ? 'w-tw-w*0.07' : 'w*0.07';
    const y = pos.startsWith('top') ? 'h*0.06' : 'h*0.92';
    filters.push(`drawtext=fontfile='${safeFont}':text='${escapeFilterText(String(wm.text))}':x=${x}:y=${y}:fontsize=w*0.018:fontcolor=white@${opacity}:shadowcolor=black@0.75:shadowx=2:shadowy=2`);
  }
  const transitionType = String(transition.type || 'cut');
  const transitionDuration = Math.max(0, Math.min(duration / 2, Number(transition.duration || 0)));
  if ((transitionType === 'fade' || transitionType === 'dissolve') && transitionDuration > 0) {
    filters.push(`fade=t=in:st=0:d=${transitionDuration.toFixed(3)},fade=t=out:st=${Math.max(0, duration - transitionDuration).toFixed(3)}:d=${transitionDuration.toFixed(3)}`);
  }
  return filters.filter(Boolean).join(',');
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
  const fontFile = await findFont();
  if (!fontFile) throw new Error('File font tidak ditemukan. Set KAI_FONT_FILE di .env.local ke file .ttf yang tersedia.');

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
      const visualText = path.join(sceneDir, `${sceneBase}-visual.txt`);
      const narrationText = path.join(sceneDir, `${sceneBase}-narration.txt`);
      const metaText = path.join(sceneDir, `${sceneBase}-meta.txt`);
      await fs.writeFile(visualText, wrapTextFile(String(scene.visual_prompt || `Scene ${scene.scene}`), options.aspectRatio === '9:16' ? 30 : 58), 'utf8');
      await fs.writeFile(narrationText, wrapTextFile(String(scene.narration || ''), options.aspectRatio === '9:16' ? 23 : 54), 'utf8');
      await fs.writeFile(metaText, `${scene.camera || 'camera'}  •  ${scene.transition || 'cut'}`, 'utf8');

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
      const filter = buildSceneFilter(scene, duration, fontFile, { visual: visualText, narration: narrationText, meta: metaText }, options.burnSubtitles, Boolean(sourceVideoPath), dims.width, dims.height, options.editor, transition);
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
