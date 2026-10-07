'use client';

import { useMemo, useState } from 'react';

type Scene = { duration_seconds?: number; [key: string]: unknown };
type Plan = { platform?: string; scenes: Scene[] };
type Project = { id: string } | null;

function formatTime(seconds: number) {
  const s = Math.max(0, Math.floor(seconds));
  return `${String(Math.floor(s / 60)).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}`;
}

export default function ProductionRenderStudio({ project, plan }: { project: Project; plan: Plan }) {
  const [resolution, setResolution] = useState<'720p' | '1080p' | '4K'>('1080p');
  const [fps, setFps] = useState('30');
  const [includeVoice, setIncludeVoice] = useState(true);
  const [burnSubtitles, setBurnSubtitles] = useState(true);
  const [useSceneVideos, setUseSceneVideos] = useState(true);
  const [useSceneAudio, setUseSceneAudio] = useState(true);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
  const [url, setUrl] = useState('');

  const aspectRatio = useMemo(() => ['YouTube Shorts', 'TikTok', 'Instagram Reels'].includes(String(plan.platform)) ? '9:16' : '16:9', [plan.platform]);
  const duration = useMemo(() => plan.scenes.reduce((sum, s) => sum + Math.max(1, Number(s.duration_seconds || 1)), 0), [plan.scenes]);
  const voiceCount = useMemo(() => plan.scenes.filter((s: any) => Boolean(s.voice_url || s.voice_asset_id)).length, [plan.scenes]);
  const sceneVideoCount = useMemo(() => plan.scenes.filter((s: any) => Boolean(s.video_url || s.video_asset_id)).length, [plan.scenes]);

  async function render() {
    if (!project) return setMessage('Project belum tersedia.');
    if (!plan.scenes.length) return setMessage('Belum ada scene.');
    setBusy(true); setMessage(`Menjalankan FFmpeg ${resolution} ${aspectRatio}...`); setUrl('');
    try {
      const response = await fetch('/api/content/render/production', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ projectId: project.id, resolution, fps: Number(fps), includeVoice, burnSubtitles, useSceneVideos, useSceneAudio }),
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(data.error || 'Production render gagal.');
      setUrl(data.url || '');
      setMessage(`✓ MP4 production selesai • ${resolution} • ${fps} fps • ${formatTime(data.durationSeconds || duration)}`);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'Production render gagal.');
    } finally { setBusy(false); }
  }

  return <section className="productionRender">
    <div className="renderHead">
      <div><h3>⚙️ Production Render — FFmpeg</h3><p className="muted">Render MP4 server-side dengan FFmpeg, subtitle, H.264 + AAC. Video AI scene dapat membawa audio native dari provider.</p></div>
      <span className="badge">Phase 8</span>
    </div>
    <div className="renderInfo"><span>{aspectRatio}</span><span>{plan.scenes.length} scene</span><span>{formatTime(duration)}</span><span>Voice tersedia: {voiceCount}/{plan.scenes.length}</span><span>Video scene: {sceneVideoCount}/{plan.scenes.length}</span></div>
    <div className="renderSettings">
      <label>Resolusi<select value={resolution} onChange={e => setResolution(e.target.value as any)} disabled={busy}><option value="720p">720p</option><option value="1080p">1080p</option><option value="4K">4K</option></select></label>
      <label>FPS<select value={fps} onChange={e => setFps(e.target.value)} disabled={busy}><option value="24">24 fps</option><option value="30">30 fps</option><option value="60">60 fps</option></select></label>
      <div className="checkField"><label><input type="checkbox" checked={includeVoice} onChange={e => setIncludeVoice(e.target.checked)} disabled={busy}/> Sertakan voice yang sudah dibuat</label><label><input type="checkbox" checked={burnSubtitles} onChange={e => setBurnSubtitles(e.target.checked)} disabled={busy}/> Burn subtitle ke video</label><label><input type="checkbox" checked={useSceneVideos} onChange={e => setUseSceneVideos(e.target.checked)} disabled={busy}/> Gunakan video AI scene yang sudah tersedia</label><label><input type="checkbox" checked={useSceneAudio} onChange={e => setUseSceneAudio(e.target.checked)} disabled={busy}/> Gunakan audio native dari video AI scene bila tidak ada voice ElevenLabs</label></div>
    </div>
    <button className="primary" onClick={render} disabled={busy || !project}>{busy ? '⏳ Rendering FFmpeg...' : '🎬 Render MP4 Production'}</button>
    {busy && <div className="ffmpegProgress"><div /></div>}
    {message && <div className={message.startsWith('✓') ? 'ok' : 'error'}>{message}</div>}
    {url && <div className="renderResult"><strong>MP4 production</strong><video controls src={url}/><a className="tab" href={url} target="_blank" rel="noreferrer">↗ Buka / Simpan MP4</a></div>}
    <div className="renderNote muted">FFmpeg harus tersedia di komputer/server yang menjalankan Next.js. Set <code>FFMPEG_PATH</code> bila perintah <code>ffmpeg</code> tidak ada di PATH. Untuk 4K, proses bisa jauh lebih berat.</div>
  </section>;
}
