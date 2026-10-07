'use client';

import { useMemo, useRef, useState } from 'react';

type Scene = {
  scene: number;
  role: string;
  duration_seconds: number;
  narration: string;
  visual_prompt: string;
  camera: string;
  transition: string;
  voice_url?: string | null;
  start_seconds?: number;
  end_seconds?: number;
};

type Plan = {
  title: string;
  platform: string;
  tone: string;
  duration_seconds: number;
  scenes: Scene[];
  [key: string]: unknown;
};

type Project = { id: string };

type Props = {
  project: Project | null;
  plan: Plan;
  onSaved?: (url: string) => void;
};

function wrapText(ctx: CanvasRenderingContext2D, text: string, maxWidth: number) {
  const words = text.trim().split(/\s+/);
  const lines: string[] = [];
  let line = '';
  for (const word of words) {
    const test = line ? `${line} ${word}` : word;
    if (ctx.measureText(test).width > maxWidth && line) {
      lines.push(line);
      line = word;
    } else {
      line = test;
    }
  }
  if (line) lines.push(line);
  return lines;
}

function formatTime(seconds: number) {
  const s = Math.max(0, Math.floor(seconds));
  return `${String(Math.floor(s / 60)).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}`;
}

export default function RenderStudio({ project, plan, onSaved }: Props) {
  const [resolution, setResolution] = useState<'720p' | '1080p' | '4K'>('1080p');
  const [fps, setFps] = useState('30');
  const [includeVoice, setIncludeVoice] = useState(true);
  const [rendering, setRendering] = useState(false);
  const [progress, setProgress] = useState(0);
  const [message, setMessage] = useState('');
  const [renderUrl, setRenderUrl] = useState('');
  const canvasRef = useRef<HTMLCanvasElement | null>(null);

  const aspectRatio = useMemo(() => {
    return ['YouTube Shorts', 'TikTok', 'Instagram Reels'].includes(plan.platform) ? '9:16' : '16:9';
  }, [plan.platform]);

  const dimensions = useMemo(() => {
    if (aspectRatio === '9:16') {
      if (resolution === '4K') return { width: 2160, height: 3840 };
      if (resolution === '1080p') return { width: 1080, height: 1920 };
      return { width: 540, height: 960 };
    }
    if (resolution === '4K') return { width: 3840, height: 2160 };
    if (resolution === '1080p') return { width: 1920, height: 1080 };
    return { width: 1280, height: 720 };
  }, [aspectRatio, resolution]);

  async function uploadRender(blob: Blob, mimeType: string, durationSeconds: number) {
    if (!project) throw new Error('Project belum tersedia. Buat Content Plan terlebih dahulu.');
    const ext = mimeType.includes('mp4') ? 'mp4' : 'webm';
    const form = new FormData();
    form.append('projectId', project.id);
    form.append('resolution', resolution);
    form.append('format', ext);
    form.append('durationSeconds', String(durationSeconds));
    form.append('render', new File([blob], `kreasiai-render.${ext}`, { type: mimeType }));

    const res = await fetch('/api/content/render/upload', { method: 'POST', body: form });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.error || 'Gagal menyimpan hasil render.');
    setRenderUrl(data.url || '');
    onSaved?.(data.url || '');
    return data;
  }

  async function renderVideo() {
    if (rendering) return;
    if (!project) {
      setMessage('Project belum tersedia.');
      return;
    }

    const canvas = canvasRef.current;
    if (!canvas) {
      setMessage('Canvas render belum siap.');
      return;
    }

    const ctx = canvas.getContext('2d');
    if (!ctx || !canvas.captureStream || typeof MediaRecorder === 'undefined') {
      setMessage('Browser ini tidak mendukung browser video render. Gunakan Microsoft Edge atau Google Chrome terbaru.');
      return;
    }

    setRendering(true);
    setProgress(0);
    setRenderUrl('');
    setMessage(`Menyiapkan render ${resolution} ${aspectRatio}...`);

    const originalWidth = canvas.width;
    const originalHeight = canvas.height;
    canvas.width = dimensions.width;
    canvas.height = dimensions.height;

    const fpsNumber = Number(fps) || 30;
    const stream = canvas.captureStream(fpsNumber);
    let audioContext: AudioContext | null = null;
    let audioDestination: MediaStreamAudioDestinationNode | null = null;
    const audioElements: HTMLAudioElement[] = [];
    const audioSources: MediaElementAudioSourceNode[] = [];
    let audioEnabled = false;

    if (includeVoice && plan.scenes.some(s => !!s.voice_url)) {
      try {
        audioContext = new AudioContext();
        audioDestination = audioContext.createMediaStreamDestination();
        stream.addTrack(audioDestination.stream.getAudioTracks()[0]);
        audioEnabled = true;
      } catch {
        audioEnabled = false;
      }
    }

    const mimeCandidates = [
      'video/mp4;codecs=h264,aac',
      'video/webm;codecs=vp9,opus',
      'video/webm;codecs=vp8,opus',
      'video/webm',
    ];
    const mimeType = mimeCandidates.find(type => MediaRecorder.isTypeSupported(type));
    if (!mimeType) {
      setRendering(false);
      setMessage('Browser tidak menyediakan format video yang didukung.');
      canvas.width = originalWidth;
      canvas.height = originalHeight;
      return;
    }

    const recorder = new MediaRecorder(stream, { mimeType, videoBitsPerSecond: resolution === '4K' ? 18_000_000 : resolution === '1080p' ? 8_000_000 : 4_000_000 });
    const chunks: BlobPart[] = [];
    recorder.ondataavailable = (e) => { if (e.data.size) chunks.push(e.data); };

    const totalDuration = Math.max(1, plan.scenes.reduce((sum, scene) => sum + Number(scene.duration_seconds || 1), 0));

    const drawBackground = (sceneIndex: number, elapsed: number) => {
      const w = canvas.width;
      const h = canvas.height;
      const scene = plan.scenes[sceneIndex];
      const t = Math.max(0, Math.min(1, elapsed / Math.max(1, Number(scene.duration_seconds || 1))));
      const hueShift = (sceneIndex * 28 + t * 35) % 360;
      const grad = ctx.createLinearGradient(0, 0, w, h);
      grad.addColorStop(0, `hsl(${hueShift}, 32%, 12%)`);
      grad.addColorStop(0.55, `hsl(${(hueShift + 42) % 360}, 28%, 8%)`);
      grad.addColorStop(1, `hsl(${(hueShift + 80) % 360}, 26%, 5%)`);
      ctx.fillStyle = grad;
      ctx.fillRect(0, 0, w, h);

      const glow = ctx.createRadialGradient(w * 0.78, h * 0.18, 0, w * 0.78, h * 0.18, Math.max(w, h) * 0.6);
      glow.addColorStop(0, 'rgba(95, 220, 145, 0.18)');
      glow.addColorStop(1, 'rgba(95, 220, 145, 0)');
      ctx.fillStyle = glow;
      ctx.fillRect(0, 0, w, h);

      const pad = Math.round(w * 0.07);
      ctx.fillStyle = 'rgba(5, 10, 7, 0.36)';
      ctx.fillRect(0, h * 0.66, w, h * 0.34);

      ctx.fillStyle = '#9ee6b9';
      ctx.font = `700 ${Math.max(18, Math.round(w * 0.018))}px system-ui, sans-serif`;
      ctx.fillText(`SCENE ${scene.scene}  •  ${scene.role.toUpperCase()}`, pad, pad);

      ctx.fillStyle = '#ffffff';
      ctx.font = `700 ${Math.max(30, Math.round(w * 0.032))}px system-ui, sans-serif`;
      const visualLines = wrapText(ctx, scene.visual_prompt, w - pad * 2);
      const visualTop = h * 0.13;
      visualLines.slice(0, 4).forEach((line, idx) => ctx.fillText(line, pad, visualTop + idx * Math.round(w * 0.04)));

      ctx.fillStyle = 'rgba(255,255,255,0.65)';
      ctx.font = `500 ${Math.max(16, Math.round(w * 0.014))}px system-ui, sans-serif`;
      ctx.fillText(`${scene.camera}  •  ${scene.transition}`, pad, h * 0.58);

      const sub = scene.narration || '';
      const subPad = Math.round(w * 0.06);
      const subWidth = w - subPad * 2;
      ctx.fillStyle = 'rgba(0,0,0,0.64)';
      ctx.fillRect(subPad, h * 0.72, subWidth, h * 0.18);

      ctx.fillStyle = '#ffffff';
      ctx.font = `700 ${Math.max(24, Math.round(w * 0.024))}px system-ui, sans-serif`;
      const subLines = wrapText(ctx, sub, subWidth - 44);
      subLines.slice(0, 3).forEach((line, idx) => {
        ctx.fillText(line, subPad + 22, h * 0.77 + idx * Math.round(w * 0.032));
      });

      ctx.fillStyle = 'rgba(255,255,255,0.55)';
      ctx.font = `600 ${Math.max(14, Math.round(w * 0.012))}px system-ui, sans-serif`;
      const now = Number(scene.start_seconds || 0) + elapsed;
      ctx.fillText(`${formatTime(now)} / ${formatTime(totalDuration)}`, pad, h - pad * 0.6);

      ctx.fillStyle = 'rgba(255,255,255,0.18)';
      ctx.fillRect(pad, h - pad * 0.38, w - pad * 2, Math.max(4, Math.round(h * 0.004)));
      ctx.fillStyle = '#58d68d';
      ctx.fillRect(pad, h - pad * 0.38, (w - pad * 2) * ((sceneIndex + t) / plan.scenes.length), Math.max(4, Math.round(h * 0.004)));
    };

    const startAudioForScene = async (scene: Scene) => {
      if (!audioEnabled || !audioContext || !audioDestination || !scene.voice_url) return null;
      try {
        const el = new Audio();
        el.crossOrigin = 'anonymous';
        el.src = scene.voice_url;
        el.preload = 'auto';
        const source = audioContext.createMediaElementSource(el);
        source.connect(audioDestination);
        source.connect(audioContext.destination);
        if (audioContext.state === 'suspended') await audioContext.resume().catch(() => undefined);
        await el.play().catch(() => undefined);
        audioElements.push(el);
        audioSources.push(source);
        return el;
      } catch {
        return null;
      }
    };

    const stopAudio = (el: HTMLAudioElement | null) => {
      if (!el) return;
      try { el.pause(); el.currentTime = 0; } catch {}
    };

    recorder.start(250);

    try {
      let elapsedTotal = 0;
      for (let i = 0; i < plan.scenes.length; i += 1) {
        const scene = plan.scenes[i];
        const sceneDuration = Math.max(1, Number(scene.duration_seconds || 1));
        const sceneStart = performance.now();
        const audioEl = await startAudioForScene(scene);

        await new Promise<void>((resolve) => {
          const tick = () => {
            const elapsed = Math.min(sceneDuration, (performance.now() - sceneStart) / 1000);
            drawBackground(i, elapsed);
            setProgress(Math.min(99, ((elapsedTotal + elapsed) / totalDuration) * 100));
            if (elapsed >= sceneDuration) resolve();
            else requestAnimationFrame(tick);
          };
          tick();
        });

        stopAudio(audioEl);
        elapsedTotal += sceneDuration;
      }

      drawBackground(plan.scenes.length - 1, Number(plan.scenes.at(-1)?.duration_seconds || 1));
      await new Promise(resolve => setTimeout(resolve, 180));

      const finalBlob: Blob = await new Promise((resolve, reject) => {
        const timeout = window.setTimeout(() => reject(new Error('Render timeout.')), 30000);
        recorder.addEventListener('stop', () => {
          window.clearTimeout(timeout);
          try { resolve(new Blob(chunks, { type: mimeType })); } catch (e) { reject(e); }
        }, { once: true });
        recorder.stop();
      });

      setProgress(100);
      setMessage(`✓ Render selesai (${(finalBlob.size / 1024 / 1024).toFixed(1)} MB). Menyimpan hasil...`);
      const saved = await uploadRender(finalBlob, mimeType, totalDuration);
      const format = mimeType.includes('mp4') ? 'MP4' : 'WebM';
      setMessage(`✓ Video final tersimpan • ${format} • ${resolution} • ${formatTime(totalDuration)}`);
      void saved;
    } catch (e) {
      try { if (recorder.state !== 'inactive') recorder.stop(); } catch {}
      setMessage(e instanceof Error ? e.message : 'Render gagal.');
      setProgress(0);
    } finally {
      audioElements.forEach(stopAudio);
      audioSources.forEach(source => { try { source.disconnect(); } catch {} });
      try { await audioContext?.close(); } catch {}
      stream.getTracks().forEach(track => track.stop());
      canvas.width = originalWidth;
      canvas.height = originalHeight;
      setRendering(false);
    }
  }

  return (
    <div className="renderStudio">
      <div className="renderHead">
        <div>
          <h3>🎞️ Final Render Studio</h3>
          <p className="muted">Gabungkan scene, subtitle, dan voice menjadi satu video melalui browser. Tidak membutuhkan Veo.</p>
        </div>
        <span className="badge">Phase 5</span>
      </div>

      <canvas ref={canvasRef} className="renderCanvas" aria-hidden="true" />

      <div className="renderSettings">
        <label>Resolusi<select value={resolution} onChange={e => setResolution(e.target.value as '720p' | '1080p' | '4K')} disabled={rendering}><option value="720p">720p</option><option value="1080p">1080p</option><option value="4K">4K (Experimental)</option></select></label>
        <label>FPS<select value={fps} onChange={e => setFps(e.target.value)} disabled={rendering}><option value="24">24 fps</option><option value="30">30 fps</option><option value="60">60 fps</option></select></label>
        <label className="checkField"><input type="checkbox" checked={includeVoice} onChange={e => setIncludeVoice(e.target.checked)} disabled={rendering} /> Sertakan voice yang sudah tersedia</label>
      </div>

      <div className="renderInfo">
        <span>{aspectRatio}</span>
        <span>{plan.scenes.length} scene</span>
        <span>{formatTime(plan.scenes.reduce((sum, s) => sum + Number(s.duration_seconds || 1), 0))}</span>
        <span>{includeVoice && plan.scenes.some(s => !!s.voice_url) ? 'Voice: aktif' : 'Voice: tidak tersedia / nonaktif'}</span>
      </div>

      <button className="primary" disabled={rendering || !project || !plan.scenes.length} onClick={renderVideo}>{rendering ? `Rendering... ${Math.round(progress)}%` : '🎬 Render Video Final'}</button>
      {rendering && <div className="renderProgress"><div style={{ width: `${progress}%` }} /></div>}
      {message && <div className={message.includes('✓') ? 'ok' : 'error'}>{message}</div>}

      {renderUrl && (
        <div className="renderResult">
          <strong>Video final</strong>
          <video controls src={renderUrl} />
          <a className="tab" href={renderUrl} target="_blank" rel="noreferrer">↗ Buka / Simpan Video</a>
        </div>
      )}

      <div className="renderNote muted">Catatan: format final mengikuti dukungan MediaRecorder browser. Chrome/Edge biasanya menghasilkan WebM; bila browser mendukung H.264/AAC, hasil bisa MP4. FFmpeg server untuk MP4 universal dan export 4K penuh akan menjadi tahap lanjutan.</div>
    </div>
  );
}
