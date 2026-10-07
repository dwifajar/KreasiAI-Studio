import { NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { createAdminClient } from '@/lib/supabase/admin';
import { generateSpeech } from '@/lib/providers/elevenlabs';
import { ttsCreditCost } from '@/lib/kai';

export async function POST(req: Request) {
  try {
    const supabase = await createClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    const { text, voiceId } = await req.json();
    if (!text?.trim()) return NextResponse.json({ error: 'Text wajib diisi' }, { status: 400 });

    const admin = createAdminClient();
    const cost = ttsCreditCost(text);
    const { error: reserveError } = await admin.rpc('kai_reserve_credits', { p_user_id: user.id, p_cost: cost, p_reason: 'tts' });
    if (reserveError) {
      if (reserveError.message.includes('INSUFFICIENT_CREDITS')) return NextResponse.json({ error: 'Credit tidak cukup.' }, { status: 402 });
      throw reserveError;
    }

    const { data: job, error: jobError } = await admin.from('kai_generation_jobs').insert({ user_id: user.id, type: 'tts', provider: 'elevenlabs', prompt: text, status: 'processing', credits_reserved: cost }).select().single();
    if (jobError) {
      await admin.rpc('kai_refund_credits', { p_user_id: user.id, p_amount: cost, p_reason: 'job_insert_failed' });
      throw jobError;
    }

    try {
      const audio = await generateSpeech(text, voiceId);
      const path = `${user.id}/audio/${job.id}.mp3`;
      const up = await admin.storage.from('kai-media').upload(path, audio, { contentType: 'audio/mpeg', upsert: true });
      if (up.error) throw up.error;
      const { data: signed } = await admin.storage.from('kai-media').createSignedUrl(path, 60 * 60 * 24 * 7);
      await admin.from('kai_generation_jobs').update({ status: 'completed', output_url: signed?.signedUrl ?? null, completed_at: new Date().toISOString(), updated_at: new Date().toISOString() }).eq('id', job.id);
      return NextResponse.json({ jobId: job.id, url: signed?.signedUrl ?? null, status: 'completed' });
    } catch (e) {
      await admin.from('kai_generation_jobs').update({ status: 'failed', error_message: e instanceof Error ? e.message : String(e), updated_at: new Date().toISOString() }).eq('id', job.id);
      await admin.rpc('kai_refund_credits', { p_user_id: user.id, p_amount: cost, p_reason: 'tts_failed', p_job_id: job.id });
      throw e;
    }
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : 'Generation failed' }, { status: 500 });
  }
}
