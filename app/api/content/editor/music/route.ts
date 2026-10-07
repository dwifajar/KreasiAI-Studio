import { NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { createAdminClient } from '@/lib/supabase/admin';

export const runtime = 'nodejs';

export async function GET(req: Request) {
  try {
    const supabase = await createClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    const url = new URL(req.url);
    const projectId = String(url.searchParams.get('projectId') || '');
    const assetId = String(url.searchParams.get('assetId') || '');
    if (!projectId || !assetId) return NextResponse.json({ error: 'Project dan asset wajib diisi.' }, { status: 400 });
    const admin = createAdminClient();
    const { data: asset, error } = await admin.from('kai_assets').select('id,storage_path,mime_type').eq('id', assetId).eq('project_id', projectId).eq('user_id', user.id).single();
    if (error || !asset) return NextResponse.json({ error: 'Music asset tidak ditemukan.' }, { status: 404 });
    const signed = await admin.storage.from('kai-media').createSignedUrl(asset.storage_path, 60 * 60);
    if (signed.error || !signed.data?.signedUrl) return NextResponse.json({ error: 'URL music tidak tersedia.' }, { status: 500 });
    return NextResponse.json({ ok: true, url: signed.data.signedUrl, mimeType: asset.mime_type });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : 'Music lookup gagal.' }, { status: 500 });
  }
}
