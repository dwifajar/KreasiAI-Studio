import { NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { createAdminClient } from '@/lib/supabase/admin';

function configuredAdmin(userId: string) {
  return (process.env.KAI_ADMIN_USER_IDS || '')
    .split(',').map((x: string) => x.trim()).filter(Boolean).includes(userId);
}

export async function GET() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ isAdmin: false }, { status: 401 });

  if (configuredAdmin(user.id)) return NextResponse.json({ isAdmin: true });

  const admin = createAdminClient();
  const { data: profile } = await admin.from('kai_profiles').select('plan').eq('id', user.id).maybeSingle();
  return NextResponse.json({ isAdmin: profile?.plan === 'admin' });
}
