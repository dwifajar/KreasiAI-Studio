import { NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { createAdminClient } from '@/lib/supabase/admin';
import { getMidtransTransactionStatus, isSuccessfulMidtransStatus, midtransTimestampToIso } from '@/lib/providers/midtrans';

export const runtime = 'nodejs';

export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const supabase = await createClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    const { id } = await params;
    const admin = createAdminClient();
    const selectFields = 'id,user_id,plan_id,amount_idr,credits,provider,status,provider_reference,checkout_url,created_at,paid_at,updated_at,metadata';
    const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
    const isInternalId = uuidPattern.test(id);

    // Midtrans redirects back with its provider order_id (e.g. KAI-<uuid>),
    // while the internal API normally addresses orders by UUID. Resolve both
    // forms so the payment finish page can reliably load the paid order.
    let query = admin.from('kai_billing_orders')
      .select(selectFields)
      .eq('user_id', user.id);
    query = isInternalId ? query.eq('id', id) : query.eq('provider', 'midtrans').eq('provider_reference', id);

    let { data: order, error } = await query.maybeSingle();
    if (error) throw error;
    if (!order) return NextResponse.json({ error: 'Order tidak ditemukan.' }, { status: 404 });

    let providerStatus: any = null;
    if (order.provider === 'midtrans' && order.provider_reference && order.status === 'pending') {
      try {
        providerStatus = await getMidtransTransactionStatus(order.provider_reference);
        const txStatus = String(providerStatus.transaction_status || '').toLowerCase();
        const terminal = isSuccessfulMidtransStatus(providerStatus) || ['deny','failure','cancel','expire','refund'].includes(txStatus);
        if (terminal) {
          const eventId = `status-api:${String(providerStatus.transaction_id || order.provider_reference)}:${txStatus}`;
          await admin.rpc('kai_process_midtrans_event', {
            p_provider_event_id: eventId,
            p_event_type: txStatus || 'status_check',
            p_order_id: order.id,
            p_provider_reference: order.provider_reference,
            p_payload: { source: 'midtrans_status_api', status: providerStatus },
            p_final_status: isSuccessfulMidtransStatus(providerStatus) ? 'paid' : txStatus === 'expire' ? 'expired' : txStatus === 'cancel' ? 'cancelled' : txStatus === 'refund' ? 'refunded' : 'failed',
            p_success: isSuccessfulMidtransStatus(providerStatus),
            p_transaction_id: providerStatus.transaction_id || null,
            p_paid_at: midtransTimestampToIso(providerStatus.settlement_time),
          });
          const refreshed = await admin.from('kai_billing_orders').select('id,user_id,plan_id,amount_idr,credits,provider,status,provider_reference,checkout_url,created_at,paid_at,updated_at,metadata').eq('id', order.id).maybeSingle();
          if (refreshed.data) order = refreshed.data;
        }
      } catch {}
    }
    const { data: profile } = await admin.from('kai_profiles').select('plan,credits').eq('id', user.id).maybeSingle();
    return NextResponse.json({ order, providerStatus, profile });
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : 'Gagal memuat status order.' }, { status: 500 });
  }
}
