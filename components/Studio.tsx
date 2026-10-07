'use client';
import { useEffect, useState } from 'react';
import { createClient } from '@/lib/supabase/browser';
import ContentStudio from './ContentStudio';
import ProjectHub from './ProjectHub';
import AdminPanel from './AdminPanel';
import { ttsCreditCost, videoCreditCost } from '@/lib/kai';

type Job = { id:string; type:string; prompt:string; status:string; output_url?:string|null; created_at:string; error_message?:string|null };

type Profile = { credits:number; plan:string };

export default function Studio({ email }:{email:string}) {
  const [type,setType]=useState<'video'|'tts'>('video');
  const [mode,setMode]=useState<'generate'|'content'>('generate');
  const [hubMode,setHubMode]=useState<'studio'|'projects'|'media'|'queue'|'billing'|'admin'>('studio');
  const [isAdmin,setIsAdmin]=useState(false);
  const [selectedProjectId,setSelectedProjectId]=useState<string|null>(null);
  const [contentKey,setContentKey]=useState(0);
  const [prompt,setPrompt]=useState('');
  const [aspectRatio,setAspectRatio]=useState('16:9');
  const [resolution,setResolution]=useState('1080p');
  const [voice,setVoice]=useState('');
  const [loading,setLoading]=useState(false);
  const [message,setMessage]=useState('');
  const [jobs,setJobs]=useState<Job[]>([]);
  const [profile,setProfile]=useState<Profile|null>(null);
  const supabase=createClient();

  async function load(){
    const [{data:jobsData},{data:profileData}] = await Promise.all([
      supabase.from('kai_generation_jobs').select('id,type,prompt,status,output_url,created_at,error_message').order('created_at',{ascending:false}).limit(12),
      supabase.from('kai_profiles').select('credits,plan').single(),
    ]);
    if(jobsData)setJobs(jobsData);
    if(profileData)setProfile(profileData);
  }
  useEffect(()=>{load(); fetch('/api/admin/access').then(r=>r.ok?r.json():{isAdmin:false}).then(d=>setIsAdmin(Boolean(d.isAdmin))).catch(()=>{});},[]);

  useEffect(()=>{
    const active=jobs.some(j=>j.type==='video' && j.status==='processing');
    if(!active)return;
    const timer=setInterval(async()=>{
      for(const j of jobs.filter(x=>x.type==='video' && x.status==='processing')){
        const r=await fetch(`/api/jobs/${j.id}`);
        if(r.ok) await load();
      }
    },10000);
    return()=>clearInterval(timer);
  },[jobs]);

  function openProject(id:string){ setSelectedProjectId(id); setMode('content'); setHubMode('studio'); setContentKey(k=>k+1); }
  function newProject(){ setSelectedProjectId(null); setMode('content'); setHubMode('studio'); setContentKey(k=>k+1); }

  async function generate(){
    setLoading(true);setMessage('Menyiapkan generasi...');
    const endpoint=type==='video'?'/api/generate/video':'/api/generate/tts';
    const body=type==='video'?{prompt,aspectRatio,resolution}:{text:prompt,voiceId:voice||undefined};
    try{
      const r=await fetch(endpoint,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)});
      const d=await r.json();
      if(!r.ok)setMessage(d.error||'Gagal');
      else setMessage(type==='video'?'Video sedang diproses. Halaman akan memperbarui status otomatis.':'Suara berhasil dibuat.');
      await load();
    }catch(e){setMessage(e instanceof Error?e.message:'Terjadi kesalahan jaringan.');}
    finally{setLoading(false)}
  }

  const currentLabel = hubMode === 'studio' ? 'Studio' : hubMode === 'projects' ? 'Projects' : hubMode === 'media' ? 'Media Library' : hubMode === 'queue' ? 'Render Queue' : hubMode === 'billing' ? 'Billing' : 'Admin SaaS';
  const navItems = [
    { id:'studio', icon:'✦', label:'Studio' },
    { id:'projects', icon:'▣', label:'Projects' },
    { id:'media', icon:'◈', label:'Media Library' },
    { id:'queue', icon:'↗', label:'Render Queue' },
    { id:'billing', icon:'◌', label:'Billing' },
    ...(isAdmin ? [{ id:'admin', icon:'⌘', label:'Admin SaaS' as const }] : []),
  ] as const;

  return (
    <div className="kaiAppShell">
      <aside className="kaiSidebar">
        <div className="sideBrand">
          <div className="sideBrandMark">K</div>
          <div><div className="sideBrandName">KreasiAI</div><div className="sideBrandSub">Studio</div></div>
        </div>

        <div className="sideSectionTitle">WORKSPACE</div>
        <nav className="sideNav" aria-label="Workspace">
          {navItems.map(item => (
            <button
              key={item.id}
              className={`sideNavItem ${hubMode === item.id ? 'active' : ''}`}
              onClick={() => setHubMode(item.id as typeof hubMode)}
            >
              <span className="sideNavIcon">{item.icon}</span>
              <span>{item.label}</span>
              {item.id === 'queue' && jobs.some(j=>j.status==='processing') && <span className="navDot" />}
            </button>
          ))}
        </nav>

        <div className="sideSectionTitle">CREATE</div>
        <button className="sideCreateBtn" onClick={newProject}><span>＋</span> New Project</button>

        <div className="sideMiniCard">
          <div className="sideMiniTop"><span>PLAN</span><strong>{profile?.plan?.toUpperCase()||'FREE'}</strong></div>
          <div className="creditBar"><span style={{width:`${Math.min(100,Math.max(0,(profile?.credits||0)/(profile?.plan==='business'?5000:profile?.plan==='pro'?1200:profile?.plan==='creator'?300:30)*100))}%`}} /></div>
          <div className="sideMiniMeta"><span>Credits</span><b>{profile?.credits ?? '—'}</b></div>
        </div>

        <div className="sideFooter">
          <div className="sideUser"><div className="avatar">{(email?.[0]||'U').toUpperCase()}</div><div className="sideUserText"><strong>{email}</strong><span>Account</span></div></div>
          <button className="sideSignout" onClick={async()=>{await supabase.auth.signOut();location.href='/'}}>↪ Keluar</button>
        </div>
      </aside>

      <div className="kaiMainArea">
        <header className="kaiTopbar">
          <div className="kaiTopbarLeft">
            <div className="crumb">KreasiAI <span>/</span> <strong>{currentLabel}</strong></div>
            {hubMode === 'studio' && <div className="modeSwitch"><button className={mode==='generate'?'active':''} onClick={()=>setMode('generate')}>Generator</button><button className={mode==='content'?'active':''} onClick={()=>{setMode('content');setSelectedProjectId(null);setContentKey(k=>k+1)}}>AI Content Planner</button></div>}
          </div>
          <div className="topActions">
            <span className="statusPill"><span className="statusDot" /> System online</span>
            <span className="creditPill"><b>{profile?.credits ?? '—'}</b> credit</span>
            <div className="topAvatar">{(email?.[0]||'U').toUpperCase()}</div>
          </div>
        </header>

        <main className="kaiMain">
          {hubMode === 'admin' ? (
            <AdminPanel />
          ) : hubMode !== 'studio' ? (
            <ProjectHub section={hubMode} onOpenProject={openProject} onNewProject={newProject} />
          ) : mode === 'content' ? (
            <div className="studioWorkspace">
              <div className="workspaceIntro">
                <div>
                  <div className="eyebrow">AI CONTENT WORKSPACE</div>
                  <h1>Ceritakan. Kami Buatkan.</h1>
                  <p>Bangun video dari ide sampai final render dalam satu workspace yang rapi dan fokus.</p>
                </div>
                <button className="ghostAction" onClick={newProject}>＋ Project Baru</button>
              </div>
              <ContentStudio key={contentKey} initialProjectId={selectedProjectId} />
            </div>
          ) : (
            <div className="studioWorkspace">
              <section className="studioHeroPanel">
                <div className="heroCopy">
                  <div className="eyebrow">GENERATIVE VIDEO WORKSPACE</div>
                  <h1>Turn your idea into <span>content.</span></h1>
                  <p>Satu ruang kerja untuk video AI, narasi, editing, dan production render—dengan kontrol yang tetap sederhana.</p>
                  <div className="heroActions"><button className="primary heroPrimary" onClick={()=>setMode('content')}>✨ Mulai dari Ide</button><button className="ghostAction" onClick={newProject}>＋ Project Baru</button></div>
                  <div className="heroTrust"><span>● Private workspace</span><span>● Auto fallback</span><span>● FFmpeg ready</span></div>
                </div>
                <div className="heroVisual" aria-hidden="true">
                  <div className="heroOrb orbA"/><div className="heroOrb orbB"/>
                  <div className="heroWindow"><div className="heroWindowBar"><span/><span/><span/></div><div className="heroWindowBody"><div className="heroChip">AI VIDEO</div><div className="heroTitleLine"/><div className="heroTitleLine short"/><div className="heroProgress"><span/></div><div className="heroThumbs"><i/><i/><i/><i/></div></div></div>
                </div>
              </section>

              <section className="metricRow">
                <div className="metricCard"><span>PLAN</span><strong>{profile?.plan?.toUpperCase()||'FREE'}</strong><small>Current workspace</small></div>
                <div className="metricCard"><span>CREDITS</span><strong>{profile?.credits ?? '—'}</strong><small>Available balance</small></div>
                <div className="metricCard"><span>JOBS</span><strong>{jobs.length}</strong><small>Recent generations</small></div>
                <div className="metricCard"><span>ENGINE</span><strong>FFMPEG</strong><small>Production renderer</small></div>
              </section>

              <div className="sectionTitleLine"><div><div className="eyebrow">QUICK START</div><h2>Choose your workflow</h2></div><span>Fast, focused, production-ready.</span></div>

              <div className="workflowGrid">
                <button className="workflowCard featured" onClick={()=>setMode('content')}><div className="workflowIcon">✦</div><div><small>01 · RECOMMENDED</small><h3>AI Content Studio</h3><p>Ide → script → scenes → timeline → voice → AI video → final render.</p></div><span className="workflowArrow">→</span></button>
                <button className="workflowCard" onClick={()=>{setType('video');document.getElementById('generator-card')?.scrollIntoView({behavior:'smooth'})}}><div className="workflowIcon">▰</div><div><small>02 · FAST</small><h3>Text → Video</h3><p>Generate a video langsung dari visual prompt dengan pengaturan output.</p></div><span className="workflowArrow">→</span></button>
                <button className="workflowCard" onClick={()=>{setType('tts');document.getElementById('generator-card')?.scrollIntoView({behavior:'smooth'})}}><div className="workflowIcon">◉</div><div><small>03 · AUDIO</small><h3>Text → Voice</h3><p>Buat narasi suara dan siapkan aset audio untuk project Anda.</p></div><span className="workflowArrow">→</span></button>
              </div>

              <div id="generator-card" className="generatorGrid">
                <section className="panelCard generatorCard">
                  <div className="panelHeader"><div><div className="eyebrow">QUICK GENERATOR</div><h2>{type==='video'?'Text → Video':'Text → Voice'}</h2></div><span className="panelTag">Beta</span></div>
                  <div className="field"><label>{type==='video'?'Visual prompt':'Teks narasi'}</label><textarea value={prompt} onChange={e=>setPrompt(e.target.value)} placeholder={type==='video'?'Describe your scene in detail...':'Tulis narasi yang ingin dibacakan...'} /></div>
                  {type==='video' ? (
                    <div className="row"><div className="field"><label>Aspect ratio</label><select value={aspectRatio} onChange={e=>setAspectRatio(e.target.value)}><option>16:9</option><option>9:16</option></select></div><div className="field"><label>Output</label><select value={resolution} onChange={e=>setResolution(e.target.value)}><option>1080p</option><option>4K</option></select></div></div>
                  ) : <div className="field"><label>Voice ID <span className="muted">optional</span></label><input value={voice} onChange={e=>setVoice(e.target.value)} placeholder="Gunakan default dari server" /></div>}
                  <div className="generatorBottom"><button className="primary" disabled={loading||!prompt.trim()} onClick={generate}>{loading?'Generating...':type==='video'?'Generate Video':'Generate Suara'}</button><div className="typeToggle"><button className={type==='video'?'active':''} onClick={()=>setType('video')}>Video</button><button className={type==='tts'?'active':''} onClick={()=>setType('tts')}>Voice</button></div></div><div className="muted" style={{marginTop:8}}>Estimasi: <b>{type==='video'?videoCreditCost(resolution):ttsCreditCost(prompt)} credit</b> · Biaya hanya dipotong saat proses dimulai.</div>
                  {message&&<div className={message.includes('berhasil')||message.includes('diproses')?'ok':'error'}>{message}</div>}
                </section>

                <aside className="panelCard outputCard">
                  <div className="panelHeader"><div><div className="eyebrow">OUTPUT</div><h2>Recent generations</h2></div><button className="iconBtn" onClick={load} aria-label="Refresh">↻</button></div>
                  <div className="miniHistory">{jobs.length===0?<div className="empty">Belum ada generasi.</div>:jobs.slice(0,5).map(j=><div className="miniHistoryItem" key={j.id}><div className="miniHistoryIcon">{j.type==='video'?'🎬':'🔊'}</div><div><strong>{j.status}</strong><p>{j.prompt.slice(0,74)}{j.prompt.length>74?'…':''}</p><small>{new Date(j.created_at).toLocaleString('id-ID')}</small></div><span className={`statusBadge ${j.status}`}>{j.status}</span></div>)}</div>
                </aside>
              </div>

              <section className="panelCard historyPanel"><div className="panelHeader"><div><div className="eyebrow">ACTIVITY</div><h2>Generation history</h2></div><button className="tab compact" onClick={()=>setHubMode('queue')}>Open Queue →</button></div><div className="history">{jobs.length===0?<div className="empty">Belum ada generasi.</div>:jobs.map(j=><div className="historyItem" key={j.id}><strong>{j.type==='video'?'🎬':'🔊'} {j.status}</strong><div>{j.prompt.slice(0,150)}{j.prompt.length>150?'…':''}</div><small>{new Date(j.created_at).toLocaleString('id-ID')}</small>{j.error_message&&<div className="error">{j.error_message}</div>}{j.output_url&&<div style={{marginTop:8}}><a href={j.output_url} target="_blank" rel="noreferrer">Buka hasil</a></div>}</div>)}</div></section>
            </div>
          )}
        </main>
      </div>
    </div>
  );
}
