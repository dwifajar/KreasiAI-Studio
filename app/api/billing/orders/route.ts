import { NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { createAdminClient } from '@/lib/supabase/admin';

export async function GET() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const admin = createAdminClient();
  const { data, error } = await admin.from('kai_billing_orders')
    .select('id,plan_id,amount_idr,credits,provider,status,provider_reference,checkout_url,created_at,paid_at')
    .eq('user_id', user.id).order('created_at', { ascending: false }).limit(20);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ orders: data || [] });
}
