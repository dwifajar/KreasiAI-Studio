import { NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { createAdminClient } from '@/lib/supabase/admin';
import { generateSpeech } from '@/lib/providers/elevenlabs';
import { ttsCreditCost } from '@/lib/kai';

export const runtime = 'nodejs';

function parseElevenQuota(message: string) {
  const m = message.match(/quota of\s+(\d+).*?([\d,]+) credits remaining.*?([\d,]+) credits are required/i);
  if (!m) return null;
  return { limit: Number(m[1]), remaining: Number(m[2].replace(/,/g,'')), required: Number(m[3].replace(/,/g,'')) };
}

function errorMessage(error: unknown) {
  if (error instanceof Error) return error.message;
  if (typeof error === 'string') return error;
  try { return JSON.stringify(error); } catch { return 'Scene voice generation failed'; }
}

export async function POST(req: Request) {
  let userId = '';
  let admin: ReturnType<typeof createAdminClient> | null = null;
  let reservedCost = 0;
  let jobId: string | null = null;
  try {
    const supabase = await createClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    userId = user.id;

    const body = await req.json();
    const projectId = body?.projectId;
    const sceneNumber = Number(body?.sceneNumber);
    const text = typeof body?.text === 'string' ? body.text.trim() : '';
    const voiceId = typeof body?.voiceId === 'string' ? body.voiceId.trim() : undefined;
    if (!projectId || !Number.isFinite(sceneNumber) || !text) {
      return NextResponse.json({ error: 'Project, scene, dan text wajib diisi.' }, { status: 400 });
    }

    admin = createAdminClient();
    const { data: project, error: projectError } = await admin
      .from('kai_projects').select('id,settings').eq('id', projectId).eq('user_id', user.id).single();
    if (projectError || !project) return NextResponse.json({ error: 'Project tidak ditemukan.' }, { status: 404 });

    reservedCost = ttsCreditCost(text);
    const { error: reserveError } = await admin.rpc('kai_reserve_credits', {
      p_user_id: user.id, p_cost: reservedCost, p_reason: `scene-voice:${sceneNumber}`
    });
    if (reserveError) {
      if (reserveError.message.includes('INSUFFICIENT_CREDITS')) return NextResponse.json({ error: 'Credit tidak cukup.' }, { status: 402 });
      throw reserveError;
    }

    const { data: job, error: jobError } = await admin.from('kai_generation_jobs').insert({
      user_id: user.id, project_id: projectId, type: 'tts', provider: 'elevenlabs',
      prompt: text, status: 'processing', credits_reserved: reservedCost,
      settings: { projectId, sceneNumber, voiceId: voiceId || process.env.ELEVENLABS_VOICE_ID || null }
    }).select().single();
    if (jobError) {
      await admin.rpc('kai_refund_credits', { p_user_id: user.id, p_amount: reservedCost, p_reason: 'scene_voice_job_insert_failed' });
      reservedCost = 0;
      throw jobError;
    }
    jobId = job.id;

    try {
      const audio = await generateSpeech(text, voiceId);
      if (!audio.length) throw new Error('ElevenLabs mengembalikan audio kosong.');

      const path = `${user.id}/projects/${projectId}/scene-${sceneNumber}-${job.id}.mp3`;
      const up = await admin.storage.from('kai-media').upload(path, audio, { contentType: 'audio/mpeg', upsert: true });
      if (up.error) throw new Error(`Storage upload: ${up.error.message}`);

      const signed = await admin.storage.from('kai-media').createSignedUrl(path, 60 * 60 * 24 * 7);
      if (signed.error || !signed.data?.signedUrl) throw new Error(`Storage signed URL: ${signed.error?.message || 'URL tidak tersedia'}`);

      const asset = await admin.from('kai_assets').insert({
        user_id: user.id, project_id: projectId, kind: 'audio', storage_path: path, mime_type: 'audio/mpeg',
        metadata: { projectId, sceneNumber, provider: 'elevenlabs', jobId: job.id }
      }).select().single();
      if (asset.error || !asset.data) throw new Error(`Asset database: ${asset.error?.message || 'Asset tidak tersimpan'}`);

      const settings = { ...(project.settings || {}) };
      const cp = { ...(settings.content_plan || {}) };
      const scenes = Array.isArray(cp.scenes)
        ? cp.scenes.map((s: any) => Number(s.scene) === sceneNumber
          ? { ...s, voice_url: signed.data.signedUrl, voice_job_id: job.id, voice_asset_id: asset.data.id } : s)
        : [];
      settings.content_plan = { ...cp, scenes };
      const projectUpdate = await admin.from('kai_projects').update({ settings, updated_at: new Date().toISOString() })
        .eq('id', projectId).eq('user_id', user.id);
      if (projectUpdate.error) throw new Error(`Project update: ${projectUpdate.error.message}`);

      await admin.from('kai_generation_jobs').update({
        status: 'completed', output_url: signed.data.signedUrl, output_asset_id: asset.data.id,
        completed_at: new Date().toISOString(), updated_at: new Date().toISOString()
      }).eq('id', job.id);

      reservedCost = 0;
      return NextResponse.json({ jobId: job.id, url: signed.data.signedUrl, status: 'completed', assetId: asset.data.id });
    } catch (error) {
      const msg = errorMessage(error);
      const quota = parseElevenQuota(msg);
      await admin.from('kai_generation_jobs').update({ status: 'failed', error_message: msg, updated_at: new Date().toISOString() }).eq('id', job.id);
      if (reservedCost > 0) {
        await admin.rpc('kai_refund_credits', { p_user_id: user.id, p_amount: reservedCost, p_reason: 'scene_voice_failed', p_job_id: job.id });
        reservedCost = 0;
      }
      return NextResponse.json({ error: msg, jobId: job.id, quota }, { status: quota ? 402 : 502 });
    }
  } catch (error) {
    const msg = errorMessage(error);
    if (admin && reservedCost > 0) {
      await admin.rpc('kai_refund_credits', { p_user_id: userId, p_amount: reservedCost, p_reason: 'scene_voice_failed', p_job_id: jobId });
    }
    return NextResponse.json({ error: msg, jobId }, { status: 500 });
  }
}
