import { NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { createAdminClient } from '@/lib/supabase/admin';
import { getVideoOperation, downloadVideo } from '@/lib/providers/veo';
import { generateLocalVideoClip } from '@/lib/providers/local-video';

export const runtime = 'nodejs';
export const maxDuration = 300;

function message(error: unknown) {
  return error instanceof Error ? error.message : typeof error === 'string' ? error : 'Video job gagal.';
}

function providerUnavailable(raw: string) {
  return /429|RESOURCE_EXHAUSTED|quota_exceeded|quota|billing|payment|required|permission|unauthorized|invalid_api_key|API key|api key|403|401|rate.?limit|temporarily unavailable|deadline exceeded|fetch failed|network/i.test(raw);
}

async function completeLocalFallback(admin: ReturnType<typeof createAdminClient>, job: any, userId: string, reason: string) {
  const settings = (job.settings || {}) as Record<string, any>;
  const duration = ([4, 6, 8] as number[]).includes(Number(settings.videoDurationSeconds)) ? Number(settings.videoDurationSeconds) as 4 | 6 | 8 : 8;
  const resolution = ['720p', '1080p', '4K'].includes(String(settings.resolution)) ? String(settings.resolution) as '720p' | '1080p' | '4K' : '720p';
  const aspectRatio = ['16:9', '9:16'].includes(String(settings.aspectRatio)) ? String(settings.aspectRatio) as '16:9' | '9:16' : '16:9';

  const local = await generateLocalVideoClip({
    prompt: String(job.prompt || 'Local scene preview'),
    camera: String(settings.camera || ''),
    tone: String(settings.tone || ''),
    durationSeconds: duration,
    resolution,
    aspectRatio,
  });

  const projectId = settings.projectId ? String(settings.projectId) : null;
  const sceneNumber = settings.sceneNumber == null ? null : Number(settings.sceneNumber);
  const storagePath = `${userId}${projectId ? `/projects/${projectId}` : ''}/videos/${job.id}-${Date.now()}-fallback.mp4`;
  const upload = await admin.storage.from('kai-media').upload(storagePath, local.buffer, { contentType: 'video/mp4', upsert: true });
  if (upload.error) throw new Error(`Local fallback storage: ${upload.error.message}`);
  const signed = await admin.storage.from('kai-media').createSignedUrl(storagePath, 60 * 60 * 24 * 30);
  if (signed.error || !signed.data?.signedUrl) throw new Error(`Local fallback signed URL: ${signed.error?.message || 'tidak tersedia'}`);

  const asset = await admin.from('kai_assets').insert({
    user_id: userId,
    project_id: projectId,
    kind: 'video',
    storage_path: storagePath,
    mime_type: 'video/mp4',
    metadata: { provider: 'local', model: local.model, jobId: job.id, sceneNumber, aspectRatio, resolution, generatedDurationSeconds: duration, localPreview: true, fallbackReason: reason },
  }).select().single();
  if (asset.error || !asset.data) throw new Error(`Local fallback asset: ${asset.error?.message || 'tidak tersimpan'}`);

  await admin.from('kai_generation_jobs').update({
    provider: 'local',
    provider_operation: null,
    status: 'completed',
    output_url: signed.data.signedUrl,
    output_asset_id: asset.data.id,
    credits_reserved: 0,
    error_message: `Veo tidak tersedia; Smart Fallback menggunakan Local Scene. ${reason}`,
    completed_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
    settings: { ...settings, provider: 'local', model: local.model, fallbackFrom: 'veo', fallbackReason: reason },
  }).eq('id', job.id);

  if (projectId && sceneNumber != null) {
    const { data: project } = await admin.from('kai_projects').select('settings').eq('id', projectId).eq('user_id', userId).single();
    const projectSettings = { ...(project?.settings || {}) } as any;
    const cp = { ...(projectSettings.content_plan || {}) } as any;
    cp.scenes = Array.isArray(cp.scenes) ? cp.scenes.map((scene: any) => Number(scene.scene) === sceneNumber ? {
      ...scene,
      video_url: signed.data.signedUrl,
      video_asset_id: asset.data.id,
      video_job_id: job.id,
      video_provider: 'local',
      video_model: local.model,
      video_duration_seconds: duration,
    } : scene) : cp.scenes;
    projectSettings.content_plan = cp;
    const update = await admin.from('kai_projects').update({ settings: projectSettings, updated_at: new Date().toISOString() }).eq('id', projectId).eq('user_id', userId);
    if (update.error) throw new Error(`Project update: ${update.error.message}`);
  }

  return { id: job.id, status: 'completed', provider: 'local', model: local.model, output_url: signed.data.signedUrl, assetId: asset.data.id, sceneNumber, durationSeconds: duration, fallback: true };
}

export async function GET(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const { id } = await ctx.params;
  const admin = createAdminClient();
  const { data: job, error } = await admin.from('kai_generation_jobs').select('*').eq('id', id).eq('user_id', user.id).single();
  if (error || !job) return NextResponse.json({ error: 'Job tidak ditemukan.' }, { status: 404 });
  if (job.type !== 'video' || job.status !== 'processing') return NextResponse.json(job);

  const provider = String(job.provider || 'veo');
  if (provider === 'local') return NextResponse.json(job);
  if (provider !== 'veo') return NextResponse.json({ ...job, status: 'failed', error_message: `Provider '${provider}' belum didukung oleh poller.` }, { status: 400 });

  const settings = (job.settings || {}) as Record<string, any>;
  const operationName = String(settings.operationName || (job.provider_operation as any)?.name || '');
  if (!operationName) return NextResponse.json({ error: 'Operation Veo belum tersimpan.' }, { status: 500 });
  const smart = String(settings.requestedProvider || '') === 'smart';

  try {
    const operation: any = await getVideoOperation(operationName);
    if (!operation?.done) {
      return NextResponse.json({ id: job.id, status: 'processing', provider: 'veo', model: settings.model || null, elapsed_seconds: Math.max(0, Math.floor((Date.now() - new Date(job.created_at).getTime()) / 1000)) });
    }

    if (operation.error) {
      const raw = JSON.stringify(operation.error);
      if (smart && providerUnavailable(raw)) {
        const refund = Number(job.credits_reserved || 0);
        if (refund > 0) await admin.rpc('kai_refund_credits', { p_user_id: user.id, p_amount: refund, p_reason: 'smart_poll_fallback', p_job_id: job.id });
        const result = await completeLocalFallback(admin, { ...job, settings }, user.id, raw);
        return NextResponse.json(result);
      }
      const msg = raw;
      await admin.from('kai_generation_jobs').update({ status: 'failed', error_message: msg, credits_reserved: 0, updated_at: new Date().toISOString() }).eq('id', job.id);
      if (Number(job.credits_reserved || 0) > 0) await admin.rpc('kai_refund_credits', { p_user_id: user.id, p_amount: Number(job.credits_reserved), p_reason: 'veo_operation_failed', p_job_id: job.id });
      return NextResponse.json({ ...job, status: 'failed', error_message: msg });
    }

    const generated = operation.response?.generatedVideos?.[0] || operation.response?.generated_videos?.[0];
    const video = generated?.video || generated?.videoFile || generated;
    if (!video) throw new Error('Veo selesai tetapi file video tidak ditemukan pada response.');

    const buffer = await downloadVideo(video);
    const projectId = settings.projectId as string | null;
    const sceneNumber = settings.sceneNumber == null ? null : Number(settings.sceneNumber);
    const base = `${job.id}-${Date.now()}`;
    const storagePath = `${user.id}${projectId ? `/projects/${projectId}` : ''}/videos/${base}.mp4`;
    const up = await admin.storage.from('kai-media').upload(storagePath, buffer, { contentType: 'video/mp4', upsert: true });
    if (up.error) throw new Error(`Storage upload: ${up.error.message}`);
    const signed = await admin.storage.from('kai-media').createSignedUrl(storagePath, 60 * 60 * 24 * 30);
    if (signed.error || !signed.data?.signedUrl) throw new Error(`Signed URL: ${signed.error?.message || 'tidak tersedia'}`);

    const asset = await admin.from('kai_assets').insert({ user_id: user.id, project_id: projectId, kind: 'video', storage_path: storagePath, mime_type: 'video/mp4', metadata: { provider: 'veo', model: settings.model || null, jobId: job.id, sceneNumber, aspectRatio: settings.aspectRatio || null, resolution: settings.resolution || null, generatedDurationSeconds: settings.videoDurationSeconds || null, sceneDurationSeconds: settings.sceneDuration || null, nativeAudio: true, settings } }).select().single();
    if (asset.error || !asset.data) throw new Error(`Asset database: ${asset.error?.message || 'tidak tersimpan'}`);

    await admin.from('kai_generation_jobs').update({ status: 'completed', output_url: signed.data.signedUrl, output_asset_id: asset.data.id, credits_reserved: 0, completed_at: new Date().toISOString(), updated_at: new Date().toISOString() }).eq('id', job.id);

    if (projectId && sceneNumber != null) {
      const { data: project } = await admin.from('kai_projects').select('settings').eq('id', projectId).eq('user_id', user.id).single();
      const projectSettings = { ...(project?.settings || {}) } as any;
      const cp = { ...(projectSettings.content_plan || {}) } as any;
      cp.scenes = Array.isArray(cp.scenes) ? cp.scenes.map((s: any) => Number(s.scene) === sceneNumber ? { ...s, video_url: signed.data.signedUrl, video_asset_id: asset.data.id, video_job_id: job.id, video_provider: 'veo', video_model: settings.model || null, video_duration_seconds: settings.videoDurationSeconds || null } : s) : cp.scenes;
      projectSettings.content_plan = cp;
      await admin.from('kai_projects').update({ settings: projectSettings, updated_at: new Date().toISOString() }).eq('id', projectId).eq('user_id', user.id);
    }

    return NextResponse.json({ id: job.id, status: 'completed', provider: 'veo', model: settings.model || null, output_url: signed.data.signedUrl, assetId: asset.data.id, sceneNumber, durationSeconds: settings.videoDurationSeconds || null });
  } catch (error) {
    const raw = message(error);
    if (smart && providerUnavailable(raw)) {
      try {
        const refund = Number(job.credits_reserved || 0);
        if (refund > 0) await admin.rpc('kai_refund_credits', { p_user_id: user.id, p_amount: refund, p_reason: 'smart_poll_exception_fallback', p_job_id: job.id });
        const result = await completeLocalFallback(admin, { ...job, settings }, user.id, raw);
        return NextResponse.json(result);
      } catch (fallbackError) {
        const fallbackMessage = message(fallbackError);
        await admin.from('kai_generation_jobs').update({ status: 'failed', error_message: `Veo gagal: ${raw} | Local fallback gagal: ${fallbackMessage}`, credits_reserved: 0, updated_at: new Date().toISOString() }).eq('id', job.id);
        return NextResponse.json({ id: job.id, status: 'failed', error_message: fallbackMessage }, { status: 502 });
      }
    }
    await admin.from('kai_generation_jobs').update({ status: 'failed', error_message: raw, credits_reserved: 0, updated_at: new Date().toISOString() }).eq('id', job.id);
    if (Number(job.credits_reserved || 0) > 0) await admin.rpc('kai_refund_credits', { p_user_id: user.id, p_amount: Number(job.credits_reserved), p_reason: 'veo_poll_failed', p_job_id: job.id });
    return NextResponse.json({ id: job.id, status: 'failed', error_message: raw }, { status: 502 });
  }
}
