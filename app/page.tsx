'use client';
import {useState} from 'react';
import {createClient} from '@/lib/supabase/browser';

export default function Home(){
  const [email,setEmail]=useState('');
  const [password,setPassword]=useState('');
  const [mode,setMode]=useState<'login'|'signup'>('login');
  const [msg,setMsg]=useState('');
  const [busy,setBusy]=useState(false);
  const supabase=createClient();
  async function submit(){
    setBusy(true);setMsg('Memproses...');
    const result=mode==='login'
      ?await supabase.auth.signInWithPassword({email,password})
      :await supabase.auth.signUp({email,password,options:{emailRedirectTo:`${location.origin}/auth/callback`}});
    if(result.error)setMsg(result.error.message);
    else if(mode==='login')location.href='/dashboard';
    else setMsg('Akun dibuat. Cek email jika verifikasi diaktifkan.');
    setBusy(false);
  }
  return <main className="loginModern">
    <section className="loginVisual">
      <div className="loginNoise"/>
      <div className="loginVisualTop"><div className="sideBrandMark">K</div><span>KreasiAI <b>Studio</b></span></div>
      <div className="loginVisualCopy">
        <div className="eyebrow">AI CREATIVE WORKSPACE</div>
        <h1>From idea to<br/><span>final video.</span></h1>
        <p>Rancang script, pecah menjadi scene, edit timeline, tambahkan voice, lalu render menjadi konten siap publish.</p>
      </div>
      <div className="loginMock">
        <div className="loginMockTop"><span/><span/><span/><small>PROJECT / NEW VIDEO</small></div>
        <div className="loginMockBody"><div className="mockLabel">AI CONTENT STUDIO</div><div className="mockLine big"/><div className="mockLine"/><div className="mockTimeline"><i/><i/><i/><i/></div><div className="mockFooter"><span>Scene 04 / 08</span><span>09:24</span></div></div>
      </div>
      <div className="loginVisualFoot"><span>Private workspace</span><span>FFmpeg production</span><span>Smart provider fallback</span></div>
    </section>

    <section className="loginPanel">
      <div className="loginPanelInner">
        <div className="loginMobileBrand"><div className="sideBrandMark">K</div><span>KreasiAI <b>Studio</b></span></div>
        <div className="loginEyebrow">WELCOME BACK</div>
        <h2>{mode==='login'?'Masuk ke workspace':'Buat workspace baru'}</h2>
        <p className="loginLead">Kelola ide, project, media, render, dan workflow video dari satu tempat.</p>
        <div className="authSwitch"><button className={mode==='login'?'active':''} onClick={()=>{setMode('login');setMsg('')}}>Masuk</button><button className={mode==='signup'?'active':''} onClick={()=>{setMode('signup');setMsg('')}}>Daftar</button></div>
        <div className="loginForm">
          <div className="field"><label>Email</label><input value={email} onChange={e=>setEmail(e.target.value)} type="email" placeholder="nama@email.com" autoComplete="email" /></div>
          <div className="field"><div className="fieldLabelRow"><label>Password</label>{mode==='login'&&<span>Secure sign-in</span>}</div><input value={password} onChange={e=>setPassword(e.target.value)} type="password" placeholder="••••••••" autoComplete={mode==='login'?'current-password':'new-password'} /></div>
          <button className="primary authPrimary" onClick={submit} disabled={busy||!email||!password}>{busy?'Memproses…':mode==='login'?'Masuk ke Studio →':'Buat Akun →'}</button>
          {msg&&<div className={msg.startsWith('Akun')?'ok':'error'}>{msg}</div>}
        </div>
        <div className="loginNotice"><span>✦</span><div><strong>Built for creators</strong><p>Mulai gratis, lalu upgrade ketika workflow Anda sudah siap.</p></div></div>
        <small className="loginCopyright">© KreasiAI Studio · AI Text to Video & Text to Speech</small>
      </div>
    </section>
  </main>
}
