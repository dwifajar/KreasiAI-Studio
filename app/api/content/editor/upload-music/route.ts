import { NextResponse } from 'next/server';
import crypto from 'node:crypto';
import { createClient } from '@/lib/supabase/server';
import { createAdminClient } from '@/lib/supabase/admin';

export const runtime = 'nodejs';

export async function POST(req: Request) {
  try {
    const supabase = await createClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

    const form = await req.formData();
    const projectId = String(form.get('projectId') || '');
    const file = form.get('music');
    if (!projectId || !(file instanceof File)) return NextResponse.json({ error: 'Project dan file audio wajib diisi.' }, { status: 400 });
    if (!file.type.startsWith('audio/')) return NextResponse.json({ error: 'File harus berupa audio.' }, { status: 400 });
    if (file.size > 30 * 1024 * 1024) return NextResponse.json({ error: 'File audio maksimal 30 MB.' }, { status: 400 });

    const admin = createAdminClient();
    const { data: project } = await admin.from('kai_projects').select('id').eq('id', projectId).eq('user_id', user.id).single();
    if (!project) return NextResponse.json({ error: 'Project tidak ditemukan.' }, { status: 404 });

    const safeExt = file.name.includes('.') ? file.name.split('.').pop()!.toLowerCase().replace(/[^a-z0-9]/g, '') : 'audio';
    const storagePath = `${user.id}/projects/${projectId}/music/${crypto.randomUUID()}.${safeExt || 'audio'}`;
    const buffer = Buffer.from(await file.arrayBuffer());
    const upload = await admin.storage.from('kai-media').upload(storagePath, buffer, { contentType: file.type, upsert: true });
    if (upload.error) throw new Error(`Storage music upload: ${upload.error.message}`);

    const asset = await admin.from('kai_assets').insert({
      user_id: user.id,
      project_id: projectId,
      kind: 'audio',
      storage_path: storagePath,
      mime_type: file.type,
      metadata: { provider: 'upload', role: 'background-music', original_name: file.name, size_bytes: file.size },
    }).select().single();
    if (asset.error || !asset.data) throw new Error(`Asset database: ${asset.error?.message || 'Asset tidak tersimpan'}`);

    const signed = await admin.storage.from('kai-media').createSignedUrl(storagePath, 60 * 60);
    if (signed.error || !signed.data?.signedUrl) throw new Error('URL musik tidak tersedia.');

    return NextResponse.json({ ok: true, assetId: asset.data.id, url: signed.data.signedUrl, storagePath });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : 'Upload music gagal.' }, { status: 500 });
  }
}
