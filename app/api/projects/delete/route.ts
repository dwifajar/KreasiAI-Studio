import { NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { createAdminClient } from '@/lib/supabase/admin';

export const runtime = 'nodejs';

export async function POST(req: Request) {
  try {
    const supabase = await createClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    const body = await req.json().catch(() => ({}));
    const projectId = String(body.projectId || '').trim();
    if (!projectId) return NextResponse.json({ error: 'Project wajib diisi.' }, { status: 400 });

    const admin = createAdminClient();
    const { data: project, error: projectError } = await admin.from('kai_projects').select('id').eq('id', projectId).eq('user_id', user.id).single();
    if (projectError || !project) return NextResponse.json({ error: 'Project tidak ditemukan.' }, { status: 404 });

    const { data: assets, error: assetError } = await admin.from('kai_assets').select('storage_path').eq('project_id', projectId).eq('user_id', user.id);
    if (assetError) throw new Error(`Asset lookup: ${assetError.message}`);
    const paths = (assets || []).map(a => String(a.storage_path)).filter(Boolean);
    if (paths.length) {
      const { error: storageError } = await admin.storage.from('kai-media').remove(paths);
      if (storageError) throw new Error(`Storage cleanup: ${storageError.message}`);
    }

    const { error: deleteError } = await admin.from('kai_projects').delete().eq('id', projectId).eq('user_id', user.id);
    if (deleteError) throw new Error(`Project delete: ${deleteError.message}`);
    return NextResponse.json({ ok: true, removedAssets: paths.length });
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : 'Gagal menghapus project.' }, { status: 500 });
  }
}
