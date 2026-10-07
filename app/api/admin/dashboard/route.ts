import { NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { createAdminClient } from '@/lib/supabase/admin';

async function isAdmin(userId: string) {
  const ids = (process.env.KAI_ADMIN_USER_IDS || '').split(',').map((x: string) => x.trim()).filter(Boolean);
  if (ids.includes(userId)) return true;
  const admin = createAdminClient();
  const { data } = await admin.from('kai_profiles').select('plan').eq('id', userId).maybeSingle();
  return data?.plan === 'admin';
}

export async function GET() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  if (!(await isAdmin(user.id))) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });

  const admin = createAdminClient();
  const [users, subs, orders, paidOrders, jobs, failedJobs, profiles, recentOrders] = await Promise.all([
    admin.from('kai_profiles').select('id', { count: 'exact', head: true }),
    admin.from('kai_subscriptions').select('id', { count: 'exact', head: true }).eq('status', 'active'),
    admin.from('kai_billing_orders').select('id', { count: 'exact', head: true }),
    admin.from('kai_billing_orders').select('amount_idr,plan_id,credits,status,paid_at,created_at').eq('status', 'paid').order('paid_at', { ascending: false }).limit(100),
    admin.from('kai_generation_jobs').select('id,type,status,provider,credits_reserved,created_at', { count: 'exact' }).order('created_at', { ascending: false }).limit(100),
    admin.from('kai_generation_jobs').select('id', { count: 'exact', head: true }).eq('status', 'failed'),
    admin.from('kai_profiles').select('plan,credits'),
    admin.from('kai_billing_orders').select('id,user_id,plan_id,amount_idr,credits,provider,status,created_at,paid_at').order('created_at', { ascending: false }).limit(12),
  ]);

  if (recentOrders.error) return NextResponse.json({ error: recentOrders.error.message }, { status: 500 });
  const revenue = (paidOrders.data || []).reduce((sum: number, row: any) => sum + Number(row.amount_idr || 0), 0);
  const creditsOutstanding = (profiles.data || []).reduce((sum: number, row: any) => sum + Number(row.credits || 0), 0);
  const jobRows = jobs.data || [];
  const counts = jobRows.reduce((acc: Record<string,number>, row: any) => { acc[row.status] = (acc[row.status] || 0) + 1; return acc; }, {});
  const planCounts = (profiles.data || []).reduce((acc: Record<string,number>, row: any) => { acc[row.plan] = (acc[row.plan] || 0) + 1; return acc; }, {});

  return NextResponse.json({
    stats: {
      users: users.count || 0,
      activeSubscriptions: subs.count || 0,
      totalOrders: orders.count || 0,
      paidOrders: paidOrders.data?.length || 0,
      revenueIdr: revenue,
      failedJobs: failedJobs.count || 0,
      creditsOutstanding,
    },
    jobCounts: counts,
    planCounts,
    recentOrders: recentOrders.data || [],
  });
}
