'use client';
import { useEffect, useMemo, useState } from 'react';
import { createClient } from '@/lib/supabase/browser';
import { productionRenderCreditCost, ttsCreditCost, videoCreditCost } from '@/lib/kai';

type Project = { id:string; name:string; description:string|null; settings:any; created_at:string; updated_at:string };
type Asset = { id:string; project_id:string|null; kind:string; storage_path:string; mime_type:string|null; metadata:any; created_at:string; url?:string|null };
type Job = { id:string; project_id:string|null; type:string; provider:string|null; prompt:string; status:string; output_url:string|null; error_message:string|null; created_at:string; completed_at:string|null; settings:any };
type Plan = { id:string; name:string; monthly_credits:number; price_idr:number; features:any; active:boolean };
type Profile = { credits:number; plan:string };
type Subscription = { id:string; plan_id:string; provider:string|null; status:string; current_period_end:string|null; created_at:string };
type BillingOrder = { id:string; plan_id:string; amount_idr:number; credits:number; provider:string; status:string; provider_reference?:string|null; checkout_url?:string|null; created_at:string; paid_at:string|null };
type Ledger = { id:string; amount:number; reason:string; created_at:string; job_id:string|null };

function formatDate(v:string){ try{return new Date(v).toLocaleString('id-ID',{dateStyle:'medium',timeStyle:'short'})}catch{return v} }
function formatBytes(n:number){ if(!Number.isFinite(n)||n<=0)return '—'; const u=['B','KB','MB','GB']; let i=0,x=n; while(x>=1024&&i<u.length-1){x/=1024;i++;} return `${x.toFixed(x>=10||i===0?0:1)} ${u[i]}` }
function formatPrice(v:number){return v===0?'Gratis':`Rp ${new Intl.NumberFormat('id-ID').format(v)}/bulan`}

export default function ProjectHub({section,onOpenProject,onNewProject}:{section:'projects'|'media'|'queue'|'billing';onOpenProject:(id:string)=>void;onNewProject:()=>void}){
  const supabase=createClient();
  const [projects,setProjects]=useState<Project[]>([]);
  const [assets,setAssets]=useState<Asset[]>([]);
  const [jobs,setJobs]=useState<Job[]>([]);
  const [profile,setProfile]=useState<Profile|null>(null);
  const [plans,setPlans]=useState<Plan[]>([]);
  const [subscription,setSubscription]=useState<Subscription|null>(null);
  const [ledger,setLedger]=useState<Ledger[]>([]);
  const [orders,setOrders]=useState<BillingOrder[]>([]);
  const [checkoutBusy,setCheckoutBusy]=useState<string|null>(null);
  const [busy,setBusy]=useState(true);
  const [message,setMessage]=useState('');
  const [search,setSearch]=useState('');
  const [assetFilter,setAssetFilter]=useState('all');
  const [refreshing,setRefreshing]=useState(false);

  async function loadAll(){
    setRefreshing(true);
    try{
      const [p,a,j,pr,pl,s,l,o]=await Promise.all([
        supabase.from('kai_projects').select('id,name,description,settings,created_at,updated_at').order('updated_at',{ascending:false}),
        supabase.from('kai_assets').select('id,project_id,kind,storage_path,mime_type,metadata,created_at').order('created_at',{ascending:false}).limit(80),
        supabase.from('kai_generation_jobs').select('id,project_id,type,provider,prompt,status,output_url,error_message,created_at,completed_at,settings').order('created_at',{ascending:false}).limit(80),
        supabase.from('kai_profiles').select('credits,plan').single(),
        supabase.from('kai_plans').select('id,name,monthly_credits,price_idr,features,active').eq('active',true).order('price_idr',{ascending:true}),
        supabase.from('kai_subscriptions').select('id,plan_id,provider,status,current_period_end,created_at').order('created_at',{ascending:false}).limit(1).maybeSingle(),
        supabase.from('kai_credit_ledger').select('id,amount,reason,created_at,job_id').order('created_at',{ascending:false}).limit(20),
        supabase.from('kai_billing_orders').select('id,plan_id,amount_idr,credits,provider,status,provider_reference,checkout_url,created_at,paid_at').order('created_at',{ascending:false}).limit(20),
      ]);
      if(p.error) throw p.error; if(a.error) throw a.error; if(j.error) throw j.error;
      setProjects(p.data||[]); setAssets(a.data||[]); setJobs(j.data||[]); setProfile(pr.data||null); setPlans(pl.data||[]); setSubscription(s.data||null); setLedger(l.data||[]); setOrders(o.data||[]);
    }catch(e){setMessage(e instanceof Error?e.message:'Gagal memuat data workspace.')}finally{setBusy(false);setRefreshing(false)}
  }

  useEffect(()=>{loadAll();},[section]);
  useEffect(()=>{
    const active=jobs.some(j=>j.status==='processing'||j.status==='queued');
    if(!active || (section!=='queue' && section!=='projects')) return;
    const t=window.setInterval(loadAll,8000); return()=>window.clearInterval(t);
  },[jobs,section]);

  const filteredProjects=useMemo(()=>projects.filter(p=>{
    const q=search.trim().toLowerCase(); if(!q)return true; return p.name.toLowerCase().includes(q)||(p.description||'').toLowerCase().includes(q);
  }),[projects,search]);
  const filteredAssets=useMemo(()=>assets.filter(a=>assetFilter==='all'||a.kind===assetFilter),[assets,assetFilter]);
  const jobCounts=useMemo(()=>({total:jobs.length,processing:jobs.filter(j=>j.status==='processing'||j.status==='queued').length,done:jobs.filter(j=>j.status==='completed').length,failed:jobs.filter(j=>j.status==='failed').length}),[jobs]);

  async function renameProject(p:Project){
    const name=window.prompt('Nama project baru',p.name)?.trim(); if(!name||name===p.name)return;
    const {error}=await supabase.from('kai_projects').update({name,updated_at:new Date().toISOString()}).eq('id',p.id); if(error)setMessage(error.message); else await loadAll();
  }
  async function duplicateProject(p:Project){
    const {data:userData}=await supabase.auth.getUser();
    const userId=userData.user?.id;
    if(!userId){setMessage('Sesi login tidak ditemukan.');return;}
    const copy=await supabase.from('kai_projects').insert({user_id:userId,name:`${p.name} Copy`,description:p.description,settings:p.settings}).select('id').single();
    if(copy.error){setMessage(copy.error.message);return;} await loadAll(); onOpenProject(copy.data.id);
  }
  async function deleteProject(p:Project){
    if(!window.confirm(`Hapus project “${p.name}”? Asset dan job yang terkait di database juga akan ikut dibersihkan.`))return;
    setMessage('Menghapus project...');
    try{const r=await fetch('/api/projects/delete',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({projectId:p.id})});const d=await r.json().catch(()=>({}));if(!r.ok)throw new Error(d.error||'Gagal menghapus project.');setMessage('✓ Project berhasil dihapus.');await loadAll();}catch(e){setMessage(e instanceof Error?e.message:'Gagal menghapus project.')}
  }

  async function requestCheckout(planId:string){
    setCheckoutBusy(planId); setMessage('Menyiapkan checkout...');
    try{
      const r=await fetch('/api/billing/checkout',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({planId})});
      const d=await r.json().catch(()=>({}));
      if(!r.ok) throw new Error(d.error||'Gagal membuat checkout.');
      if(d.order?.checkout_url) window.location.href=d.order.checkout_url;
      else setMessage(d.message||'Checkout belum tersedia.');
      await loadAll();
    }catch(e){setMessage(e instanceof Error?e.message:'Gagal membuat checkout.')}finally{setCheckoutBusy(null)}
  }

  async function loadSignedUrls(){
    const list=assets.slice(0,80); const withUrls:Asset[]=[];
    for(const a of list){
      if(a.kind==='subtitle' || a.kind==='other'){ withUrls.push({...a,url:null}); continue; }
      const signed=await supabase.storage.from('kai-media').createSignedUrl(a.storage_path,60*60);
      withUrls.push({...a,url:signed.data?.signedUrl||null});
    }
    setAssets(withUrls);
  }
  useEffect(()=>{ if(section==='media' && assets.length && !assets.some(a=>a.url!==undefined)) loadSignedUrls(); },[section,assets]);

  const title=section==='projects'?'Project Dashboard':section==='media'?'Media Library':section==='queue'?'Render Queue':'Paket & Billing';
  const subtitle=section==='projects'?'Kelola project, buka kembali editor, duplicate, rename, dan hapus project.':section==='media'?'Semua video, audio, gambar, subtitle, dan hasil render dari workspace Anda.':section==='queue'?'Pantau job generasi dan render tanpa harus menunggu di satu halaman.':'Lihat paket, credit, status subscription, dan order pembayaran. Checkout aman; plan tidak berubah sebelum provider mengonfirmasi pembayaran.';

  return <section className="hub">
    <div className="contentHead"><div><h2>{title}</h2><p>{subtitle}</p></div><div className="hubActions"><button className="tab" onClick={loadAll} disabled={refreshing}>↻ {refreshing?'Memuat...':'Refresh'}</button>{section==='projects'&&<button className="primary compact" onClick={onNewProject}>＋ Project Baru</button>}</div></div>
    {message&&<div className={message.includes('✓')?'ok':'error'}>{message}</div>}
    {busy?<div className="card"><div className="empty">Memuat workspace...</div></div>:<>
      {section==='projects'&&<>
        <div className="hubStats"><div className="hubStat"><span>Project</span><strong>{projects.length}</strong></div><div className="hubStat"><span>Credit</span><strong>{profile?.credits??'—'}</strong></div><div className="hubStat"><span>Job Aktif</span><strong>{jobCounts.processing}</strong></div><div className="hubStat"><span>Render Selesai</span><strong>{jobCounts.done}</strong></div></div>
        <div className="card"><div className="toolbarLine"><div className="field searchField"><label>Cari project</label><input value={search} onChange={e=>setSearch(e.target.value)} placeholder="Nama atau deskripsi..."/></div></div>
          {filteredProjects.length===0?<div className="empty">Belum ada project. Klik <b>＋ Project Baru</b> untuk mulai.</div>:<div className="projectGrid">{filteredProjects.map(p=>{const plan=p.settings?.content_plan||{};const scenes=Array.isArray(plan.scenes)?plan.scenes.length:0;const render=plan.production_render;return <article className="projectCard" key={p.id}>
            <div className="projectThumb"><span>KREASIAI</span><strong>{String(plan.title||p.name).slice(0,58)}</strong><small>{scenes?`${scenes} scene`:'Belum ada scene'} • {plan.platform||'Studio'}</small></div>
            <div className="projectBody"><div className="projectName"><strong>{p.name}</strong><button className="iconBtn" title="Rename" onClick={()=>renameProject(p)}>✏️</button></div><p>{p.description||'Tanpa deskripsi.'}</p><div className="projectMeta"><span>Diperbarui {formatDate(p.updated_at)}</span>{render?.resolution&&<span>{render.resolution}</span>}</div><div className="projectActions"><button className="primary compact" onClick={()=>onOpenProject(p.id)}>Buka Editor</button><button className="tab compact" onClick={()=>duplicateProject(p)}>Duplicate</button><button className="tab compact dangerBtn" onClick={()=>deleteProject(p)}>Hapus</button></div></div>
          </article>})}</div>}
        </div>
      </>}

      {section==='media'&&<div className="card"><div className="mediaToolbar"><div><strong>{assets.length} asset</strong><span className="muted"> • Maks. 80 terbaru</span></div><select value={assetFilter} onChange={e=>setAssetFilter(e.target.value)}><option value="all">Semua tipe</option><option value="video">Video</option><option value="audio">Audio</option><option value="image">Gambar</option><option value="subtitle">Subtitle</option><option value="other">Lainnya</option></select></div>{filteredAssets.length===0?<div className="empty">Belum ada asset di library.</div>:<div className="assetGrid">{filteredAssets.map(a=><article className="assetCard" key={a.id}><div className="assetPreview">{a.kind==='video'&&a.url?<video controls preload="metadata" src={a.url}/>:a.kind==='audio'&&a.url?<audio controls preload="none" src={a.url}/>:a.kind==='image'&&a.url?<img src={a.url} alt={a.id}/>:<div className="assetPlaceholder">{a.kind==='subtitle'?'🔤':a.kind==='audio'?'🔊':a.kind==='video'?'🎬':a.kind==='image'?'🖼️':'📦'}</div>}</div><div className="assetBody"><strong>{a.kind.toUpperCase()}</strong><span>{a.mime_type||'Asset'}</span><small>{formatBytes(Number(a.metadata?.size||0))} • {formatDate(a.created_at)}</small>{a.url?<a href={a.url} target="_blank" rel="noreferrer" className="tab compact">Buka / Unduh</a>:<span className="muted">Path private</span>}</div></article>)}</div>}</div>}

      {section==='queue'&&<div className="card"><div className="queueHeader"><div><strong>{jobs.length} job terbaru</strong><p className="muted">Job processing/queued diperbarui otomatis setiap 8 detik.</p></div><div className="queueCounts"><span>Aktif {jobCounts.processing}</span><span>Selesai {jobCounts.done}</span><span>Gagal {jobCounts.failed}</span></div></div>{jobs.length===0?<div className="empty">Belum ada job.</div>:<div className="queueList">{jobs.map(j=><article className="queueItem" key={j.id}><div className={`statusDot ${j.status}`}></div><div className="queueMain"><div className="queueTitle"><strong>{j.type==='render'?'🎞️':j.type==='video'?'🎬':j.type==='tts'?'🔊':'⚙️'} {j.type.toUpperCase()}</strong><span>{j.provider||'local'}</span><span>{j.status}</span></div><p>{j.prompt.slice(0,180)}{j.prompt.length>180?'…':''}</p><small>Dibuat {formatDate(j.created_at)}{j.completed_at?` • selesai ${formatDate(j.completed_at)}`:''}</small>{j.error_message&&<div className="error">{j.error_message}</div>}{j.output_url&&<a href={j.output_url} target="_blank" rel="noreferrer" className="tab compact">Buka hasil</a>}</div></article>)}</div>}</div>}

      {section==='billing'&&<><div className="billingTop"><div className="card currentPlan"><span>Plan saat ini</span><strong>{profile?.plan?.toUpperCase()||'FREE'}</strong><small>{profile?.credits??0} credit tersisa</small>{subscription&&<small>Status: {subscription.status}{subscription.current_period_end?` • sampai ${formatDate(subscription.current_period_end)}`:''}</small>}</div><div className="card billingNote"><strong>Midtrans Checkout</strong><p>Pembayaran dibuka lewat halaman checkout Midtrans. Plan dan credit <b>tidak</b> berubah saat checkout dibuat; aktivasi hanya dilakukan setelah webhook pembayaran diverifikasi server-side.</p><span className="badge">Provider: MIDTRANS • Environment di server</span></div></div>
        <div className="card creditPolicyCard"><div className="panelHeader"><div><h3>Credit Usage</h3><p className="muted">Biaya dihitung server-side sebelum proses berjalan. Job gagal otomatis refund.</p></div><span className="badge">Metered</span></div><div className="hubStats"><div className="hubStat"><span>Saldo</span><strong>{profile?.credits??0}</strong><small>credit tersedia</small></div><div className="hubStat"><span>Text → Voice</span><strong>≥ 1</strong><small>per 1.200 karakter</small></div><div className="hubStat"><span>AI Video</span><strong>{videoCreditCost('1080p')}</strong><small>per clip 720/1080p</small></div><div className="hubStat"><span>Render 30s</span><strong>{productionRenderCreditCost('1080p',30)}</strong><small>1080p / 30 detik</small></div></div><div className="featureList"><span>• AI Video 4K: {videoCreditCost('4K')} credit / clip</span><span>• Render 4K 30 detik: {productionRenderCreditCost('4K',30)} credit</span><span>• TTS: {ttsCreditCost('a'.repeat(1200))} credit / ±1.200 karakter</span></div></div><div className="pricingGrid">{plans.map(pl=><article className={`pricingCard ${profile?.plan===pl.id?'current':''}`} key={pl.id}><div className="pricingHead"><span>{pl.name}</span>{profile?.plan===pl.id&&<b>Aktif</b>}</div><strong>{formatPrice(pl.price_idr)}</strong><small>{pl.monthly_credits.toLocaleString('id-ID')} credit / bulan</small><div className="featureList">{Object.entries(pl.features||{}).slice(0,6).map(([k,v])=><span key={k}>✓ {String(v)}</span>)}</div>{pl.price_idr===0?<button className="tab" disabled>Gratis</button>:<button className="primary" disabled={checkoutBusy===pl.id} onClick={()=>requestCheckout(pl.id)}>{checkoutBusy===pl.id?'Menyiapkan...':profile?.plan===pl.id?'Perpanjang / Beli Lagi':'Bayar via Midtrans'}</button>}</article>)}</div>
        <div className="billingGrid"><div className="card"><div className="panelHeader"><div><h3>Order Pembayaran</h3><p className="muted">Order terbaru Anda dan status aktivasi otomatis.</p></div></div>{orders.length===0?<div className="empty">Belum ada order.</div>:<div className="ledgerList">{orders.map(o=><div className="ledgerItem" key={o.id}><span className={`statusBadge ${o.status}`}>{o.status}</span><strong>{o.plan_id.toUpperCase()} • Rp {new Intl.NumberFormat('id-ID').format(o.amount_idr)}</strong><small>{o.credits.toLocaleString('id-ID')} credit • {formatDate(o.created_at)}{o.paid_at?` • paid ${formatDate(o.paid_at)}`:''}</small>{o.status==='pending'&&o.checkout_url&&<a className="tab compact" href={o.checkout_url}>Lanjut Bayar</a>}</div>)}</div>}</div>
        <div className="card"><h3>Riwayat Credit</h3>{ledger.length===0?<div className="empty">Belum ada transaksi credit.</div>:<div className="ledgerList">{ledger.map(x=><div className="ledgerItem" key={x.id}><span className={x.amount>=0?'creditPlus':'creditMinus'}>{x.amount>=0?'+':''}{x.amount}</span><strong>{x.reason}</strong><small>{formatDate(x.created_at)}</small></div>)}</div>}</div></div>
      </>}
    </>}</section>
}
