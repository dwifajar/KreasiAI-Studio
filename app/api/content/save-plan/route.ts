import { NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { createAdminClient } from '@/lib/supabase/admin';

export async function POST(req: Request) {
  try {
    const supabase = await createClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    const { projectId, plan } = await req.json();
    if (!projectId || !plan?.scenes) return NextResponse.json({ error: 'Project dan plan wajib diisi' }, { status: 400 });
    const admin = createAdminClient();
    const { error } = await admin.from('kai_projects').update({ settings: { content_plan: plan }, updated_at: new Date().toISOString() }).eq('id', projectId).eq('user_id', user.id);
    if (error) throw error;
    return NextResponse.json({ ok: true });
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : 'Gagal menyimpan timeline' }, { status: 500 });
  }
}
