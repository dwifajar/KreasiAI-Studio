'use client';

import { useEffect, useMemo, useRef, useState } from 'react';

export type Scene = {
  scene: number;
  role: string;
  duration_seconds: number;
  narration: string;
  visual_prompt: string;
  camera: string;
  transition: string;
  voice_url?: string | null;
  video_url?: string | null;
  video_asset_id?: string | null;
  video_duration_seconds?: number | null;
  video_model?: string | null;
  video_provider?: string | null;
  voice_asset_id?: string | null;
  voice_job_id?: string | null;
  start_seconds?: number;
  end_seconds?: number;
  trim_start_seconds?: number;
  trim_end_seconds?: number;
};

export type EditorSettings = {
  transitions: Record<string, { type: string; duration: number }>;
  subtitle: { size: 'small' | 'medium' | 'large'; position: 'bottom' | 'center' | 'top'; background: 'box' | 'shadow' | 'none' };
  watermark: { enabled: boolean; text: string; opacity: number; position: 'top-left' | 'top-right' | 'bottom-left' | 'bottom-right' };
  masterVolume: number;
  music: { assetId: string | null; name: string | null; volume: number };
};

export type Plan = {
  title: string;
  hook: string;
  script: string;
  platform: string;
  tone: string;
  duration_seconds: number;
  scenes: Scene[];
  provider: string;
  editor?: EditorSettings;
};

type Props = {
  project: { id: string } | null;
  plan: Plan;
  onChange: (plan: Plan) => void;
  onSave: () => Promise<void>;
  announce?: (text: string) => void;
};

const TRANSITIONS = [
  { id: 'cut', label: 'Cut' },
  { id: 'fade', label: 'Fade' },
  { id: 'dissolve', label: 'Dissolve' },
];

const DEFAULT_EDITOR: EditorSettings = {
  transitions: {},
  subtitle: { size: 'medium', position: 'bottom', background: 'box' },
  watermark: { enabled: false, text: 'KreasiAI', opacity: 0.72, position: 'bottom-right' },
  masterVolume: 1,
  music: { assetId: null, name: null, volume: 0.14 },
};

function mergeEditor(input?: Partial<EditorSettings>): EditorSettings {
  return {
    ...DEFAULT_EDITOR,
    ...input,
    subtitle: { ...DEFAULT_EDITOR.subtitle, ...(input?.subtitle || {}) },
    watermark: { ...DEFAULT_EDITOR.watermark, ...(input?.watermark || {}) },
    music: { ...DEFAULT_EDITOR.music, ...(input?.music || {}) },
    transitions: { ...(input?.transitions || {}) },
  };
}

function durationOf(scene: Scene) {
  const base = Math.max(0.25, Number(scene.duration_seconds || 1));
  if (scene.trim_start_seconds === undefined && scene.trim_end_seconds === undefined) return base;
  const source = Math.max(base, Number(scene.video_duration_seconds || base));
  const start = Math.max(0, Math.min(source - 0.25, Number(scene.trim_start_seconds || 0)));
  const end = Math.max(start + 0.25, Math.min(source, Number(scene.trim_end_seconds ?? Math.min(source, start + base))));
  return Math.max(0.25, end - start);
}

function formatTime(seconds: number) {
  const s = Math.max(0, Math.round(seconds));
  return `${String(Math.floor(s / 60)).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}`;
}

export default function AdvancedVideoEditor({ project, plan, onChange, onSave, announce }: Props) {
  const editor = useMemo(() => mergeEditor(plan.editor), [plan.editor]);
  const [selected, setSelected] = useState(0);
  const [draftScene, setDraftScene] = useState<Scene>(() => plan.scenes[0]);
  const [dragIndex, setDragIndex] = useState<number | null>(null);
  const [musicBusy, setMusicBusy] = useState(false);
  const [audioUrl, setAudioUrl] = useState<string>('');
  const [previewPlaying, setPreviewPlaying] = useState(false);
  const previewRef = useRef<HTMLVideoElement | null>(null);

  const current = plan.scenes[selected] || plan.scenes[0];
  const sourceDuration = Math.max(1, Number(current?.video_duration_seconds || current?.duration_seconds || 1));
  const defaultTrimEnd = Math.min(sourceDuration, Math.max(0.25, Number(current?.duration_seconds || sourceDuration) + Number(current?.trim_start_seconds || 0)));

  useEffect(() => {
    setDraftScene(current ? { ...current } : (plan.scenes[0] as Scene));
  }, [selected, plan.scenes, current]);

  useEffect(() => {
    if (!editor.music.assetId || !project) { setAudioUrl(''); return; }
    fetch(`/api/content/editor/music?projectId=${encodeURIComponent(project.id)}&assetId=${encodeURIComponent(editor.music.assetId)}`)
      .then(async r => { const d = await r.json().catch(() => ({})); if (r.ok) setAudioUrl(d.url || ''); })
      .catch(() => setAudioUrl(''));
  }, [editor.music.assetId, project]);

  function commitScene(patch: Partial<Scene>) {
    if (!plan.scenes.length) return;
    const nextScenes = plan.scenes.map((s, i) => i === selected ? { ...s, ...patch } : s);
    onChange({ ...plan, scenes: nextScenes, editor });
  }

  function commitEditor(patch: Partial<EditorSettings>) {
    onChange({ ...plan, editor: mergeEditor({ ...editor, ...patch }) });
  }

  function commitTransition(type: string, duration: number) {
    const transitions = { ...editor.transitions, [String(current.scene)]: { type, duration } };
    onChange({ ...plan, editor: { ...editor, transitions } });
  }

  function moveScene(from: number, to: number) {
    if (from === to || to < 0 || to >= plan.scenes.length) return;
    const scenes = [...plan.scenes];
    const [moved] = scenes.splice(from, 1);
    scenes.splice(to, 0, moved);
    onChange({ ...plan, scenes });
    setSelected(to);
    announce?.(`Scene ${moved.scene} dipindahkan.`);
  }

  async function uploadMusic(file: File) {
    if (!project) { announce?.('Project belum tersedia.'); return; }
    if (!file.type.startsWith('audio/')) { announce?.('Pilih file audio.'); return; }
    if (file.size > 30 * 1024 * 1024) { announce?.('File musik maksimal 30 MB.'); return; }
    setMusicBusy(true); announce?.('Mengunggah background music...');
    try {
      const form = new FormData();
      form.append('projectId', project.id);
      form.append('music', file);
      const response = await fetch('/api/content/editor/upload-music', { method: 'POST', body: form });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(data.error || 'Upload background music gagal.');
      onChange({ ...plan, editor: { ...editor, music: { assetId: data.assetId, name: file.name, volume: editor.music.volume } } });
      setAudioUrl(data.url || '');
      announce?.(`✓ Background music ${file.name} siap digunakan.`);
    } catch (error) {
      announce?.(error instanceof Error ? error.message : 'Upload background music gagal.');
    } finally { setMusicBusy(false); }
  }

  const currentTransition = editor.transitions[String(current?.scene)] || { type: 'cut', duration: 0.35 };

  if (!plan.scenes.length) return null;

  return <section className="advancedEditor">
    <div className="advancedEditorHead">
      <div><h3>🎞️ Advanced Video Editor</h3><p className="muted">Atur urutan scene, trim, transisi, subtitle, musik, volume, dan watermark sebelum Production Render.</p></div>
      <span className="badge">Phase 8</span>
    </div>

    <div className="editorToolbar">
      <div className="renderInfo">
        <span>{plan.scenes.length} scene</span>
        <span>Total edit {formatTime(plan.scenes.reduce((sum, s) => sum + durationOf(s), 0))}</span>
        <span>Volume {Math.round(editor.masterVolume * 100)}%</span>
      </div>
      <div className="actionRow">
        <button className="tab" onClick={onSave}>💾 Simpan Edit</button>
        <button className="tab" onClick={() => announce?.('Preview timeline aktif. Gunakan preview scene di bawah.')}>▶ Preview Timeline</button>
      </div>
    </div>

    <div className="editorLayout">
      <div className="card editorTimelineCard">
        <div className="timelineHeader"><strong>Timeline</strong><span className="muted">Drag scene untuk mengubah urutan</span></div>
        <div className="advancedTimeline">
          {plan.scenes.map((scene, i) => {
            const dur = durationOf(scene);
            const selectedClass = i === selected ? ' editorClip-selected' : '';
            return <button
              type="button"
              key={`${scene.scene}-${i}`}
              className={`editorClip${selectedClass}`}
              draggable
              onDragStart={() => setDragIndex(i)}
              onDragOver={e => e.preventDefault()}
              onDrop={() => { if (dragIndex !== null) moveScene(dragIndex, i); setDragIndex(null); }}
              onClick={() => { setSelected(i); setPreviewPlaying(false); }}
              title={`Scene ${scene.scene} • ${dur.toFixed(1)} detik`}
            >
              <span className="editorClipNo">{scene.scene}</span>
              <span className="editorClipBody"><strong>{scene.role || `Scene ${scene.scene}`}</strong><small>{formatTime(dur)}{scene.video_url ? ' • Video' : ' • Preview'}</small></span>
              <span className="editorClipHandle">☷</span>
            </button>;
          })}
        </div>
        <div className="editorTimelineTicks"><span>00:00</span><span>{formatTime(plan.scenes.reduce((sum, s) => sum + durationOf(s), 0))}</span></div>
      </div>

      <div className="card editorInspector">
        <div className="inspectorHead"><strong>Scene {current.scene}</strong><span className="muted">{current.role}</span></div>

        <div className="editorPreviewBox">
          {current.video_url ? <video ref={previewRef} src={current.video_url} controls={false} muted={false} onEnded={() => setPreviewPlaying(false)} /> : <div className="editorFallbackVisual"><span>SCENE {current.scene}</span><strong>{current.visual_prompt}</strong><em>{current.narration}</em></div>}
          {current.video_url && <button className="previewPlayButton" type="button" onClick={() => { const el = previewRef.current; if (!el) return; if (previewPlaying) { el.pause(); setPreviewPlaying(false); } else { el.currentTime = Number(current.trim_start_seconds || 0); el.play().catch(() => undefined); setPreviewPlaying(true); } }}>{previewPlaying ? '⏸ Pause' : '▶ Preview Scene'}</button>}
        </div>

        <div className="inspectorSection">
          <h4>✂️ Trim Scene</h4>
          <div className="inspectorGrid2">
            <label>Start (detik)<input type="number" min="0" max={Math.max(0, sourceDuration - 0.25)} step="0.1" value={Number(draftScene.trim_start_seconds || 0)} onChange={e => { const start = Math.max(0, Math.min(sourceDuration - 0.25, Number(e.target.value) || 0)); setDraftScene({ ...draftScene, trim_start_seconds: start }); commitScene({ trim_start_seconds: start }); }} /></label>
            <label>End (detik)<input type="number" min="0.25" max={sourceDuration} step="0.1" value={Number(draftScene.trim_end_seconds ?? defaultTrimEnd)} onChange={e => { const end = Math.max(Number(draftScene.trim_start_seconds || 0) + 0.25, Math.min(sourceDuration, Number(e.target.value) || sourceDuration)); setDraftScene({ ...draftScene, trim_end_seconds: end }); commitScene({ trim_end_seconds: end }); }} /></label>
          </div>
          <input className="trimRange" type="range" min="0" max="100" step="0.1" value={Math.max(0, Math.min(100, ((Number(draftScene.trim_start_seconds || 0) / sourceDuration) * 100)))} onChange={e => { const start = Math.min(sourceDuration - 0.25, (Number(e.target.value) / 100) * sourceDuration); setDraftScene({ ...draftScene, trim_start_seconds: start }); commitScene({ trim_start_seconds: start }); }} />
          <input className="trimRange" type="range" min="0" max="100" step="0.1" value={Math.max(0, Math.min(100, ((Number(draftScene.trim_end_seconds ?? defaultTrimEnd) / sourceDuration) * 100)))} onChange={e => { const end = Math.max(Number(draftScene.trim_start_seconds || 0) + 0.25, (Number(e.target.value) / 100) * sourceDuration); setDraftScene({ ...draftScene, trim_end_seconds: end }); commitScene({ trim_end_seconds: end }); }} />
          <small className="muted">Sumber {sourceDuration.toFixed(1)}s • hasil {(durationOf(current)).toFixed(1)}s</small>
        </div>

        <div className="inspectorSection">
          <h4>✨ Transition</h4>
          <div className="inspectorGrid2"><label>Jenis<select value={currentTransition.type} onChange={e => commitTransition(e.target.value, currentTransition.duration)}>{TRANSITIONS.map(t => <option key={t.id} value={t.id}>{t.label}</option>)}</select></label><label>Durasi<select value={String(currentTransition.duration)} onChange={e => commitTransition(currentTransition.type, Number(e.target.value))}><option value="0">0s</option><option value="0.25">0.25s</option><option value="0.5">0.5s</option><option value="0.75">0.75s</option><option value="1">1s</option></select></label></div>
        </div>

        <div className="inspectorSection">
          <h4>🔤 Subtitle Style</h4>
          <div className="inspectorGrid3"><label>Ukuran<select value={editor.subtitle.size} onChange={e => commitEditor({ subtitle: { ...editor.subtitle, size: e.target.value as any } })}><option value="small">Kecil</option><option value="medium">Sedang</option><option value="large">Besar</option></select></label><label>Posisi<select value={editor.subtitle.position} onChange={e => commitEditor({ subtitle: { ...editor.subtitle, position: e.target.value as any } })}><option value="bottom">Bawah</option><option value="center">Tengah</option><option value="top">Atas</option></select></label><label>Latar<select value={editor.subtitle.background} onChange={e => commitEditor({ subtitle: { ...editor.subtitle, background: e.target.value as any } })}><option value="box">Box</option><option value="shadow">Shadow</option><option value="none">Tanpa box</option></select></label></div>
        </div>
      </div>
    </div>

    <div className="editorLowerGrid">
      <div className="card editorAudioCard">
        <h4>🎵 Background Music</h4>
        <p className="muted">Upload satu file musik untuk diputar sepanjang video. Maksimal 30 MB.</p>
        <div className="actionRow"><label className="uploadButton"><input type="file" accept="audio/*" onChange={e => { const file = e.target.files?.[0]; if (file) uploadMusic(file); }} disabled={musicBusy || !project} />{musicBusy ? '⏳ Mengunggah...' : '＋ Pilih Audio'}</label>{editor.music.name && <span className="musicName">{editor.music.name}</span>}</div>
        <label className="fullLabel">Volume Musik <input type="range" min="0" max="0.5" step="0.01" value={editor.music.volume} onChange={e => commitEditor({ music: { ...editor.music, volume: Number(e.target.value) } })} /><strong>{Math.round(editor.music.volume * 100)}%</strong></label>
        {audioUrl && <audio controls src={audioUrl} preload="metadata" />}
        {editor.music.assetId && <button className="tab" onClick={() => { onChange({ ...plan, editor: { ...editor, music: { assetId: null, name: null, volume: editor.music.volume } } }); setAudioUrl(''); announce?.('Background music dilepas dari project.'); }}>Hapus Musik</button>}
      </div>

      <div className="card editorAudioCard">
        <h4>🏷️ Watermark & Master Audio</h4>
        <label className="checkLine"><input type="checkbox" checked={editor.watermark.enabled} onChange={e => commitEditor({ watermark: { ...editor.watermark, enabled: e.target.checked } })} /> Aktifkan watermark</label>
        <label className="fullLabel">Teks <input value={editor.watermark.text} onChange={e => commitEditor({ watermark: { ...editor.watermark, text: e.target.value } })} /></label>
        <div className="inspectorGrid2"><label>Posisi<select value={editor.watermark.position} onChange={e => commitEditor({ watermark: { ...editor.watermark, position: e.target.value as any } })}><option value="top-left">Kiri atas</option><option value="top-right">Kanan atas</option><option value="bottom-left">Kiri bawah</option><option value="bottom-right">Kanan bawah</option></select></label><label>Opacity<input type="range" min="0.1" max="1" step="0.05" value={editor.watermark.opacity} onChange={e => commitEditor({ watermark: { ...editor.watermark, opacity: Number(e.target.value) } })} /></label></div>
        <label className="fullLabel">Master Volume <input type="range" min="0" max="1.25" step="0.01" value={editor.masterVolume} onChange={e => commitEditor({ masterVolume: Number(e.target.value) })} /><strong>{Math.round(editor.masterVolume * 100)}%</strong></label>
      </div>
    </div>
  </section>;
}
