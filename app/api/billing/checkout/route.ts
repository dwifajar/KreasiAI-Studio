import { NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { createAdminClient } from '@/lib/supabase/admin';
import { buildPaymentOrderId, createSnapTransaction } from '@/lib/providers/midtrans';

export const runtime = 'nodejs';

export async function POST(req: Request) {
  try {
    const supabase = await createClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

    const body = await req.json().catch(() => ({}));
    const planId = typeof body.planId === 'string' ? body.planId.trim() : '';
    if (!planId) return NextResponse.json({ error: 'Plan wajib dipilih.' }, { status: 400 });

    const provider = (process.env.KAI_PAYMENT_PROVIDER || '').trim().toLowerCase();
    if (provider !== 'midtrans') {
      return NextResponse.json({ error: 'Payment provider belum diatur ke Midtrans.' }, { status: 503 });
    }

    const admin = createAdminClient();
    const [{ data: plan, error: planError }, { data: profile, error: profileError }] = await Promise.all([
      admin.from('kai_plans').select('id,name,monthly_credits,price_idr,active,features').eq('id', planId).eq('active', true).maybeSingle(),
      admin.from('kai_profiles').select('display_name').eq('id', user.id).maybeSingle(),
    ]);
    if (planError) throw planError;
    if (profileError) throw profileError;
    if (!plan) return NextResponse.json({ error: 'Paket tidak ditemukan atau tidak aktif.' }, { status: 404 });
    if (Number(plan.price_idr) <= 0) return NextResponse.json({ error: 'Paket gratis tidak memerlukan pembayaran.' }, { status: 400 });

    const { data: order, error: orderError } = await admin.from('kai_billing_orders').insert({
      user_id: user.id,
      plan_id: plan.id,
      amount_idr: plan.price_idr,
      credits: plan.monthly_credits,
      provider: 'midtrans',
      status: 'pending',
      metadata: {
        source: 'dashboard',
        billing_mode: process.env.KAI_BILLING_MODE || 'production',
        midtrans: { initialized: false },
      },
    }).select('id,plan_id,amount_idr,credits,provider,status,provider_reference,checkout_url,created_at').single();
    if (orderError) throw orderError;

    const snapOrderId = buildPaymentOrderId(order.id);
    const { error: refError } = await admin.from('kai_billing_orders')
      .update({ provider_reference: snapOrderId, updated_at: new Date().toISOString() })
      .eq('id', order.id);
    if (refError) throw refError;

    try {
      const checkout = await createSnapTransaction({
        orderId: order.id,
        amountIdr: Number(plan.price_idr),
        planId: plan.id,
        planName: plan.name,
        credits: Number(plan.monthly_credits),
        customer: { email: user.email, name: profile?.display_name || user.email },
      });

      const metadata = {
        source: 'dashboard',
        billing_mode: process.env.KAI_BILLING_MODE || 'production',
        midtrans: {
          initialized: true,
          environment: checkout.environment,
          snap_order_id: checkout.snapOrderId,
        },
      };
      const { data: updated, error: updateError } = await admin.from('kai_billing_orders')
        .update({ provider_reference: checkout.snapOrderId, checkout_url: checkout.redirectUrl, metadata, updated_at: new Date().toISOString() })
        .eq('id', order.id)
        .select('id,plan_id,amount_idr,credits,provider,status,provider_reference,checkout_url,created_at').single();
      if (updateError) {
        // The gateway transaction already exists and provider_reference was persisted before the call.
        // Return the checkout URL so the customer can still pay; webhook/status recovery can activate later.
        return NextResponse.json({ configured: true, provider: 'midtrans', persistenceWarning: updateError.message, order: { ...order, provider_reference: checkout.snapOrderId, checkout_url: checkout.redirectUrl }, token: checkout.token, environment: checkout.environment });
      }

      return NextResponse.json({ configured: true, provider: 'midtrans', order: updated, token: checkout.token, environment: checkout.environment });
    } catch (gatewayError) {
      const message = gatewayError instanceof Error ? gatewayError.message : 'Midtrans checkout gagal.';
      await admin.from('kai_billing_orders').update({
        status: 'failed',
        metadata: { source: 'dashboard', gateway_error: message },
        updated_at: new Date().toISOString(),
      }).eq('id', order.id);
      return NextResponse.json({ error: message, orderId: order.id }, { status: 502 });
    }
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : 'Gagal membuat checkout.' }, { status: 500 });
  }
}
