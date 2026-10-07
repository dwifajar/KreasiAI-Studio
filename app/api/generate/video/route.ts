import { NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { createAdminClient } from '@/lib/supabase/admin';
import { chooseVeoDuration, getVeoModel, startVideoGeneration } from '@/lib/providers/veo';
import { generateLocalVideoClip } from '@/lib/providers/local-video';
import { defaultVideoProvider } from '@/lib/providers/video';
import { videoCreditCost } from '@/lib/kai';

export const runtime = 'nodejs';
export const maxDuration = 300;

function errorMessage(error: unknown) {
  return error instanceof Error ? error.message : typeof error === 'string' ? error : 'Gagal memulai video.';
}

function isProviderUnavailable(message: string) {
  return /429|RESOURCE_EXHAUSTED|quota_exceeded|quota|billing|payment|required|permission|unauthorized|invalid_api_key|API key|api key|403|401|rate.?limit|temporarily unavailable|deadline exceeded|fetch failed|network/i.test(message);
}

function friendlyVeoError(message: string) {
  if (/429|RESOURCE_EXHAUSTED|quota_exceeded|quota/i.test(message)) return `Quota Google/Veo tidak mencukupi. ${message}`;
  if (/401|403|API key|api key|permission|invalid_api_key/i.test(message)) return `Akses Google/Veo ditolak. ${message}`;
  return message;
}

function buildPrompt(prompt: string, camera?: string, tone?: string) {
  return [
    'Create a single high-quality cinematic video shot.',
    `Visual direction: ${prompt}`,
    camera ? `Camera: ${camera}.` : '',
    tone ? `Style: ${tone}.` : 'Style: cinematic realism.',
    'Natural motion, physically plausible lighting, coherent subject continuity, clean composition, no on-screen text unless explicitly requested.',
  ].filter(Boolean).join(' ');
}

async function persistVideo(args: {
  admin: ReturnType<typeof createAdminClient>;
  userId: string;
  projectId: string | null;
  sceneNumber: number | null;
  jobId: string;
  buffer: Buffer;
  provider: string;
  model: string;
  durationSeconds: number;
  resolution: string;
  aspectRatio: string;
  metadata?: Record<string, unknown>;
}) {
  const { admin, userId, projectId, sceneNumber, jobId, buffer, provider, model, durationSeconds, resolution, aspectRatio, metadata = {} } = args;
  const storagePath = `${userId}${projectId ? `/projects/${projectId}` : ''}/videos/${jobId}-${Date.now()}.mp4`;
  const upload = await admin.storage.from('kai-media').upload(storagePath, buffer, { contentType: 'video/mp4', upsert: true });
  if (upload.error) throw new Error(`Storage upload: ${upload.error.message}`);

  const signed = await admin.storage.from('kai-media').createSignedUrl(storagePath, 60 * 60 * 24 * 30);
  if (signed.error || !signed.data?.signedUrl) throw new Error(`Signed URL: ${signed.error?.message || 'tidak tersedia'}`);

  const asset = await admin.from('kai_assets').insert({
    user_id: userId,
    project_id: projectId,
    kind: 'video',
    storage_path: storagePath,
    mime_type: 'video/mp4',
    metadata: {
      provider,
      model,
      jobId,
      sceneNumber,
      aspectRatio,
      resolution,
      generatedDurationSeconds: durationSeconds,
      nativeAudio: provider === 'veo',
      ...metadata,
    },
  }).select().single();
  if (asset.error || !asset.data) throw new Error(`Asset database: ${asset.error?.message || 'tidak tersimpan'}`);

  const updatedJob = await admin.from('kai_generation_jobs').update({
    status: 'completed',
    provider,
    provider_operation: provider === 'veo' ? (undefined as never) : null,
    output_url: signed.data.signedUrl,
    output_asset_id: asset.data.id,
    credits_reserved: 0,
    completed_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
    settings: {
      provider,
      model,
      projectId,
      sceneNumber,
      aspectRatio,
      resolution,
      videoDurationSeconds: durationSeconds,
      ...metadata,
    },
  }).eq('id', jobId);
  if (updatedJob.error) throw updatedJob.error;

  if (projectId && sceneNumber != null) {
    const { data: project } = await admin.from('kai_projects').select('settings').eq('id', projectId).eq('user_id', userId).single();
    const projectSettings = { ...(project?.settings || {}) } as any;
    const contentPlan = { ...(projectSettings.content_plan || {}) } as any;
    contentPlan.scenes = Array.isArray(contentPlan.scenes) ? contentPlan.scenes.map((scene: any) => Number(scene.scene) === sceneNumber ? {
      ...scene,
      video_url: signed.data.signedUrl,
      video_asset_id: asset.data.id,
      video_job_id: jobId,
      video_provider: provider,
      video_model: model,
      video_duration_seconds: durationSeconds,
    } : scene) : contentPlan.scenes;
    projectSettings.content_plan = contentPlan;
    const update = await admin.from('kai_projects').update({ settings: projectSettings, updated_at: new Date().toISOString() }).eq('id', projectId).eq('user_id', userId);
    if (update.error) throw new Error(`Project update: ${update.error.message}`);
  }

  return { url: signed.data.signedUrl, assetId: asset.data.id };
}

export async function POST(req: Request) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  let body: any = {};
  try { body = await req.json(); } catch {}
  const requestedProvider = String(body.provider || defaultVideoProvider()).trim().toLowerCase();
  const provider = requestedProvider === 'auto' ? 'smart' : requestedProvider;
  const prompt = String(body.prompt || '').trim();
  const aspectRatio = String(body.aspectRatio || '16:9');
  const resolution = String(body.resolution || '1080p');
  const projectId = body.projectId ? String(body.projectId) : null;
  const sceneNumber = body.sceneNumber == null ? null : Number(body.sceneNumber);
  const sceneDuration = Number(body.sceneDuration || 8);
  const requestedDuration = Number(body.durationSeconds || 8);
  const camera = String(body.camera || '').trim();
  const tone = String(body.tone || '').trim();

  if (!prompt) return NextResponse.json({ error: 'Prompt video wajib diisi.' }, { status: 400 });
  if (!['smart', 'veo', 'local'].includes(provider)) return NextResponse.json({ error: `Provider video '${provider}' belum tersedia.` }, { status: 400 });
  if (!['16:9', '9:16'].includes(aspectRatio)) return NextResponse.json({ error: 'Aspect ratio tidak valid.' }, { status: 400 });
  if (!['720p', '1080p', '4K'].includes(resolution)) return NextResponse.json({ error: 'Resolusi tidak valid.' }, { status: 400 });

  const admin = createAdminClient();
  if (projectId) {
    const { data: project } = await admin.from('kai_projects').select('id').eq('id', projectId).eq('user_id', user.id).single();
    if (!project) return NextResponse.json({ error: 'Project tidak ditemukan.' }, { status: 404 });
  }

  const veoDuration = chooseVeoDuration(Number.isFinite(requestedDuration) ? requestedDuration : sceneDuration, resolution);
  let jobId: string | null = null;
  let reserved = 0;

  const createJob = async (initialProvider: string, credits: number, status = 'processing') => {
    const job = await admin.from('kai_generation_jobs').insert({
      user_id: user.id,
      project_id: projectId,
      type: 'video',
      provider: initialProvider,
      prompt,
      status,
      credits_reserved: credits,
      settings: { requestedProvider: provider, provider: initialProvider, projectId, sceneNumber, aspectRatio, resolution, sceneDuration, videoDurationSeconds: veoDuration, model: initialProvider === 'veo' ? getVeoModel() : 'kreasiai-local-scene-v1' },
      started_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    }).select().single();
    if (job.error || !job.data) throw new Error(job.error?.message || 'Job video tidak tersimpan.');
    jobId = job.data.id;
    return job.data;
  };

  const reserveVeo = async () => {
    reserved = videoCreditCost(resolution);
    const reserve = await admin.rpc('kai_reserve_credits', {
      p_user_id: user.id,
      p_cost: reserved,
      p_reason: projectId ? `scene-video:${sceneNumber ?? 'unknown'}:veo` : 'generator-video:veo',
    });
    if (reserve.error) {
      if (reserve.error.message.includes('INSUFFICIENT_CREDITS')) throw Object.assign(new Error('Credit KreasiAI tidak cukup untuk video.'), { statusCode: 402 });
      throw reserve.error;
    }
  };

  const runLocal = async (existingJobId?: string) => {
    const job = existingJobId ? { id: existingJobId } : await createJob('local', 0, 'processing');
    const local = await generateLocalVideoClip({ prompt: buildPrompt(prompt, camera, tone), camera, tone, durationSeconds: veoDuration, resolution: resolution as any, aspectRatio: aspectRatio as any });
    const saved = await persistVideo({ admin, userId: user.id, projectId, sceneNumber, jobId: job.id, buffer: local.buffer, provider: 'local', model: local.model, durationSeconds: local.durationSeconds, resolution, aspectRatio, metadata: { fallbackFrom: provider === 'smart' ? 'veo' : null, localPreview: true } });
    return { jobId: job.id, provider: 'local', model: local.model, durationSeconds: local.durationSeconds, ...saved, fallback: true };
  };

  try {
    if (provider === 'local') {
      const result = await runLocal();
      return NextResponse.json({ ...result, status: 'completed', message: 'Local fallback video selesai. Tidak memakai quota Google/Veo.' });
    }

    const shouldTryVeo = provider === 'veo' || (provider === 'smart' && Boolean(process.env.GOOGLE_API_KEY?.trim()));
    if (!shouldTryVeo) {
      const result = await runLocal();
      return NextResponse.json({ ...result, status: 'completed', message: 'Google Veo tidak dikonfigurasi. Smart fallback memakai Local Scene.' });
    }

    await reserveVeo();
    const job = await createJob('veo', reserved, 'processing');
    const promptSent = buildPrompt(prompt, camera, tone);

    try {
      const operation = await startVideoGeneration({
        prompt: promptSent,
        aspectRatio: aspectRatio as '16:9' | '9:16',
        resolution: resolution as '720p' | '1080p' | '4K',
        durationSeconds: veoDuration,
        model: getVeoModel(),
      });
      const updated = await admin.from('kai_generation_jobs').update({
        provider_operation: { name: operation.name, model: operation.model },
        settings: { requestedProvider: provider, provider: 'veo', projectId, sceneNumber, aspectRatio, resolution, sceneDuration, videoDurationSeconds: operation.durationSeconds, model: operation.model, promptSent, operationName: operation.name },
        updated_at: new Date().toISOString(),
      }).eq('id', job.id);
      if (updated.error) throw updated.error;
      reserved = 0;
      return NextResponse.json({ jobId: job.id, status: 'processing', provider: 'veo', model: operation.model, operationName: operation.name, durationSeconds: operation.durationSeconds, fallback: false });
    } catch (error) {
      const raw = errorMessage(error);
      if (provider === 'smart' && isProviderUnavailable(raw)) {
        const friendly = friendlyVeoError(raw);
        if (reserved > 0) {
          await admin.rpc('kai_refund_credits', { p_user_id: user.id, p_amount: reserved, p_reason: 'smart_fallback_veo_failed', p_job_id: job.id });
          reserved = 0;
        }
        await admin.from('kai_generation_jobs').update({ provider: 'local', status: 'processing', credits_reserved: 0, error_message: `Veo tidak tersedia; fallback lokal dipakai. ${friendly}`, settings: { requestedProvider: 'smart', provider: 'local', fallbackFrom: 'veo', projectId, sceneNumber, aspectRatio, resolution, sceneDuration, videoDurationSeconds: veoDuration, model: 'kreasiai-local-scene-v1', veoError: friendly }, updated_at: new Date().toISOString() }).eq('id', job.id);
        try {
          const result = await runLocal(job.id);
          return NextResponse.json({ ...result, status: 'completed', message: `⚠️ Veo tidak tersedia. ${friendly} Smart Fallback membuat Local Scene tanpa quota Google.` });
        } catch (fallbackError) {
          const fallbackMessage = errorMessage(fallbackError);
          await admin.from('kai_generation_jobs').update({ status: 'failed', error_message: `Veo gagal: ${friendly} | Local fallback gagal: ${fallbackMessage}`, updated_at: new Date().toISOString() }).eq('id', job.id);
          return NextResponse.json({ error: `Veo gagal dan Local Fallback juga gagal. ${fallbackMessage}`, jobId: job.id, provider: 'smart' }, { status: 502 });
        }
      }
      const msg = friendlyVeoError(raw);
      await admin.from('kai_generation_jobs').update({ status: 'failed', error_message: msg, credits_reserved: 0, updated_at: new Date().toISOString() }).eq('id', job.id);
      if (reserved > 0) {
        await admin.rpc('kai_refund_credits', { p_user_id: user.id, p_amount: reserved, p_reason: 'video_provider_failed', p_job_id: job.id });
        reserved = 0;
      }
      const statusCode = /quota|429|RESOURCE_EXHAUSTED/i.test(raw) ? 429 : 502;
      return NextResponse.json({ error: msg, jobId: job.id, provider: 'veo' }, { status: statusCode });
    }
  } catch (error) {
    if (reserved > 0) await admin.rpc('kai_refund_credits', { p_user_id: user.id, p_amount: reserved, p_reason: 'video_failed', p_job_id: jobId });
    const code = (error as any)?.statusCode === 402 ? 402 : 500;
    return NextResponse.json({ error: errorMessage(error), jobId, provider }, { status: code });
  }
}
