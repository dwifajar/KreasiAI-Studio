'use client';
import { useEffect, useState } from 'react';
import { createClient } from '@/lib/supabase/browser';
import RenderStudio from './RenderStudio';
import ProductionRenderStudio from './ProductionRenderStudio';
import AdvancedVideoEditor, { type Plan, type Scene } from './AdvancedVideoEditor';

type Project = {id:string};

function withTiming(plan: Plan): Plan {
  let cursor = 0;
  const scenes = plan.scenes.map((s) => {
    const source = Math.max(1, Number(s.video_duration_seconds || s.duration_seconds || 1));
    const trimStart = Math.max(0, Number(s.trim_start_seconds || 0));
    const trimEnd = Math.max(trimStart + 0.25, Math.min(source, Number(s.trim_end_seconds ?? source)));
    const effectiveDuration = s.trim_start_seconds !== undefined || s.trim_end_seconds !== undefined
      ? Math.max(0.25, trimEnd - trimStart)
      : Math.max(0.25, Number(s.duration_seconds || 1));
    const start = cursor;
    const end = cursor + effectiveDuration;
    cursor = end;
    return {...s, start_seconds:start, end_seconds:end};
  });
  return {...plan, duration_seconds: cursor, scenes};
}

export default function ContentStudio({initialProjectId=null}:{initialProjectId?:string|null}){
  const [idea,setIdea]=useState('Video promosi kopi lokal Indonesia untuk anak muda');
  const [duration,setDuration]=useState('30');
  const [platform,setPlatform]=useState('YouTube Shorts');
  const [tone,setTone]=useState('cinematic');
  const [plan,setPlan]=useState<Plan|null>(null);
  const [project,setProject]=useState<Project|null>(null);
  const [busy,setBusy]=useState(false);
  const [voiceBusy,setVoiceBusy]=useState(false);
  const [videoBusy,setVideoBusy]=useState<number|null>(null);
  const [videoProvider,setVideoProvider]=useState('smart');
  const [videoResolution,setVideoResolution]=useState<'720p'|'1080p'|'4K'>('1080p');
  const [videoProviderReady,setVideoProviderReady]=useState<boolean|null>(null);
  const [videoProviders,setVideoProviders]=useState<any[]>([]);
  const [videoProviderModel,setVideoProviderModel]=useState('');
  const [message,setMessage]=useState('');
  const [elevenRemaining,setElevenRemaining]=useState<number|null>(null);
  const [activeScene,setActiveScene]=useState(0);
  const [playing,setPlaying]=useState(false);
  const [saving,setSaving]=useState(false);
  const [toast,setToast]=useState<{kind:'info'|'success'|'warning'|'error';title:string;body:string;detail?:string}|null>(null);
  const supabase = createClient();

  function announce(text:string){
    const raw = String(text || '').trim();
    const lower = raw.toLowerCase();
    let kind:'info'|'success'|'warning'|'error' = 'info';
    if (raw.includes('✓') || lower.includes('berhasil') || lower.includes('tersimpan') || lower.includes('selesai dibuat')) kind='success';
    if (lower.includes('warning') || lower.includes('quota') || lower.includes('fallback') || lower.includes('tidak tersedia')) kind='warning';
    if (lower.includes('error') || lower.includes('gagal') || lower.includes('401') || lower.includes('429') || lower.includes('500')) kind='error';

    let clean = raw;
    let detail = '';
    const jsonStart = raw.indexOf('{');
    if (jsonStart >= 0) {
      const prefix = raw.slice(0, jsonStart).trim();
      clean = prefix || raw;
      const jsonText = raw.slice(jsonStart);
      try {
        const parsed = JSON.parse(jsonText);
        const api = parsed?.error || parsed;
        detail = String(api?.message || api?.detail?.message || api?.status || '').trim();
      } catch {
        detail = '';
      }
    }
    // Keep the inline message compact too; the detailed notification lives in the fixed toast.
    setMessage(clean);

    if (lower.includes('smart fallback')) {
      return setToast({kind:'warning',title:'Veo tidak tersedia — Smart Fallback aktif',body:'Google Veo belum bisa digunakan. Scene otomatis dibuat dengan Local Scene.',detail:detail || 'Local fallback tidak memakai quota Google.'});
    }
    if (lower.includes('quota google/veo') || lower.includes('resource_exhausted')) {
      return setToast({kind:'warning',title:'Quota Google/Veo belum cukup',body:'Generate AI Video dialihkan ke Local Scene agar proses tetap berjalan.',detail:detail || 'Periksa quota dan billing Google saat ingin memakai Veo.'});
    }
    if (lower.includes('quota elevenlabs')) {
      return setToast({kind:'warning',title:'Quota ElevenLabs belum cukup',body:clean.replace(/^.*?quota elevenlabs/i,'Quota ElevenLabs').trim(),detail:detail || 'Gunakan Voice Preview atau pendekkan narasi.'});
    }
    if (kind==='error') {
      return setToast({kind,title:'Terjadi masalah',body:clean.slice(0,220),detail:detail || undefined});
    }
    setToast({kind,title:kind==='success'?'Berhasil':'Info',body:clean.slice(0,220)});
  }

  useEffect(()=>{
    if(!toast) return;
    const ms = toast.kind==='error' ? 9000 : 6500;
    const timer = window.setTimeout(()=>setToast(null), ms);
    return ()=>window.clearTimeout(timer);
  },[toast]);

  const totalVoiceChars = plan ? plan.scenes.reduce((sum,s)=>sum + (s.narration||'').length,0) : 0;
  const voiceCharsForScene = (s: Scene) => (s.narration||'').length;

  function loadKnownQuota(){
    try {
      const v = window.localStorage.getItem('kai_eleven_remaining');
      if (v !== null && Number.isFinite(Number(v))) setElevenRemaining(Number(v));
    } catch {}
  }

  function rememberQuota(value:number){
    setElevenRemaining(value);
    try { window.localStorage.setItem('kai_eleven_remaining', String(value)); } catch {}
  }

  function previewVoice(text:string){
    if(typeof window === 'undefined' || !('speechSynthesis' in window)){ announce('Browser ini tidak mendukung Voice Preview.'); return; }
    window.speechSynthesis.cancel();
    const u = new SpeechSynthesisUtterance(text);
    u.lang = 'id-ID';
    u.rate = 0.95;
    window.speechSynthesis.speak(u);
    announce('🔊 Voice Preview berjalan di browser. Tidak memakai quota ElevenLabs.');
  }

  useEffect(()=>{ loadKnownQuota(); },[]);

  useEffect(()=>{
    if(!initialProjectId) return;
    let cancelled=false;
    (async()=>{
      try{
        const {data,error}=await supabase.from('kai_projects').select('id,name,settings').eq('id',initialProjectId).single();
        if(error) throw error;
        if(cancelled)return;
        const loaded=(data?.settings as any)?.content_plan as Plan|undefined;
        if(loaded?.scenes){ setProject({id:data.id}); setPlan(withTiming(loaded)); announce(`✓ Project “${data.name}” dimuat ke editor.`); }
        else { setProject({id:data.id}); setPlan(null); announce('Project belum memiliki Content Plan. Buat script baru untuk mengisi project ini.'); }
      }catch(e){ if(!cancelled) announce(e instanceof Error?e.message:'Gagal membuka project.'); }
    })();
    return()=>{cancelled=true};
  },[initialProjectId]);

  useEffect(()=>{
    fetch('/api/video/providers').then(async r=>{ const d=await r.json().catch(()=>({})); const list=Array.isArray(d.providers)?d.providers:[]; setVideoProviders(list); const p=list.find((x:any)=>x.id==='veo'); setVideoProviderReady(Boolean(p?.configured)); setVideoProviderModel(String(p?.model||'')); if(d.defaultProvider) setVideoProvider(String(d.defaultProvider)); }).catch(()=>{setVideoProviderReady(false);setVideoProviders([])});
  },[]);


  function updateScene(index:number, patch:Partial<Scene>){
    if(!plan) return;
    const scenes=plan.scenes.map((s,i)=>i===index?{...s,...patch}:s);
    setPlan(withTiming({...plan,scenes}));
  }

  async function saveTimeline(){
    if(!project||!plan)return;
    setSaving(true);announce('Menyimpan timeline dan subtitle...');
    try{
      const r=await fetch('/api/content/save-plan',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({projectId:project.id,plan})});
      const d=await r.json(); if(!r.ok) throw new Error(d.error||'Gagal menyimpan timeline');
      announce('✓ Timeline, durasi, dan subtitle tersimpan.');
    }catch(e){announce(e instanceof Error?e.message:'Gagal menyimpan timeline.')}finally{setSaving(false)}
  }

  function exportProject(){
    if(!plan)return;
    const blob=new Blob([JSON.stringify({projectId:project?.id||null,plan,exportedAt:new Date().toISOString()},null,2)],{type:'application/json'});
    const url=URL.createObjectURL(blob); const a=document.createElement('a'); a.href=url; a.download='kreasiai-project.json'; a.click(); URL.revokeObjectURL(url);
    announce('✓ Project timeline diekspor sebagai JSON.');
  }

  useEffect(()=>{
    if(!playing||!plan) return;
    const id=window.setTimeout(()=>{
      setActiveScene((current)=>{
        if(current>=plan.scenes.length-1){setPlaying(false);return current;}
        return current+1;
      });
    }, Math.max(1,Number(plan.scenes[activeScene]?.duration_seconds||1))*1000);
    return ()=>window.clearTimeout(id);
  },[playing,activeScene,plan]);

  async function createPlan(){
    setBusy(true);announce('Menyusun script dan scene...');
    try{
      const r=await fetch('/api/content/plan',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({idea,duration:Number(duration),platform,tone})});
      const d=await r.json();
      if(!r.ok) throw new Error(d.error||'Gagal membuat content plan');
      setProject(d.project);setPlan(withTiming(d.plan));announce(`Content plan tersimpan • ${d.plan.scenes.length} scene • provider: ${d.plan.provider}`);
    }catch(e){announce(e instanceof Error?e.message:'Terjadi kesalahan.')}finally{setBusy(false)}
  }

  async function generateVoice(sceneIndex?: number){
    if(!project||!plan)return;
    const all=sceneIndex===undefined;
    const targets=all?plan.scenes.map((_,i)=>i):[sceneIndex];
    const requestedChars=targets.reduce((sum,i)=>sum+voiceCharsForScene(plan.scenes[i]),0);
    if(elevenRemaining !== null && requestedChars > elevenRemaining){
      announce(`Quota ElevenLabs yang diketahui tidak cukup: perlu ±${requestedChars} karakter, tersisa ${elevenRemaining}. Gunakan Voice Preview atau pendekkan narasi.`);
      return;
    }
    setVoiceBusy(all);
    if(sceneIndex!==undefined)setVideoBusy(null);
    announce(all?'Membuat voice untuk semua scene...':`Membuat voice Scene ${sceneIndex+1}...`);
    try{
      const updated=[...plan.scenes];
      for(const i of targets){
        const s=updated[i];
        const r=await fetch('/api/content/voice',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({projectId:project.id,sceneNumber:s.scene,text:s.narration})});
        const d=await r.json();
        if(!r.ok){
          const detail = d.error || `Gagal membuat voice Scene ${s.scene}`;
          const quota = typeof d.quota?.remaining === 'number' ? d.quota.remaining : null;
          if(quota !== null) rememberQuota(quota);
          throw new Error(`Scene ${s.scene}: ${detail}`);
        }
        updated[i]={...s,voice_url:d.url||null,voice_job_id:d.jobId||null};
        if(elevenRemaining !== null) setElevenRemaining(Math.max(0, elevenRemaining - voiceCharsForScene(s)));
        setPlan(withTiming({...plan,scenes:updated}));
      }
      announce(all?'✓ Semua voice scene berhasil dibuat.':'✓ Voice scene berhasil dibuat.');
    }catch(e){announce(e instanceof Error?e.message:'Gagal membuat voice.')}finally{setVoiceBusy(false)}
  }
  function chooseClipDuration(sceneDuration:number, resolution:string):4|6|8{
    if(resolution!=='720p') return 8;
    if(sceneDuration<=4) return 4;
    if(sceneDuration<=6) return 6;
    return 8;
  }

  async function generateVideo(sceneIndex:number){
    if(!plan) return;
    const s=plan.scenes[sceneIndex];
    if(videoProvider==='veo' && videoProviderReady===false){
      announce('Google Veo belum siap. Pilih Smart Auto atau Local Preview, atau tambahkan GOOGLE_API_KEY dan quota.');
      return;
    }
    const clipDuration=chooseClipDuration(Number(s.duration_seconds||1),videoResolution);
    setVideoBusy(sceneIndex);announce(`Menyiapkan Scene ${s.scene} via ${videoProvider === 'smart' ? 'Smart Auto' : videoProvider === 'veo' ? 'Google Veo 3.1' : 'Local Scene'}...`);
    try{
      const r=await fetch('/api/generate/video',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({projectId:project?.id,provider:videoProvider,sceneNumber:s.scene,prompt:s.visual_prompt,camera:s.camera,tone:plan.tone,sceneDuration:Number(s.duration_seconds||1),durationSeconds:clipDuration,aspectRatio:platform==='YouTube Shorts'||platform==='TikTok'||platform==='Instagram Reels'?'9:16':'16:9',resolution:videoResolution})});
      const d=await r.json().catch(()=>({}));
      if(!r.ok) throw new Error(d.error||'Gagal memulai video');
      if(d.status==='completed'&&d.url){
        const updated=plan.scenes.map(x=>Number(x.scene)===Number(s.scene)?{...x,video_url:d.url,video_asset_id:d.assetId||null,video_job_id:d.jobId||null,video_provider:d.provider||videoProvider,video_model:d.model||null,video_duration_seconds:d.durationSeconds||clipDuration}:x);
        setPlan(withTiming({...plan,scenes:updated}));
        announce(d.message||`✓ Scene ${s.scene} selesai dibuat • ${d.provider||videoProvider}.`);
        return;
      }
      announce(`✓ Scene ${s.scene} masuk antrean ${d.provider||videoProvider} • ${d.model||videoProviderModel||''} • clip ${d.durationSeconds||clipDuration}s. Menunggu provider...`);
      for(let attempt=0; attempt<36; attempt+=1){
        await new Promise(resolve=>setTimeout(resolve,8000));
        const poll=await fetch(`/api/jobs/${d.jobId}`);
        const pd=await poll.json().catch(()=>({}));
        if(pd.status==='completed'&&pd.output_url){
          const updated=plan.scenes.map(x=>Number(x.scene)===Number(s.scene)?{...x,video_url:pd.output_url,video_asset_id:pd.assetId||null,video_job_id:d.jobId,video_provider:d.provider||videoProvider,video_model:pd.model||d.model||videoProviderModel||null,video_duration_seconds:pd.durationSeconds||d.durationSeconds||clipDuration}:x);
          const nextPlan=withTiming({...plan,scenes:updated});
          setPlan(nextPlan);
          announce(`✓ Scene ${s.scene} selesai dibuat • ${d.provider||videoProvider} • ${pd.durationSeconds||d.durationSeconds||clipDuration}s. Siap untuk Production Render.`);
          return;
        }
        if(pd.status==='failed'){ throw new Error(pd.error_message||`Scene ${s.scene} gagal dibuat.`); }
      }
      throw new Error(`Scene ${s.scene} masih diproses. Periksa kembali dari riwayat job.`);
    }catch(e){announce(e instanceof Error?e.message:'Gagal membuat video.')}finally{setVideoBusy(null)}
  }

  return <section className="contentStudio">
    {toast&&<div className={`kaiToast kaiToast-${toast.kind}`} role="status" aria-live="polite">
      <div className="kaiToastIcon">{toast.kind==='error'?'✕':toast.kind==='warning'?'⚠':'✓'}</div>
      <div className="kaiToastContent"><strong>{toast.title}</strong><p>{toast.body}</p>{toast.detail&&<small>{toast.detail}</small>}</div>
      <button className="kaiToastClose" onClick={()=>setToast(null)} aria-label="Tutup notifikasi">×</button>
    </div>}
    <div className="contentHead"><div><h2>AI Content Studio</h2><p>Ide → Script → Scene → Voice → Video. Phase 9: Project Management, Media Library, Render Queue, dan Billing workspace.</p></div><span className="badge">Phase 9</span></div>
    <div className="contentGrid">
      <div className="card innerCard">
        <div className="field"><label>Ide video</label><textarea value={idea} onChange={e=>setIdea(e.target.value)} placeholder="Contoh: video promosi usaha laundry modern..." /></div>
        <div className="row"><div className="field"><label>Durasi</label><select value={duration} onChange={e=>setDuration(e.target.value)}><option value="15">15 detik</option><option value="30">30 detik</option><option value="60">60 detik</option><option value="90">90 detik</option></select></div><div className="field"><label>Platform</label><select value={platform} onChange={e=>setPlatform(e.target.value)}><option>YouTube Shorts</option><option>TikTok</option><option>Instagram Reels</option><option>YouTube</option></select></div></div>
        <div className="field"><label>Gaya</label><select value={tone} onChange={e=>setTone(e.target.value)}><option>cinematic</option><option>realistic</option><option>commercial</option><option>documentary</option><option>energetic</option></select></div>
        <button className="primary" disabled={busy||!idea.trim()} onClick={createPlan}>{busy?'Menyusun...':'✨ Buat Script + Scene'}</button>
        {message&&<div className={message.includes('✓')||message.includes('tersimpan')?'ok':'error'}>{message}</div>}
      </div>
      <div className="card innerCard"><h3>Pipeline Phase 7</h3><div className="pipeline"><span>💡 Ide</span><b>↓</b><span>📝 Script</span><b>↓</b><span>🎬 Scene</span><b>↓</b><span>🎙️ Voice</span><b>↓</b><span>🤖 AI Video</span><b>↓</b><span>💾 Render</span></div><div className="videoProviderPanel"><div><strong>Real AI Video Provider</strong><p className="muted">Smart Auto akan mencoba Google Veo lalu otomatis fallback ke Local Scene jika quota/akses Veo tidak tersedia.</p></div><div className="row"><div className="field"><label>Provider</label><select value={videoProvider} onChange={e=>setVideoProvider(e.target.value)} disabled={videoBusy!==null}>{videoProviders.length?videoProviders.map((p:any)=><option key={p.id} value={p.id}>{p.label}</option>):<><option value="smart">Smart Auto</option><option value="veo">Google Veo 3.1</option><option value="local">Local Scene Preview</option></>}</select></div><div className="field"><label>Resolusi AI Clip</label><select value={videoResolution} onChange={e=>setVideoResolution(e.target.value as any)} disabled={videoBusy!==null}><option value="720p">720p</option><option value="1080p">1080p</option><option value="4K">4K</option></select></div></div><div className="renderInfo"><span>Smart: ✓ fallback otomatis</span><span>Veo: {videoProviderReady===null?'mengecek...':videoProviderReady?'✓ API key tersedia':'⚠ quota/akses perlu dicek'}</span><span>Local: ✓ tanpa quota Google</span></div><p className="muted">Generate per scene agar penggunaan quota/credit tetap terkontrol. Untuk 1080p/4K, Veo menggunakan clip 8 detik; timeline KreasiAI dapat memangkas atau mengulangnya saat render.</p></div></div>
    </div>
    {plan&&<div className="card planCard">
      <div className="planTitle"><div><h2>{plan.title}</h2><p>{plan.duration_seconds}s • {plan.platform} • {plan.tone}</p></div><span className="badge">{plan.provider}</span></div>
      <div className="scriptBox"><strong>Hook</strong><p>{plan.hook}</p><strong>Script</strong><p>{plan.script}</p></div>
      <div className="actionRow"><button className="primary" disabled={voiceBusy||!project} onClick={()=>generateVoice()}>🎙️ {voiceBusy?'Membuat Voice...':'Generate Semua Voice'}</button><button className="tab" disabled={voiceBusy} onClick={()=>plan.scenes.forEach(s=>previewVoice(s.narration))}>🔊 Preview Voice</button><span className="muted">Estimasi: {totalVoiceChars} karakter • quota terakhir diketahui: {elevenRemaining===null?'belum diketahui':elevenRemaining+' karakter'}</span></div>
      <div className="timelineToolbar"><div><strong>Timeline Editor</strong><span className="muted"> Edit durasi dan subtitle sebelum render final.</span></div><div className="actionRow"><button className="tab" disabled={saving} onClick={saveTimeline}>💾 {saving?'Menyimpan...':'Simpan Timeline'}</button><button className="tab" onClick={exportProject}>⬇️ Export Project</button></div></div><div className="storyPlayer"><div className="storyVisual"><span>SCENE {activeScene+1}</span><strong>{plan.scenes[activeScene]?.visual_prompt}</strong><em>{plan.scenes[activeScene]?.narration}</em></div><div className="storyControls"><button className="primary" onClick={()=>setPlaying(!playing)}>{playing?'⏸ Pause':'▶ Play Preview'}</button><span>{activeScene+1}/{plan.scenes.length} • {plan.scenes[activeScene]?.start_seconds ?? 0}s–{plan.scenes[activeScene]?.end_seconds ?? 0}s</span></div></div><h3>Scene Breakdown & Timeline</h3>
      <div className="sceneList">{plan.scenes.map((s,i)=><article className="scene" key={s.scene}>
        <div className="sceneNo">{s.scene}</div><div style={{flex:1}}>
          <div className="sceneMeta"><strong>{s.role}</strong><span>{s.duration_seconds}s • {s.start_seconds ?? 0}s–{s.end_seconds ?? s.duration_seconds}s</span></div>
          <p><b>Narasi:</b> {s.narration}</p><p><b>Visual:</b> {s.visual_prompt}</p><small>Kamera: {s.camera} • Transisi: {s.transition}</small>
          <div className="timelineEdit"><label>Durasi (detik)<input type="number" min={1} max={120} value={s.duration_seconds} onChange={e=>updateScene(i,{duration_seconds:Math.max(1,Number(e.target.value)||1)})}/></label><label>Subtitle / Narasi<input value={s.narration} onChange={e=>updateScene(i,{narration:e.target.value})}/></label></div><div className="sceneActions">
            <button className="tab" disabled={voiceBusy} onClick={()=>generateVoice(i)}>🎙️ {s.voice_url?'Buat Ulang Voice':'Generate Voice'}</button><button className="tab" disabled={voiceBusy} onClick={()=>previewVoice(s.narration)}>🔊 Preview</button>
            <button className="tab" onClick={()=>{setActiveScene(i);setPlaying(false)}}>👁️ Lihat Scene</button><button className="tab" disabled={videoBusy===i || (videoProvider==='veo' && videoProviderReady===false)} onClick={()=>generateVideo(i)}>🤖 {videoBusy===i?'Memproses AI Video...':s.video_url?'Buat Ulang AI Video':'Generate AI Video'}</button>
            {s.voice_url&&<audio controls preload="none" src={s.voice_url} />}
            {s.video_url&&<div className="sceneVideoWrap"><video className="sceneVideoThumb" controls preload="metadata" src={s.video_url} /><small className="muted">{s.video_provider||'AI'} • {s.video_model||''} • {s.video_duration_seconds||''}s</small></div>}
          </div>
        </div>
      </article>)}</div>
      <div className="subtitleBox"><h3>Subtitle / Timing</h3><p className="muted">Timing scene otomatis dihitung dari durasi content plan. Data ini menjadi dasar subtitle dan final render pada tahap berikutnya.</p>{plan.scenes.map(s=><div className="subtitleLine" key={s.scene}><span>{String(Math.floor((s.start_seconds||0)/60)).padStart(2,'0')}:{String((s.start_seconds||0)%60).padStart(2,'0')}</span><strong>{s.narration}</strong></div>)}</div>
      <AdvancedVideoEditor project={project} plan={plan} onChange={setPlan} onSave={saveTimeline} announce={announce} />
      <RenderStudio project={project} plan={plan} />
      <ProductionRenderStudio project={project} plan={plan} />
    </div>}
  </section>
}
