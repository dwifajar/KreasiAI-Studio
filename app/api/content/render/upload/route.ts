import { NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { createAdminClient } from '@/lib/supabase/admin';

export const runtime = 'nodejs';
export const maxDuration = 60;

export async function POST(req: Request) {
  try {
    const supabase = await createClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

    const form = await req.formData();
    const projectId = String(form.get('projectId') || '');
    const resolution = String(form.get('resolution') || '1080p');
    const format = String(form.get('format') || 'webm');
    const durationSeconds = Number(form.get('durationSeconds') || 0);
    const file = form.get('render');

    if (!projectId) return NextResponse.json({ error: 'Project wajib diisi.' }, { status: 400 });
    if (!(file instanceof File)) return NextResponse.json({ error: 'File render tidak ditemukan.' }, { status: 400 });
    if (!['720p', '1080p', '4K'].includes(resolution)) return NextResponse.json({ error: 'Resolusi tidak valid.' }, { status: 400 });
    if (!['webm', 'mp4'].includes(format)) return NextResponse.json({ error: 'Format video tidak valid.' }, { status: 400 });
    if (file.size > 200 * 1024 * 1024) return NextResponse.json({ error: 'File render terlalu besar. Batas upload Phase 5 adalah 200 MB.' }, { status: 413 });

    const admin = createAdminClient();
    const { data: project, error: projectError } = await admin.from('kai_projects').select('id,settings').eq('id', projectId).eq('user_id', user.id).single();
    if (projectError || !project) return NextResponse.json({ error: 'Project tidak ditemukan.' }, { status: 404 });

    const ext = format === 'mp4' ? 'mp4' : 'webm';
    const mime = format === 'mp4' ? 'video/mp4' : 'video/webm';
    const token = crypto.randomUUID();
    const path = `${user.id}/projects/${projectId}/renders/${token}.${ext}`;
    const buffer = Buffer.from(await file.arrayBuffer());
    const upload = await admin.storage.from('kai-media').upload(path, buffer, { contentType: mime, upsert: true });
    if (upload.error) throw new Error(`Storage upload: ${upload.error.message}`);

    const signed = await admin.storage.from('kai-media').createSignedUrl(path, 60 * 60 * 24 * 30);
    if (signed.error || !signed.data?.signedUrl) throw new Error(`Storage signed URL: ${signed.error?.message || 'URL tidak tersedia'}`);

    const asset = await admin.from('kai_assets').insert({
      user_id: user.id,
      project_id: projectId,
      kind: 'video',
      storage_path: path,
      mime_type: mime,
      metadata: { provider: 'browser-render', resolution, format, duration_seconds: durationSeconds },
    }).select().single();
    if (asset.error || !asset.data) throw new Error(`Asset database: ${asset.error?.message || 'Asset tidak tersimpan'}`);

    const job = await admin.from('kai_generation_jobs').insert({
      user_id: user.id,
      project_id: projectId,
      type: 'render',
      provider: 'browser-render',
      prompt: 'Final video composition from content plan',
      status: 'completed',
      output_url: signed.data.signedUrl,
      output_asset_id: asset.data.id,
      credits_reserved: 0,
      settings: { resolution, format, durationSeconds, assetId: asset.data.id },
      started_at: new Date().toISOString(),
      completed_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    }).select().single();
    if (job.error) throw new Error(`Render job database: ${job.error.message}`);

    const settings = { ...(project.settings || {}) };
    const contentPlan = { ...(settings.content_plan || {}) };
    contentPlan.render = {
      asset_id: asset.data.id,
      job_id: job.data?.id || null,
      url: signed.data.signedUrl,
      storage_path: path,
      resolution,
      format,
      duration_seconds: durationSeconds,
      created_at: new Date().toISOString(),
    };
    settings.content_plan = contentPlan;
    const update = await admin.from('kai_projects').update({ settings, updated_at: new Date().toISOString() }).eq('id', projectId).eq('user_id', user.id);
    if (update.error) throw new Error(`Project update: ${update.error.message}`);

    return NextResponse.json({ ok: true, url: signed.data.signedUrl, assetId: asset.data.id, jobId: job.data?.id || null, format, resolution });
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : 'Gagal menyimpan render.' }, { status: 500 });
  }
}
