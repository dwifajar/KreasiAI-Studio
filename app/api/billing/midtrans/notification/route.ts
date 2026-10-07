import { NextResponse } from 'next/server';
import { createAdminClient } from '@/lib/supabase/admin';
import { calculateSignatureKey, getMidtransTransactionStatus, getMidtransServerKey, isSuccessfulMidtransStatus, midtransTimestampToIso, safeSignatureEqual } from '@/lib/providers/midtrans';

export const runtime = 'nodejs';

function mapStatus(status: string) {
  switch (status.toLowerCase()) {
    case 'settlement':
    case 'capture': return 'paid';
    case 'pending': return 'pending';
    case 'deny':
    case 'failure': return 'failed';
    case 'cancel': return 'cancelled';
    case 'expire': return 'expired';
    case 'refund': return 'refunded';
    default: return 'pending';
  }
}

export async function POST(req: Request) {
  try {
    const payload = await req.json().catch(() => null) as any;
    if (!payload || typeof payload !== 'object') return NextResponse.json({ error: 'Invalid JSON payload.' }, { status: 400 });

    const orderId = String(payload.order_id || '').trim();
    const statusCode = String(payload.status_code || '').trim();
    const grossAmount = String(payload.gross_amount || '').trim();
    const signatureKey = String(payload.signature_key || '').trim();
    const transactionStatus = String(payload.transaction_status || '').trim().toLowerCase();
    const fraudStatus = payload.fraud_status == null ? '' : String(payload.fraud_status).trim().toLowerCase();
    const transactionId = String(payload.transaction_id || '').trim();
    if (!orderId || !statusCode || !grossAmount || !signatureKey || !transactionStatus) {
      return NextResponse.json({ error: 'Incomplete Midtrans notification.' }, { status: 400 });
    }

    const serverKey = getMidtransServerKey();
    const expected = calculateSignatureKey(orderId, statusCode, grossAmount, serverKey);
    if (!safeSignatureEqual(expected, signatureKey)) {
      return NextResponse.json({ error: 'Invalid signature.' }, { status: 403 });
    }

    // Confirm the current transaction status server-to-server as an additional integrity check.
    const verified = await getMidtransTransactionStatus(orderId);
    if (verified.order_id && String(verified.order_id) !== orderId) {
      return NextResponse.json({ error: 'Midtrans order mismatch.' }, { status: 400 });
    }
    if (verified.gross_amount && Number(verified.gross_amount) !== Number(grossAmount)) {
      return NextResponse.json({ error: 'Gross amount mismatch.' }, { status: 400 });
    }

    const verifiedStatus = String(verified.transaction_status || transactionStatus).toLowerCase();
    const verifiedFraud = verified.fraud_status == null ? fraudStatus : String(verified.fraud_status).toLowerCase();
    const finalStatus = mapStatus(verifiedStatus);
    const success = isSuccessfulMidtransStatus({ transaction_status: verifiedStatus, fraud_status: verifiedFraud });
    const eventId = `${transactionId || orderId}:${verifiedStatus}`;
    const admin = createAdminClient();

    const { data: internalOrder, error: orderError } = await admin.from('kai_billing_orders')
      .select('id,user_id,plan_id,amount_idr,credits,status,provider,provider_reference,paid_at')
      .eq('provider', 'midtrans')
      .eq('provider_reference', orderId)
      .maybeSingle();
    if (orderError) throw orderError;

    if (!internalOrder) {
      await admin.from('kai_billing_events').insert({
        provider: 'midtrans', provider_event_id: eventId, event_type: verifiedStatus, order_id: null,
        payload, processed_at: new Date().toISOString(),
      }).throwOnError();
      return NextResponse.json({ ok: true, ignored: true });
    }

    const { data: result, error: processError } = await admin.rpc('kai_process_midtrans_event', {
      p_provider_event_id: eventId,
      p_event_type: verifiedStatus,
      p_order_id: internalOrder.id,
      p_provider_reference: orderId,
      p_payload: payload,
      p_final_status: finalStatus,
      p_success: success,
      p_transaction_id: transactionId || null,
      p_paid_at: midtransTimestampToIso(verified.settlement_time),
    });
    if (processError) throw processError;

    return NextResponse.json({ ok: true, result: result || null });
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : 'Webhook processing failed.' }, { status: 500 });
  }
}
