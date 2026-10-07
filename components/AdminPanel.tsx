'use client';
import { useEffect, useState } from 'react';

type Dashboard = {
  stats:{users:number;activeSubscriptions:number;totalOrders:number;paidOrders:number;revenueIdr:number;failedJobs:number;creditsOutstanding:number};
  jobCounts:Record<string,number>; planCounts:Record<string,number>;
  recentOrders:Array<{id:string;user_id:string;plan_id:string;amount_idr:number;credits:number;provider:string;status:string;created_at:string;paid_at:string|null}>;
};

const money=(n:number)=>`Rp ${new Intl.NumberFormat('id-ID').format(n)}`;
const date=(v:string)=>new Date(v).toLocaleString('id-ID',{dateStyle:'medium',timeStyle:'short'});

export default function AdminPanel(){
  const [data,setData]=useState<Dashboard|null>(null);
  const [loading,setLoading]=useState(true);
  const [message,setMessage]=useState('');
  async function load(){
    setLoading(true);
    try{
      const r=await fetch('/api/admin/dashboard'); const d=await r.json();
      if(!r.ok) throw new Error(d.error||'Tidak dapat memuat admin dashboard.');
      setData(d);
    }catch(e){setMessage(e instanceof Error?e.message:'Gagal memuat admin dashboard.')}finally{setLoading(false)}
  }
  useEffect(()=>{load();},[]);
  if(loading) return <section className="adminWorkspace"><div className="card"><div className="empty">Memuat Admin SaaS...</div></div></section>;
  if(!data) return <section className="adminWorkspace"><div className="error">{message||'Admin dashboard tidak tersedia.'}</div></section>;
  return <section className="adminWorkspace">
    <div className="adminHero"><div><div className="eyebrow">SAAS CONTROL CENTER</div><h1>Admin Command Center</h1><p>Pantau pertumbuhan workspace, billing, credit, dan generation jobs dari satu layar.</p></div><button className="tab" onClick={load}>↻ Refresh</button></div>
    <div className="adminStats"><div className="metricCard"><span>USERS</span><strong>{data.stats.users}</strong><small>Registered workspaces</small></div><div className="metricCard"><span>ACTIVE SUBS</span><strong>{data.stats.activeSubscriptions}</strong><small>Active subscriptions</small></div><div className="metricCard"><span>REVENUE</span><strong>{money(data.stats.revenueIdr)}</strong><small>Paid orders loaded</small></div><div className="metricCard"><span>CREDITS</span><strong>{data.stats.creditsOutstanding.toLocaleString('id-ID')}</strong><small>Outstanding balance</small></div></div>
    <div className="adminGrid"><div className="card"><div className="panelHeader"><div><h3>Plan Distribution</h3><p className="muted">Jumlah user per plan.</p></div></div>{Object.keys(data.planCounts).length===0?<div className="empty">Belum ada data plan.</div>:<div className="adminRows">{Object.entries(data.planCounts).map(([plan,count])=><div className="adminRow" key={plan}><strong>{plan.toUpperCase()}</strong><span>{count} user</span></div>)}</div>}</div>
      <div className="card"><div className="panelHeader"><div><h3>Generation Jobs</h3><p className="muted">Snapshot job terbaru.</p></div></div><div className="adminRows">{Object.entries(data.jobCounts).map(([status,count])=><div className="adminRow" key={status}><strong>{status}</strong><span>{count}</span></div>)}{!Object.keys(data.jobCounts).length&&<div className="empty">Belum ada job.</div>}</div><div className="adminAlert">Failed jobs: <b>{data.stats.failedJobs}</b>. Gunakan Render Queue untuk detail job.</div></div></div>
    <div className="card"><div className="panelHeader"><div><h3>Recent Billing Orders</h3><p className="muted">Order terbaru dari workspace.</p></div><span className="badge">Total order: {data.stats.totalOrders}</span></div><div className="adminOrders">{data.recentOrders.map(o=><div className="adminOrder" key={o.id}><div><strong>{o.plan_id.toUpperCase()}</strong><span>{o.user_id.slice(0,8)}…</span></div><div><b>{money(o.amount_idr)}</b><span>{o.credits.toLocaleString('id-ID')} credit</span></div><span className={`statusBadge ${o.status}`}>{o.status}</span><small>{date(o.created_at)}</small></div>)}{!data.recentOrders.length&&<div className="empty">Belum ada order billing.</div>}</div></div>
    <div className="adminFootnote">Payment gateway belum dianggap aktif hanya karena order dibuat. Aktivasi plan/credit produksi harus berasal dari webhook provider yang diverifikasi server-side.</div>
  </section>;
}
