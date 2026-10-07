'use client';
import { useEffect, useState } from 'react';

export default function BillingFinishPage(){
  const [orderId,setOrderId]=useState('');
  const [result,setResult]=useState('');
  const [state,setState]=useState<'loading'|'pending'|'paid'|'failed'>('loading');
  const [detail,setDetail]=useState('Memeriksa status pembayaran...');
  const [data,setData]=useState<any>(null);

  useEffect(()=>{
    const q=new URLSearchParams(window.location.search);
    setOrderId(q.get('order_id')||'');
    setResult(q.get('result')||'');
  },[]);

  useEffect(()=>{
    if(!orderId){setState(result==='error'?'failed':'pending');setDetail('Order pembayaran tidak ditemukan.');return;}
    let timer:number|undefined; let attempts=0;
    const poll=async()=>{
      attempts+=1;
      try{
        const r=await fetch(`/api/billing/orders/${encodeURIComponent(orderId)}`,{cache:'no-store'});
        const d=await r.json(); setData(d);
        if(!r.ok) throw new Error(d.error||'Status order tidak dapat dimuat.');
        const status=d.order?.status;
        if(status==='paid'){setState('paid');setDetail('Pembayaran berhasil. Plan dan credit Anda sudah diaktifkan.');return;}
        if(['failed','cancelled','expired','refunded'].includes(status)){setState('failed');setDetail(`Pembayaran berstatus ${status}.`);return;}
        setState('pending');setDetail('Pembayaran masih menunggu konfirmasi. Halaman akan memeriksa kembali secara otomatis.');
        if(attempts<15) timer=window.setTimeout(poll,2000);
      }catch(e){setState('pending');setDetail(e instanceof Error?e.message:'Gagal memeriksa status pembayaran.');if(attempts<5)timer=window.setTimeout(poll,3000);}
    };
    poll(); return()=>{if(timer)window.clearTimeout(timer)};
  },[orderId,result]);

  const goBilling=()=>{window.location.href='/dashboard?section=billing'};
  return <main className="paymentResultPage"><div className={`paymentResultCard ${state}`}><div className="paymentIcon">{state==='paid'?'✓':state==='failed'?'!':'…'}</div><div className="eyebrow">KREASIAI BILLING</div><h1>{state==='paid'?'Pembayaran Berhasil':state==='failed'?'Pembayaran Tidak Berhasil':'Memeriksa Pembayaran'}</h1><p>{detail}</p>{data?.order&&<div className="paymentFacts"><span>Order <b>{String(data.order.id).slice(0,8)}…</b></span><span>Plan <b>{String(data.order.plan_id).toUpperCase()}</b></span><span>Credit <b>{Number(data.order.credits||0).toLocaleString('id-ID')}</b></span></div>}<button className="primary" onClick={goBilling}>Kembali ke Billing</button></div></main>
}
